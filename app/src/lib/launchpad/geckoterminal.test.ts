import assert from "node:assert/strict";
import test from "node:test";
import { isChartPool, type ChartPool } from "./chart-pool.ts";
import { classifyGeckoPool, geckoChartUrl, lookupGeckoPool, GeckoRateLimitError } from "./geckoterminal.ts";

export const pool: ChartPool = { chain: "base", token: "0x" + "a".repeat(40), quote: "0x" + "0".repeat(40), poolId: "0x" + "b".repeat(64) };
export function fixture(identity = pool, price: unknown = "0.12") {
  return { data: { type: "pool", id: identity.chain + "_" + identity.poolId, attributes: { address: identity.poolId, base_token_price_usd: price },
    relationships: { base_token: { data: { type: "token", id: identity.chain + "_" + identity.token } }, quote_token: { data: { type: "token", id: identity.chain + "_" + identity.quote } } } } };
}

test("identities reject unsupported chains, external URLs and identical assets", () => {
  assert.ok(isChartPool(pool));
  for (const change of [{chain:"ethereum"}, {poolId:"https://example.com"}, {token:pool.quote}, {quote:null}, {poolId:pool.token}]) assert.equal(isChartPool({...pool,...change}), false);
});

test("matches exact pools and both token sides on Base and Robinhood, case-insensitively", () => {
  for (const chain of ["base", "robinhood"] as const) {
    const identity = {...pool, chain};
    assert.equal(classifyGeckoPool(fixture(identity), identity), "ready");
    assert.equal(classifyGeckoPool(fixture(identity), {...identity, token:identity.token.toUpperCase(), poolId:identity.poolId.toUpperCase()}), "ready");
  }
});

test("reversed listings cannot silently chart the quote token", () => {
  assert.equal(classifyGeckoPool(fixture({...pool, token:pool.quote, quote:pool.token}), pool), "inverted");
});

test("missing or invalid USD pricing falls back without claiming there are no trades", () => {
  for (const value of [null, undefined, "", "0", "-1", "Infinity", "NaN", {}, true]) {
    const payload = fixture(); payload.data.attributes.base_token_price_usd = value;
    assert.equal(classifyGeckoPool(payload,pool),"unpriced");
  }
});

test("malformed responses and wrong identities are errors, not missing listings", () => {
  for (const payload of [{}, {data:null}, {data:[]}, fixture({...pool,chain:"robinhood"}),fixture({...pool,poolId:"0x"+"c".repeat(64)}),fixture({...pool,quote:"0x"+"c".repeat(40)})]) assert.throws(()=>classifyGeckoPool(payload,pool));
});

test("embed uses official grayscale, theme, canvas, metric and resolution options with intact attribution", () => {
  for (const theme of ["dark","light"] as const) {
    const url = new URL(geckoChartUrl(pool,theme,{interval:"15m",metric:"price"}));
    assert.equal(url.origin,"https://www.geckoterminal.com");
    assert.equal(url.pathname,"/base/pools/"+pool.poolId);
    assert.equal(url.searchParams.get("bg_color"),theme==="dark"?"000000":"fafaf8");
    assert.equal(url.searchParams.get("light_chart"),theme==="dark"?"0":"1");
    assert.equal(url.searchParams.get("grayscale"),"1");
    assert.equal(url.searchParams.get("resolution"),"15m");
    assert.equal(url.searchParams.get("chart_type"),"price");
    assert.equal(url.searchParams.get("info"),"0");
    assert.equal(url.searchParams.get("swaps"),"0");
  }
  assert.equal(new URL(geckoChartUrl(pool,"dark")).search,"");
  assert.throws(()=>geckoChartUrl({...pool,poolId:"//evil.test"},"dark"));
});

test("lookup uses a fixed origin, times out, distinguishes 404, and respects throttling", async () => {
  const request = async (url: unknown, init?: RequestInit) => {
    assert.equal(url,"https://api.geckoterminal.com/api/v2/networks/base/pools/"+pool.poolId);
    assert.equal(init?.redirect,"error"); assert.equal(init?.cache,"no-store");
    assert.ok(init?.signal); return Response.json(fixture());
  };
  assert.equal(await lookupGeckoPool(pool,request as typeof fetch),"ready");
  assert.equal(await lookupGeckoPool(pool,(async()=>new Response(null,{status:404})) as typeof fetch),"unlisted");
  await assert.rejects(lookupGeckoPool(pool,(async()=>new Response(null,{status:429})) as typeof fetch),GeckoRateLimitError);
  await assert.rejects(lookupGeckoPool(pool,(async()=>new Response(null,{status:500})) as typeof fetch));
});
