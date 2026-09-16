import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ETH_FEED_MAX_AGE_S,
  ETH_FETCH_TIMEOUT_MS,
  ETH_PRICE_TTL_MS,
  ETH_SPOT_URL,
  ETH_STALE_MAX_MS,
  ethPriceSource,
  ethUsd,
  feedEthUsd,
  parseEthSpot,
  resetEthPriceCache,
} from "./ethPrice.ts";

const okBody = (amount: string) => new Response(JSON.stringify({ data: { amount } }), { status: 200 });
/** Chainlink down: the tests below that predate the fallback assume only Coinbase exists. */
const feedDown = async () => { throw new Error("rpc down"); };
/** A Chainlink round `ageS` old at clock time `nowMs`, priced in 8 decimals. */
const round = (usd: number, nowMs: number, ageS = 60) => ({ answer: BigInt(Math.round(usd * 1e8)), updatedAt: Math.floor(nowMs / 1000) - ageS });

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

function mockFetch(res: Response, seen: { n: number; url?: string; signal?: unknown }) {
  return async (input: string, init?: RequestInit) => {
    seen.n += 1;
    seen.url = input;
    seen.signal = init?.signal;
    return res;
  };
}

test("parseEthSpot takes the live shape and rejects everything else", () => {
  assert.equal(parseEthSpot({ data: { amount: "2476.12" } }), 2476.12);
  assert.equal(parseEthSpot(null), null);
  assert.equal(parseEthSpot(undefined), null);
  assert.equal(parseEthSpot("2476"), null);
  assert.equal(parseEthSpot({}), null);
  assert.equal(parseEthSpot({ data: null }), null);
  assert.equal(parseEthSpot({ data: {} }), null);
  assert.equal(parseEthSpot({ data: { amount: 2476 } }), null, "number, not string");
  assert.equal(parseEthSpot({ data: { amount: "abc" } }), null);
  assert.equal(parseEthSpot({ data: { amount: "" } }), null);
  assert.equal(parseEthSpot({ data: { amount: "0" } }), null);
  assert.equal(parseEthSpot({ data: { amount: "-5" } }), null);
  assert.equal(parseEthSpot({ data: { amount: "Infinity" } }), null);
});

test("cold fetch publishes the price and memoizes within the TTL", async () => {
  resetEthPriceCache();
  const c = clock();
  const seen = { n: 0 };
  const v1 = await ethUsd({ fetchFn: mockFetch(okBody("2500"), seen), now: c.now });
  assert.equal(v1, 2500);
  assert.equal(seen.url, ETH_SPOT_URL);
  const v2 = await ethUsd({ fetchFn: mockFetch(okBody("9999"), seen), feedFn: feedDown, now: c.now });
  assert.equal(v2, 2500, "second call inside the TTL never hits the network");
  assert.equal(seen.n, 1);
});

test("non-200 keeps the last good price instead of blanking USD (poisoning guard)", async () => {
  resetEthPriceCache();
  const c = clock();
  const seen = { n: 0 };
  assert.equal(await ethUsd({ fetchFn: mockFetch(okBody("2500"), seen), now: c.now }), 2500);
  c.advance(ETH_PRICE_TTL_MS + 1);
  const v = await ethUsd({
    fetchFn: mockFetch(new Response("rate limited", { status: 429 }), seen),
    feedFn: feedDown,
    now: c.now,
  });
  assert.equal(v, 2500, "429 must not overwrite the good price with null");
  assert.equal(seen.n, 2);
});

test("200 with an unusable body keeps the last good price", async () => {
  resetEthPriceCache();
  const c = clock();
  const seen = { n: 0 };
  assert.equal(await ethUsd({ fetchFn: mockFetch(okBody("2500"), seen), now: c.now }), 2500);
  for (const bad of [
    new Response("{}", { status: 200 }),
    new Response("<html>error</html>", { status: 200, headers: { "content-type": "text/html" } }),
    new Response(JSON.stringify({ data: { amount: "nope" } }), { status: 200 }),
    new Response(JSON.stringify({ data: { amount: "-1" } }), { status: 200 }),
  ]) {
    c.advance(ETH_PRICE_TTL_MS + 1);
    const v = await ethUsd({ fetchFn: mockFetch(bad, seen), feedFn: feedDown, now: c.now });
    assert.equal(v, 2500, `bad shape must preserve stale, got ${v}`);
  }
});

test("network throw keeps stale; cold failure is null (UI shows ETH only)", async () => {
  resetEthPriceCache();
  const c = clock();
  const boom = async () => {
    throw new Error("dns down");
  };
  assert.equal(await ethUsd({ fetchFn: boom, feedFn: feedDown, now: c.now }), null);
  resetEthPriceCache();
  const seen = { n: 0 };
  assert.equal(await ethUsd({ fetchFn: mockFetch(okBody("2500"), seen), now: c.now }), 2500);
  c.advance(ETH_PRICE_TTL_MS + 1);
  assert.equal(await ethUsd({ fetchFn: boom, feedFn: feedDown, now: c.now }), 2500);
});

test("failures back off for one TTL and the request carries a timeout", async () => {
  resetEthPriceCache();
  const c = clock();
  const seen: { n: number; signal?: unknown } = { n: 0 };
  assert.equal(
    await ethUsd({
      fetchFn: mockFetch(new Response("x", { status: 500 }), seen),
      feedFn: feedDown,
      now: c.now,
    }),
    null,
  );
  assert.equal(seen.n, 1);
  assert.ok(seen.signal instanceof AbortSignal, "fetch runs under AbortSignal.timeout");
  assert.equal(
    await ethUsd({
      fetchFn: mockFetch(okBody("2500"), seen),
      now: c.now,
    }),
    null,
    "failure advances the timestamp: no retry until the TTL lapses",
  );
  assert.equal(seen.n, 1);
  c.advance(ETH_PRICE_TTL_MS + 1);
  assert.equal(
    await ethUsd({ fetchFn: mockFetch(okBody("2500"), seen), now: c.now }),
    2500,
    "recovers on the next attempt after the TTL",
  );
  assert.equal(ETH_FETCH_TIMEOUT_MS, 5_000);
});

test("feedEthUsd: a positive round under the max age is a price; older, future, zero or negative is not", () => {
  const nowS = 1_700_000_000;
  assert.equal(feedEthUsd({ answer: 244134000000n, updatedAt: nowS - 488 }, nowS), 2441.34, "the round seen on-chain when the feed address was verified");
  assert.equal(feedEthUsd({ answer: 244134000000n, updatedAt: nowS - ETH_FEED_MAX_AGE_S }, nowS), 2441.34, "exactly the max age still counts");
  assert.equal(feedEthUsd({ answer: 244134000000n, updatedAt: nowS - ETH_FEED_MAX_AGE_S - 1 }, nowS), null, "one second past it does not");
  assert.equal(feedEthUsd({ answer: 244134000000n, updatedAt: nowS + 60 }, nowS), null, "future round (clock skew / bad RPC) is not a price");
  assert.equal(feedEthUsd({ answer: 0n, updatedAt: nowS }, nowS), null);
  assert.equal(feedEthUsd({ answer: -1n, updatedAt: nowS }, nowS), null);
  assert.equal(feedEthUsd({ answer: 244134000000n, updatedAt: 0 }, nowS), null, "no update timestamp");
  assert.equal(feedEthUsd(null, nowS), null);
});

test("Coinbase down, Chainlink up: the feed price is served and counts as fresh", async () => {
  resetEthPriceCache();
  const c = clock();
  const seen = { n: 0 };
  assert.equal(await ethUsd({ fetchFn: mockFetch(okBody("2500"), seen), feedFn: feedDown, now: c.now }), 2500);
  assert.equal(ethPriceSource(), "coinbase");
  c.advance(ETH_PRICE_TTL_MS + 1);
  const v = await ethUsd({ fetchFn: mockFetch(new Response("rate limited", { status: 429 }), seen), feedFn: async () => round(2441.34, c.now()), now: c.now });
  assert.equal(v, 2441.34, "a live feed beats the stale Coinbase value");
  assert.equal(ethPriceSource(), "chainlink");
  // the feed value is a confirmed price: a long double outage afterwards is measured from it, not from the last Coinbase success
  c.advance(ETH_STALE_MAX_MS - 1);
  assert.equal(await ethUsd({ fetchFn: mockFetch(new Response("x", { status: 500 }), seen), feedFn: feedDown, now: c.now }), 2441.34);
});

test("Coinbase unusable body, Chainlink up: Chainlink wins over the stale value; a stale feed round does not", async () => {
  resetEthPriceCache();
  const c = clock();
  const seen = { n: 0 };
  assert.equal(await ethUsd({ fetchFn: mockFetch(okBody("2500"), seen), feedFn: feedDown, now: c.now }), 2500);
  c.advance(ETH_PRICE_TTL_MS + 1);
  assert.equal(await ethUsd({ fetchFn: mockFetch(new Response("{}", { status: 200 }), seen), feedFn: async () => round(2440, c.now()), now: c.now }), 2440);
  c.advance(ETH_PRICE_TTL_MS + 1);
  assert.equal(await ethUsd({ fetchFn: mockFetch(new Response("{}", { status: 200 }), seen), feedFn: async () => round(1000, c.now(), ETH_FEED_MAX_AGE_S + 1), now: c.now }), 2440, "a round past the max age is ignored; the last good value is served");
  assert.equal(ethPriceSource(), "chainlink");
});

test("both sources down: the last good value for at most ETH_STALE_MAX_MS, then null, then recovery", async () => {
  resetEthPriceCache();
  const c = clock();
  const seen = { n: 0 };
  const down = mockFetch(new Response("x", { status: 503 }), seen);
  assert.equal(await ethUsd({ fetchFn: mockFetch(okBody("2500"), seen), feedFn: feedDown, now: c.now }), 2500);
  c.advance(14 * 60_000);
  assert.equal(await ethUsd({ fetchFn: down, feedFn: feedDown, now: c.now }), 2500, "14 minutes stale still serves");
  c.advance(ETH_PRICE_TTL_MS + 1); // ~15m01s after the last good value
  assert.equal(await ethUsd({ fetchFn: down, feedFn: feedDown, now: c.now }), null, "past the bound the honest answer is unknown");
  assert.equal(ethPriceSource(), null);
  assert.equal(await ethUsd({ fetchFn: mockFetch(okBody("2600"), seen), feedFn: feedDown, now: c.now }), null, "still inside the retry TTL: no new attempt yet");
  c.advance(ETH_PRICE_TTL_MS + 1);
  assert.equal(await ethUsd({ fetchFn: down, feedFn: async () => round(2450, c.now()), now: c.now }), 2450, "recovers from either source on the next attempt");
  assert.equal(ETH_STALE_MAX_MS, 15 * 60_000);
});

test("cold start with both sources down is null, and a thrown feed read is treated like a failed one", async () => {
  resetEthPriceCache();
  const c = clock();
  const boom = async () => { throw new Error("dns down"); };
  assert.equal(await ethUsd({ fetchFn: boom, feedFn: feedDown, now: c.now }), null);
  c.advance(ETH_PRICE_TTL_MS + 1);
  assert.equal(await ethUsd({ fetchFn: boom, feedFn: async () => null, now: c.now }), null, "a null round is not a price either");
});

test("the memo never extends a stale value past the bound (CodeRabbit, PR #25)", async () => {
  resetEthPriceCache();
  const c = clock();
  const seen = { n: 0 };
  const down = mockFetch(new Response("x", { status: 503 }), seen);
  assert.equal(await ethUsd({ fetchFn: mockFetch(okBody("2500"), seen), feedFn: feedDown, now: c.now }), 2500);
  c.advance(ETH_STALE_MAX_MS - 1);
  assert.equal(await ethUsd({ fetchFn: down, feedFn: feedDown, now: c.now }), 2500, "one ms inside the bound: the stale value is served");
  c.advance(2); // now one ms past the bound, still well inside the 60s memo
  assert.equal(await ethUsd({ fetchFn: down, feedFn: feedDown, now: c.now }), null, "the TTL memo does not carry a stale value past the bound");
  assert.equal(seen.n, 3, "the bound forced a refresh attempt inside the TTL");
  assert.equal(await ethUsd({ fetchFn: down, feedFn: feedDown, now: c.now }), null);
  assert.equal(seen.n, 3, "once null, the memo applies again until the TTL lapses");
});

test("concurrent callers share one refresh, so an earlier slow attempt cannot overwrite a newer result (CodeRabbit, PR #25)", async () => {
  resetEthPriceCache();
  const c = clock();
  const seen = { n: 0 };
  let release: (r: Response) => void = () => {};
  const slow = async () => { seen.n += 1; return new Promise<Response>((res) => { release = res; }); };
  const first = ethUsd({ fetchFn: slow, feedFn: feedDown, now: c.now });
  const second = ethUsd({ fetchFn: mockFetch(okBody("9999"), seen), feedFn: feedDown, now: c.now });
  release(okBody("2500"));
  assert.deepEqual(await Promise.all([first, second]), [2500, 2500], "the second caller joined the first refresh instead of starting its own");
  assert.equal(seen.n, 1, "one network call for two concurrent callers");
  assert.equal(ethPriceSource(), "coinbase");
  c.advance(ETH_PRICE_TTL_MS + 1);
  assert.equal(await ethUsd({ fetchFn: mockFetch(okBody("2600"), seen), feedFn: feedDown, now: c.now }), 2600, "after the TTL a new refresh runs");
});

test("a Chainlink round published while Coinbase is failing is accepted, not rejected as future (PR #29)", async () => {
  resetEthPriceCache();
  const c = clock();
  const startS = Math.floor(c.now() / 1000);
  // Coinbase fails after 5s; the feed round is published 3s after the request
  // started, so it is 2s old once the fallback runs.
  const slowDown = async () => {
    c.advance(5_000);
    return new Response("x", { status: 503 });
  };
  const publishedWhileWaiting = async () => ({ answer: 244134000000n, updatedAt: startS + 3 });
  assert.equal(await ethUsd({ fetchFn: slowDown, feedFn: publishedWhileWaiting, now: c.now }), 2441.34);
  assert.equal(ethPriceSource(), "chainlink");
});
