import { test } from "node:test";
import assert from "node:assert/strict";
import { MEMO_MAX_KEYS, clearMemo, memo, memoSizeForTests } from "./memo.ts";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

test("fresh hits share one value; a rejection is not cached", async () => {
  clearMemo();
  const c = clock();
  let calls = 0;
  const fn = async () => `v${++calls}`;
  assert.equal(await memo("a", 2_000, fn, c.now), "v1");
  assert.equal(await memo("a", 2_000, fn, c.now), "v1", "second call inside the TTL never reruns fn");
  assert.equal(calls, 1);
  c.advance(2_001);
  assert.equal(await memo("a", 2_000, fn, c.now), "v2", "past the entry's own TTL it refetches");
  assert.equal(calls, 2);

  clearMemo();
  let fails = 0;
  const boom = async (): Promise<string> => { fails++; throw new Error("down"); };
  await assert.rejects(memo("b", 2_000, boom, c.now));
  await assert.rejects(memo("b", 2_000, boom, c.now), "failures delete the key: the next call retries");
  assert.equal(fails, 2);
});

test("concurrent callers share the in-flight promise", async () => {
  clearMemo();
  const c = clock();
  let calls = 0;
  let release!: (v: string) => void;
  const slow = async () => { calls++; return new Promise<string>((res) => { release = res; }); };
  const p1 = memo("k", 2_000, slow, c.now);
  const p2 = memo("k", 2_000, slow, c.now);
  release("done");
  assert.deepEqual(await Promise.all([p1, p2]), ["done", "done"]);
  assert.equal(calls, 1);
});

test("the cache is bounded: bursts of fresh keys evict oldest first", async () => {
  clearMemo();
  const c = clock();
  for (let i = 0; i < MEMO_MAX_KEYS + 50; i++) {
    await memo(`key-${i}`, 60_000, async () => i, c.now);
  }
  assert.equal(memoSizeForTests(), MEMO_MAX_KEYS, "never grows past the cap, even when every entry is fresh");
  let reruns = 0;
  await memo("key-0", 60_000, async () => { reruns++; return -1; }, c.now);
  assert.equal(reruns, 1, "the oldest key was evicted, so it refetches");
  await memo(`key-${MEMO_MAX_KEYS + 49}`, 60_000, async () => { reruns++; return -1; }, c.now);
  assert.equal(reruns, 1, "the newest key survived and still hits");
});

test("a hot key survives a burst of cold keys; expired entries go first", async () => {
  clearMemo();
  const c = clock();
  await memo("hot", 60_000, async () => "hot", c.now);
  for (let i = 0; i < MEMO_MAX_KEYS - 1; i++) {
    await memo(`cold-${i}`, 60_000, async () => i, c.now);
  }
  assert.equal(memoSizeForTests(), MEMO_MAX_KEYS);
  let hotReruns = 0;
  await memo("hot", 60_000, async () => { hotReruns++; return "hot2"; }, c.now);
  assert.equal(hotReruns, 0, "touching hot refreshes its recency");
  await memo("newcomer", 60_000, async () => "new", c.now);
  assert.equal(memoSizeForTests(), MEMO_MAX_KEYS);
  await memo("hot", 60_000, async () => { hotReruns++; return "hot2"; }, c.now);
  assert.equal(hotReruns, 0, "hot survives the overflow; an untouched cold key was evicted instead");

  clearMemo();
  for (let i = 0; i < MEMO_MAX_KEYS; i++) {
    await memo(`short-${i}`, 1_000, async () => i, c.now);
  }
  c.advance(5_000);
  await memo("fresh", 60_000, async () => "fresh", c.now);
  assert.equal(memoSizeForTests(), MEMO_MAX_KEYS);
  let freshReruns = 0;
  await memo("fresh", 60_000, async () => { freshReruns++; return "x"; }, c.now);
  assert.equal(freshReruns, 0, "fresh entry kept");
});

test("each entry expires by its own TTL, not the caller's", async () => {
  clearMemo();
  const c = clock();
  let calls = 0;
  await memo("own-ttl", 10_000, async () => ++calls, c.now);
  c.advance(5_000);
  // A caller passing a shorter TTL must not cut a longer-lived entry short,
  // and a longer TTL must not extend a short-lived one past its own expiry.
  await memo("own-ttl", 1_000, async () => ++calls, c.now);
  assert.equal(calls, 1, "entry judged by its own 10s TTL, still fresh at 5s");
  c.advance(6_000);
  await memo("own-ttl", 60_000, async () => ++calls, c.now);
  assert.equal(calls, 2, "11s > own 10s TTL: refetch despite the caller's 60s TTL");
});
