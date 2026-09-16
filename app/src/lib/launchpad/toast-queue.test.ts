import assert from "node:assert/strict";
import test from "node:test";
import type { FeedItem } from "./queries";
import { createToastFeedTracker, createToastQueue, FEED_GAP_MS, dismissToast, enqueueToast, expireToast, MAX_PENDING_ACTIVITY, pauseToast, removeActivityToasts, toastDelay, TOAST_EXIT_MS, TOAST_TTL_MS, type QueuedToast } from "./toast-queue.ts";

const item = (id: string, source: QueuedToast["source"] = "activity"): QueuedToast => ({ id, source, kind: "buy", title: id });
const feedItem = (id: string): FeedItem => ({ kind: "launch", chain: "base", at: "2026-09-01T00:00:00Z", tx_hash: id, token: "token", name: id, symbol: "TEST", launcher: "wallet", lp_fee: 0, quote_key: "eth", image_url: null });

test("a burst keeps one active card and queues the rest in arrival order", () => {
  let state = enqueueToast(createToastQueue(), item("first"), 0);
  const active = state.active;
  state = enqueueToast(state, item("second"), 1_000);
  state = enqueueToast(state, item("third"), 2_000);
  assert.equal(state.active, active, "pending arrivals must not restart the active card's timer");
  assert.deepEqual(state.pending.map((toast) => toast.id), ["second", "third"]);
  state = dismissToast(state, "first", 4_000);
  assert.equal(state.active?.id, "second");
  assert.deepEqual(state.pending.map((toast) => toast.id), ["third"]);
  state = dismissToast(state, "second", 5_000);
  state = dismissToast(state, "third", 6_000);
  assert.deepEqual(state, createToastQueue());
});

test("local confirmations survive a full activity queue and take priority in their own order", () => {
  let state = enqueueToast(createToastQueue(), item("active"), 0);
  const active = state.active;
  state = enqueueToast(state, { ...item("own launch", "local"), celebrate: true }, 1);
  for (let i = 0; i < 60; i++) {
    state = enqueueToast(state, item(`activity ${i}`), i + 2);
    if (i === 30) state = enqueueToast(state, item("own buy", "local"), i + 2);
  }
  assert.equal(state.active, active);
  assert.equal(state.active?.celebrate, undefined, "queued celebrations wait for their card");
  assert.equal(state.pending.length, MAX_PENDING_ACTIVITY + 2);
  assert.deepEqual(state.pending.slice(0, 2).map((toast) => toast.id), ["own launch", "own buy"]);
  assert.equal(state.pending[2].id, `activity ${60 - MAX_PENDING_ACTIVITY}`, "only the oldest pending activity is discarded");
  state = dismissToast(state, "active", 10_000);
  assert.equal(state.active?.id, "own launch");
  assert.equal(state.active?.celebrate, true);
  state = dismissToast(state, "own launch", 11_000);
  assert.equal(state.active?.id, "own buy");
  state = dismissToast(state, "own buy", 12_000);
  assert.equal(state.active?.id, `activity ${60 - MAX_PENDING_ACTIVITY}`);
});

test("pending items get a full lifetime when promoted, then leave before the next appears", () => {
  let state = enqueueToast(createToastQueue(), item("first"), 0);
  state = enqueueToast(state, item("second"), 1);
  state = pauseToast(state, "hover", true, 2);
  state = pauseToast(state, "hover", false, 60_000);
  state = dismissToast(state, "first", 60_000);
  assert.equal(toastDelay(state.active!, 60_000), TOAST_TTL_MS);
  assert.equal(expireToast(state, "second", 60_000 + TOAST_TTL_MS - 1), state);
  state = expireToast(state, "second", 60_000 + TOAST_TTL_MS);
  assert.equal(state.active?.id, "second");
  assert.equal(state.active?.leaving, true);
  assert.equal(toastDelay(state.active!, 60_000 + TOAST_TTL_MS), TOAST_EXIT_MS);
  state = expireToast(state, "second", 60_000 + TOAST_TTL_MS + TOAST_EXIT_MS);
  assert.equal(state.active, null);
});

for (const firstReason of ["hover", "focus"] as const) {
  test(`${firstReason} and overlapping interaction pause only elapsed visible time`, () => {
    const otherReason = firstReason === "hover" ? "focus" : "hover";
    let state = enqueueToast(createToastQueue(), item("first"), 0);
    state = pauseToast(state, firstReason, true, 2_000);
    assert.equal(state.active?.remainingMs, 4_000);
    state = pauseToast(state, otherReason, true, 3_000);
    state = pauseToast(state, firstReason, false, 10_000);
    assert.equal(toastDelay(state.active!, 20_000), null, "the remaining interaction keeps the clock paused");
    assert.equal(expireToast(state, "first", 20_000), state);
    state = pauseToast(state, otherReason, false, 30_000);
    assert.equal(toastDelay(state.active!, 30_000), 4_000);
    assert.equal(expireToast(state, "first", 33_999), state);
    state = expireToast(state, "first", 34_000);
    assert.equal(state.active?.leaving, true);
  });
}

test("a second pause preserves the remaining lifetime and can also pause exit", () => {
  let state = enqueueToast(createToastQueue(), item("first"), 0);
  state = pauseToast(state, "hover", true, 1_000);
  state = pauseToast(state, "hover", false, 10_000);
  state = pauseToast(state, "focus", true, 11_000);
  assert.equal(state.active?.remainingMs, 4_000);
  state = pauseToast(state, "focus", false, 20_000);
  state = expireToast(state, "first", 24_000);
  state = pauseToast(state, "focus", true, 24_100);
  assert.equal(state.active?.remainingMs, TOAST_EXIT_MS - 100);
  state = pauseToast(state, "focus", false, 40_000);
  state = expireToast(state, "first", 40_000 + TOAST_EXIT_MS - 100);
  assert.equal(state.active, null);
});

test("dismissing a focused card releases its focus pause but preserves a pointer over the next card", () => {
  let state = enqueueToast(createToastQueue(), item("first"), 0);
  state = enqueueToast(state, item("second"), 1);
  state = pauseToast(state, "hover", true, 100);
  state = pauseToast(state, "focus", true, 200);
  state = dismissToast(state, "first", 1_000);
  assert.equal(state.focus, false);
  assert.equal(state.hover, true);
  assert.equal(toastDelay(state.active!, 2_000), null);
  state = pauseToast(state, "hover", false, 3_000);
  assert.equal(toastDelay(state.active!, 3_000), TOAST_TTL_MS);
  state = pauseToast(state, "focus", true, 3_500);
  state = dismissToast(state, "second", 4_000);
  state = enqueueToast(state, item("third"), 5_000);
  assert.equal(toastDelay(state.active!, 5_000), TOAST_TTL_MS, "an empty queue must not retain a removed card's pause");
});

test("late timers and repeated dismissal cannot skip the newly active card", () => {
  let state = enqueueToast(createToastQueue(), item("first"), 0);
  state = enqueueToast(state, item("second"), 1);
  state = dismissToast(state, "first", 1_000);
  assert.equal(dismissToast(state, "first", 2_000), state);
  assert.equal(expireToast(state, "first", 20_000), state);
  assert.equal(state.active?.id, "second");
});

test("muting removes ambient backlog without restarting or unpausing an active local update", () => {
  let state = enqueueToast(createToastQueue(), item("mine", "local"), 0);
  state = pauseToast(state, "focus", true, 2_000);
  state = enqueueToast(state, item("activity"), 3_000);
  state = enqueueToast(state, item("next local", "local"), 4_000);
  const active = state.active;
  state = removeActivityToasts(state, 20_000);
  assert.equal(state.active, active);
  assert.equal(state.focus, true);
  assert.equal(state.active?.remainingMs, 4_000);
  assert.deepEqual(state.pending.map((toast) => toast.id), ["next local"]);
  assert.equal(removeActivityToasts(state, 21_000), state, "already-muted queues are unchanged");
});

test("muting an active ambient event promotes the next local update and clears obsolete focus", () => {
  let state = enqueueToast(createToastQueue(), item("activity"), 0);
  state = enqueueToast(state, item("more activity"), 1);
  state = enqueueToast(state, item("mine", "local"), 2);
  state = pauseToast(state, "focus", true, 100);
  state = pauseToast(state, "hover", true, 200);
  state = removeActivityToasts(state, 1_000);
  assert.equal(state.active?.id, "mine");
  assert.equal(state.active?.remainingMs, TOAST_TTL_MS);
  assert.equal(state.active?.startedAt, null, "the pointer still pauses the replacement");
  assert.equal(state.focus, false);
  assert.equal(state.hover, true);
  assert.deepEqual(state.pending, []);
  assert.equal(expireToast(state, "activity", 50_000), state);
});

test("muting an ambient-only queue clears stale pause state for the next local notification", () => {
  let state = enqueueToast(createToastQueue(), item("activity"), 0);
  state = pauseToast(state, "focus", true, 100);
  state = removeActivityToasts(state, 200);
  assert.deepEqual(state, createToastQueue());
  state = enqueueToast(state, item("mine", "local"), 1_000);
  assert.equal(toastDelay(state.active!, 1_000), TOAST_TTL_MS);
});

test("initial history and repeated snapshots stay silent; new events arrive oldest first", () => {
  const history = feedItem("history");
  const earlier = feedItem("earlier");
  const latest = feedItem("latest");
  const fresh = createToastFeedTracker([history]);
  assert.deepEqual(fresh([history]), []);
  assert.deepEqual(fresh([latest, earlier, history]), [earlier, latest]);
  assert.deepEqual(fresh([latest, earlier, history]), []);
  assert.deepEqual(fresh([{ ...latest, chain: "robinhood" }]), [{ ...latest, chain: "robinhood" }]);
});

test("activity dropped during a burst is remembered and cannot replay on the next poll", () => {
  const fresh = createToastFeedTracker([]);
  const incoming = Array.from({ length: 40 }, (_, i) => feedItem(String(40 - i)));
  let state = createToastQueue();
  for (const event of fresh(incoming)) state = enqueueToast(state, item(event.tx_hash), 0);
  assert.equal(state.pending.length, MAX_PENDING_ACTIVITY);
  assert.deepEqual(fresh(incoming), []);
  assert.deepEqual(fresh([incoming[0], incoming[0]]), []);
});

test("a poll after a hidden-tab or offline gap is a silent baseline, not a replay of everything missed", () => {
  const history = feedItem("history");
  const fresh = createToastFeedTracker([history], 1_000_000);
  const missed = Array.from({ length: 24 }, (_, i) => feedItem(`missed-${i}`));
  // Polling pauses while hidden; the first snapshot back arrives long after the last one.
  assert.deepEqual(fresh([...missed, history], 1_000_000 + FEED_GAP_MS + 1), [], "nothing missed during the gap is queued");
  assert.deepEqual(fresh([...missed, history], 1_000_000 + FEED_GAP_MS + 5_001), [], "and it stays remembered afterwards");
  const next = feedItem("next");
  assert.deepEqual(fresh([next, ...missed], 1_000_000 + FEED_GAP_MS + 10_001), [next], "live activity resumes on the following poll");
});

test("regular polls, a gap exactly at the limit, and snapshots without a server time still deliver activity", () => {
  const fresh = createToastFeedTracker([], 5_000);
  const a = feedItem("a");
  const b = feedItem("b");
  const c = feedItem("c");
  const d = feedItem("d");
  assert.deepEqual(fresh([a], 10_000), [a]);
  assert.deepEqual(fresh([b, a], 10_000 + FEED_GAP_MS), [b], "exactly the limit is not a gap");
  assert.deepEqual(fresh([c, b, a]), [c], "no server time: no gap detection");
  assert.deepEqual(fresh([d, c, b, a], 10_000 + FEED_GAP_MS + 4_000), [d]);
});

test("the layout's placeholder time (0) never suppresses the first real poll", () => {
  const fresh = createToastFeedTracker([], 0);
  const first = feedItem("first");
  assert.deepEqual(fresh([first], Date.UTC(2026, 8, 15)), [first]);
});

test("a busy stream stays under a minute old: the cap keeps the newest activity, oldest dropped", () => {
  assert.equal(MAX_PENDING_ACTIVITY, 10);
  assert.ok((MAX_PENDING_ACTIVITY + 1) * TOAST_TTL_MS <= 66_000, "the last queued card appears within ~a minute");
  let state = createToastQueue();
  for (let i = 1; i <= 30; i++) state = enqueueToast(state, item(`activity ${i}`), i);
  assert.equal(state.active?.id, "activity 1");
  assert.deepEqual(state.pending.map((toast) => toast.id), Array.from({ length: 10 }, (_, i) => `activity ${21 + i}`), "the 10 most recent wait, in arrival order");
  state = enqueueToast(state, item("mine", "local"), 31);
  assert.equal(state.pending[0].id, "mine", "an own confirmation still goes first and does not count against the cap");
  assert.equal(state.pending.length, 11);
});

test("an empty snapshot after a gap does not complete the baseline; the next populated one does", () => {
  const history = feedItem("history");
  const fresh = createToastFeedTracker([history], 1_000_000);
  const resumedAt = 1_000_000 + FEED_GAP_MS + 1;
  assert.deepEqual(fresh([], resumedAt), [], "an empty feed (e.g. a machine without a database) records nothing");
  const missed = Array.from({ length: 5 }, (_, i) => feedItem(`missed-${i}`));
  assert.deepEqual(fresh([...missed, history], resumedAt + 5_000), [], "the first populated snapshot is still the baseline");
  const next = feedItem("next");
  assert.deepEqual(fresh([next, ...missed, history], resumedAt + 10_000), [next]);
});
