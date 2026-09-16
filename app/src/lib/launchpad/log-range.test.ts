import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchLogsSplit, isRangeTooLarge } from "./log-range.ts";

test("isRangeTooLarge recognises the size refusals of Arc and Alchemy, through viem's cause chain", () => {
  assert.equal(isRangeTooLarge(new Error("request exceeded max allowed range: query exceeds max results 2000, retry with the range 21102592-21102595")), true);
  assert.equal(isRangeTooLarge(new Error("requested range too large")), true);
  assert.equal(isRangeTooLarge(new Error("Log response size exceeded. This block range should work: [0x1, 0x2]")), true);
  assert.equal(isRangeTooLarge({ message: "HTTP request failed.", cause: { message: "query returned more than 10000 results" } }), true);
  assert.equal(isRangeTooLarge({ message: "HTTP request failed.", details: "requested range too large" }), true);
  assert.equal(isRangeTooLarge(new Error("fetch failed")), false);
  assert.equal(isRangeTooLarge(new Error("rate limited")), false);
  assert.equal(isRangeTooLarge(new Error("query timeout of 10 seconds exceeded")), false, "an overloaded node is not bisected");
  assert.equal(isRangeTooLarge(null), false);
  const loop: { message: string; cause?: unknown } = { message: "x" };
  loop.cause = loop;
  assert.equal(isRangeTooLarge(loop), false, "a cyclic cause chain terminates");
});

test("fetchLogsSplit halves a refused range down to single blocks and keeps block order", async () => {
  const calls: [bigint, bigint][] = [];
  // the node accepts at most 3 blocks per call
  const fetch = async (from: bigint, to: bigint) => {
    calls.push([from, to]);
    if (to - from + 1n > 3n) throw new Error("query exceeds max results 2000, retry with the range 1-3");
    const out: bigint[] = [];
    for (let b = from; b <= to; b++) out.push(b);
    return out;
  };
  const logs = await fetchLogsSplit(fetch, 10n, 21n);
  assert.deepEqual(logs, [10n, 11n, 12n, 13n, 14n, 15n, 16n, 17n, 18n, 19n, 20n, 21n]);
  assert.deepEqual(calls[0], [10n, 21n]);
  assert.ok(calls.every(([f, t]) => t >= f));
});

test("fetchLogsSplit gives up at one block and passes other errors through untouched", async () => {
  await assert.rejects(fetchLogsSplit(async () => { throw new Error("requested range too large"); }, 5n, 5n), /range too large/);
  let n = 0;
  await assert.rejects(fetchLogsSplit(async () => { n++; throw new Error("fetch failed"); }, 0n, 1999n), /fetch failed/);
  assert.equal(n, 1, "an outage is not retried as a size problem");
});
