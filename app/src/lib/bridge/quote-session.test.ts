import assert from "node:assert/strict";
import test from "node:test";
import { BRIDGE_QUOTE_DEBOUNCE_MS, createBridgeQuoteSession } from "./quote-session";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("typing debounces quotes and only requests the latest amount", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = createBridgeQuoteSession();
  const requests: string[] = [];
  session.schedule(() => { requests.push("1"); });
  t.mock.timers.tick(BRIDGE_QUOTE_DEBOUNCE_MS - 1);
  assert.deepEqual(requests, []);
  session.schedule(() => { requests.push("10"); });
  t.mock.timers.tick(BRIDGE_QUOTE_DEBOUNCE_MS - 1);
  assert.deepEqual(requests, []);
  t.mock.timers.tick(1);
  assert.deepEqual(requests, ["10"]);
  t.mock.timers.tick(60_000);
  assert.deepEqual(requests, ["10"], "no automatic retry loop after completion");
});

test("invalid input, closing the dialog, or a wallet action cancels a scheduled quote", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = createBridgeQuoteSession();
  let calls = 0;
  const cancel = session.schedule(() => { calls++; });
  cancel();
  t.mock.timers.tick(BRIDGE_QUOTE_DEBOUNCE_MS);
  assert.equal(calls, 0);
});

test("manual refresh replaces the pending debounce instead of requesting twice", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = createBridgeQuoteSession();
  let calls = 0;
  session.schedule(() => { calls++; });
  await session.run(async () => { calls++; });
  t.mock.timers.tick(BRIDGE_QUOTE_DEBOUNCE_MS);
  assert.equal(calls, 1);
});

test("late success and error responses cannot replace a newer amount's result", async () => {
  for (const oldResult of ["old quote", "old error"]) {
    const session = createBridgeQuoteSession();
    const old = deferred();
    let shown = "";
    let oldSignal: AbortSignal | undefined;
    const first = session.run(async ({ signal, isCurrent }) => {
      oldSignal = signal;
      await old.promise; // a transport that ignores cancellation
      if (isCurrent()) shown = oldResult;
    });
    await session.run(async ({ isCurrent }) => { if (isCurrent()) shown = "new quote"; });
    old.resolve();
    await first;
    assert.equal(oldSignal?.aborted, true);
    assert.equal(shown, "new quote");
  }
});

test("editing aborts in-flight work immediately, before the next debounce finishes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = createBridgeQuoteSession();
  const old = deferred();
  let signal: AbortSignal | undefined;
  let applied = false;
  const first = session.run(async (context) => {
    signal = context.signal;
    await old.promise;
    applied = context.isCurrent();
  });
  const cleanup = session.schedule(() => {});
  assert.equal(signal?.aborted, true);
  old.resolve();
  await first;
  assert.equal(applied, false);
  cleanup();
});

test("closing or changing wallets discards a response even without a replacement request", async () => {
  const session = createBridgeQuoteSession();
  const response = deferred();
  let applied = false;
  const running = session.run(async ({ isCurrent }) => {
    await response.promise;
    applied = isCurrent();
  });
  session.cancel();
  response.resolve();
  await running;
  assert.equal(applied, false);
});
