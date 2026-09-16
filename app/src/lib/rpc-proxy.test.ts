import assert from "node:assert/strict";
import test from "node:test";
import { upstreamStatus } from "./rpc-proxy.ts";

const ok = (id: number) => ({ jsonrpc: "2.0", id, result: "0x1" });
const err = (id: number, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

test("upstream replies clients cannot use become retryable statuses", () => {
  assert.equal(upstreamStatus(JSON.stringify([ok(1), ok(2)]), true, 2, 200), 200);
  assert.equal(upstreamStatus(JSON.stringify(ok(1)), false, 1, 200), 200);
  assert.equal(upstreamStatus(JSON.stringify([ok(1), err(2, 3, "execution reverted")]), true, 2, 200), 200); // real errors pass through
  // rate limiting inside a 200 body, by message or by code
  assert.equal(upstreamStatus(JSON.stringify([ok(1), err(2, -32016, "over rate limit")]), true, 2, 200), 429);
  assert.equal(upstreamStatus(JSON.stringify(err(1, -32000, "rate limit exceeded")), false, 1, 200), 429);
  assert.equal(upstreamStatus(JSON.stringify(err(1, -32005, "limit")), false, 1, 200), 429);
  assert.equal(upstreamStatus(JSON.stringify(err(1, 429, "Too Many Requests")), false, 1, 200), 429);
  // shape mismatches that would throw inside viem's batch scheduler
  assert.equal(upstreamStatus(JSON.stringify(err(1, -32016, "over rate limit")), true, 2, 200), 502); // single object for a batch
  assert.equal(upstreamStatus(JSON.stringify([ok(1)]), true, 2, 200), 502); // short batch
  assert.equal(upstreamStatus(JSON.stringify([ok(1)]), false, 1, 200), 502); // array for a single request
  assert.equal(upstreamStatus("<html>gateway timeout</html>", true, 1, 200), 502);
  assert.equal(upstreamStatus(JSON.stringify([null]), true, 1, 200), 502);
  // non-200 statuses are passed through untouched
  for (const status of [400, 403, 429, 500, 503]) assert.equal(upstreamStatus("{}", false, 1, status), status);
});

test("reply IDs and envelopes must match the forwarded requests", () => {
  assert.equal(upstreamStatus(JSON.stringify([ok(2), ok(1)]), true, 2, 200, [1, 2]), 200);
  assert.equal(upstreamStatus(JSON.stringify([ok(1), ok(1)]), true, 2, 200, [1, 2]), 502);
  assert.equal(upstreamStatus(JSON.stringify([ok(1), ok(3)]), true, 2, 200, [1, 2]), 502);
  assert.equal(upstreamStatus(JSON.stringify(ok(2)), false, 1, 200, [1]), 502);
  assert.equal(upstreamStatus(JSON.stringify([{ ...ok(1), id: "1" }]), true, 1, 200, [1]), 502);
  for (const value of [
    { jsonrpc: "2.0", id: 1 },
    { ...ok(1), error: { code: -32603, message: "contradictory" } },
    { jsonrpc: "2.0", id: 1, error: { code: "bad", message: "malformed" } },
    { id: 1, result: "0x1" },
  ]) assert.equal(upstreamStatus(JSON.stringify([value]), true, 1, 200, [1]), 502);
  // Valid null results (e.g. an unmined receipt) and execution errors survive.
  assert.equal(upstreamStatus(JSON.stringify([{ ...ok(1), result: null }]), true, 1, 200, [1]), 200);
  assert.equal(upstreamStatus(JSON.stringify([err(1, 3, "execution reverted")]), true, 1, 200, [1]), 200);
});
