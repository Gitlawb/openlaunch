import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_STOCKS, BASE_STOCK_MAX_FEED_AGE_S, baseStockByAddress, feedUsd, isB20Address, isB20RpcError, parseRoundData, responseHasB20Error, searchBaseStocks, stockTileSvg, underlyingTicker } from "./baseStocks.ts";

test("registry: 13 Coinbase stocks, unique lowercase B20 addresses, unique checksummed feeds, 8 decimals", () => {
  assert.equal(BASE_STOCKS.length, 13);
  const addrs = new Set(BASE_STOCKS.map((s) => s.address));
  const feeds = new Set(BASE_STOCKS.map((s) => s.feed.toLowerCase()));
  assert.equal(addrs.size, 13);
  assert.equal(feeds.size, 13);
  for (const s of BASE_STOCKS) {
    assert.equal(s.address, s.address.toLowerCase(), `${s.symbol} address stored lowercase`);
    assert.ok(isB20Address(s.address), `${s.symbol} is a B20 address`);
    assert.match(s.feed, /^0x[0-9a-fA-F]{40}$/);
    assert.ok(!isB20Address(s.feed), "feed is a normal contract");
    assert.equal(s.decimals, 8);
    assert.match(s.symbol, /^[A-Z]{3,5}c$/);
  }
});

test("baseStockByAddress is case-insensitive and rejects unknown/lookalike addresses", () => {
  assert.equal(baseStockByAddress("0xb20000000000000000000078ee7ce2fE4908108C")?.symbol, "NVDAc");
  assert.equal(baseStockByAddress("0xB20000000000000000000078EE7CE2FE4908108C")?.symbol, "NVDAc");
  assert.equal(baseStockByAddress("0xb20000000000000000000078ee7ce2fe4908108d"), null, "one nibble off");
  assert.equal(baseStockByAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"), null, "USDG is not a stock");
});

test("isB20Address: prefix only, never a stock decision", () => {
  assert.equal(isB20Address("0xb200000000000000000000ffffffffffffffffff"), true, "unknown B20 → shape ok, registry says no");
  assert.equal(baseStockByAddress("0xb200000000000000000000ffffffffffffffffff"), null);
  assert.equal(isB20Address("0xb2000000000000000000000000000000000000000"), false, "41 chars");
  assert.equal(isB20Address("0x0000000000000000000000000000000000000000"), false);
});

test("searchBaseStocks: prefix on ticker, then name substring, $ tolerated, capped", () => {
  assert.deepEqual(searchBaseStocks("nvda").map((s) => s.symbol), ["NVDAc"]);
  assert.deepEqual(searchBaseStocks("$TSLA").map((s) => s.symbol), ["TSLAc"]);
  assert.deepEqual(searchBaseStocks("apple").map((s) => s.symbol), ["AAPLc"]);
  assert.equal(searchBaseStocks("").length, 12, "empty query lists up to the cap");
  assert.equal(searchBaseStocks("zzz").length, 0);
});

test("parseRoundData decodes latestRoundData words and negative answers", () => {
  const w = (n: bigint) => (n < 0n ? (n + (1n << 256n)).toString(16) : n.toString(16)).padStart(64, "0");
  const hex = "0x" + w(1n) + w(22996000000n) + w(1_700_000_000n) + w(1_700_000_100n) + w(1n);
  assert.deepEqual(parseRoundData(hex), { answer: 22996000000n, updatedAt: 1_700_000_100 });
  assert.equal(parseRoundData("0x" + w(1n) + w(-5n) + w(0n) + w(1n) + w(1n))?.answer, -5n);
  assert.equal(parseRoundData("0x1234"), null);
});

test("feedUsd: 8-dec answer → USD; stale, future, zero or negative → null", () => {
  const now = 1_700_100_000;
  assert.equal(feedUsd({ answer: 22996000000n, updatedAt: now - 3600 }, now), 229.96);
  assert.equal(feedUsd({ answer: 22996000000n, updatedAt: now - 2 * 24 * 3600 }, now), 229.96, "weekend hold is fine");
  assert.equal(feedUsd({ answer: 22996000000n, updatedAt: now - BASE_STOCK_MAX_FEED_AGE_S - 1 }, now), null, "too old");
  assert.equal(feedUsd({ answer: 22996000000n, updatedAt: now + 60 }, now), null, "future round (clock skew / bad RPC) is not a price");
  assert.equal(feedUsd({ answer: 22996000000n, updatedAt: now + BASE_STOCK_MAX_FEED_AGE_S }, now), null, "far-future round is not a price either");
  assert.equal(feedUsd({ answer: 0n, updatedAt: now }, now), null);
  assert.equal(feedUsd({ answer: -1n, updatedAt: now }, now), null);
  assert.equal(feedUsd(null, now), null);
});

test("B20 RPC error detection (single + batch)", () => {
  assert.equal(isB20RpcError("EVM error OpcodeNotFound"), true);
  assert.equal(isB20RpcError("execution reverted"), false);
  assert.equal(isB20RpcError(undefined), false);
  assert.equal(responseHasB20Error({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "EVM error OpcodeNotFound" } }), true);
  assert.equal(responseHasB20Error([{ id: 1, result: "0x" }, { id: 2, error: { message: "EVM error OpcodeNotFound" } }]), true);
  assert.equal(responseHasB20Error([{ id: 1, result: "0x" }, { id: 2, error: { message: "execution reverted" } }]), false);
  assert.equal(responseHasB20Error({ id: 1, result: "0x" }), false);
  assert.equal(responseHasB20Error(null), false);
});

test("stockTileSvg: inline SVG data URL, blue tile, underlying ticker, safe against odd input", () => {
  const u = stockTileSvg("NVDAc");
  assert.ok(u.startsWith("data:image/svg+xml,"));
  const svg = decodeURIComponent(u.slice("data:image/svg+xml,".length));
  assert.ok(svg.includes('fill="#0052FF"'), "Base blue");
  assert.ok(svg.includes(">NVDA<"), "underlying ticker, no trailing c");
  assert.equal(underlyingTicker("GOOGLc"), "GOOGL");
  for (const s of BASE_STOCKS) assert.ok(decodeURIComponent(stockTileSvg(s.symbol)).includes(`>${underlyingTicker(s.symbol)}<`), s.symbol);
  assert.ok(decodeURIComponent(stockTileSvg("<script>c")).includes(">SCRIP<"), "markup stripped (and capped at 5), never injected");
  assert.ok(decodeURIComponent(stockTileSvg("")).includes(">?<"));
  assert.ok(u.length < 600, "small enough to inline everywhere");
});
