import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSlippageBps, formatSlippageBps, getSlippageBps, getSlippageBpsServer, parseSlippageField, parseSlippageInput, SLIPPAGE_DEFAULT_BPS, SLIPPAGE_MAX_BPS, SLIPPAGE_MIN_BPS, SLIPPAGE_PRESETS_BPS, loadSlippageBps, setSlippageBps, slippageStorageKey, subscribeSlippage } from "./trade-slippage.ts";

test("presets include the old 1% default", () => {
  assert.ok(SLIPPAGE_PRESETS_BPS.includes(SLIPPAGE_DEFAULT_BPS));
  assert.deepEqual([...SLIPPAGE_PRESETS_BPS], [50, 100, 300]);
});

test("clampSlippageBps bounds garbage to the default and rounds", () => {
  assert.equal(clampSlippageBps(100), 100);
  assert.equal(clampSlippageBps(150.4), 150);
  assert.equal(clampSlippageBps(1), SLIPPAGE_MIN_BPS, "below 0.1% clamps up");
  assert.equal(clampSlippageBps(0), SLIPPAGE_MIN_BPS, "0% clamps up (exact-out would always revert)");
  assert.equal(clampSlippageBps(-5), SLIPPAGE_MIN_BPS, "negative clamps up");
  assert.equal(clampSlippageBps(99_999), SLIPPAGE_MAX_BPS, "above 20% clamps down");
  for (const bad of [NaN, Infinity, null, undefined, "abc", ""]) assert.equal(clampSlippageBps(bad), SLIPPAGE_DEFAULT_BPS, `${String(bad)} → default`);
  assert.equal(clampSlippageBps("300"), 300, "stored strings parse");
});

test("parseSlippageInput takes percent strings, rejects junk", () => {
  assert.equal(parseSlippageInput("1"), 100);
  assert.equal(parseSlippageInput("0.5"), 50);
  assert.equal(parseSlippageInput("0.1"), 10, "minimum is selectable");
  assert.equal(parseSlippageInput("3%"), 300);
  assert.equal(parseSlippageInput(" 2.5 % "), 250);
  for (const bad of ["", "  ", "0", "0.01", "0.09", "-1", "abc", "1%%", "21", "100"]) assert.equal(parseSlippageInput(bad), null, `${JSON.stringify(bad)} rejected`);
});

test("parseSlippageField validates raw input: comma is a decimal, minus/letters are rejected (PR #30)", () => {
  assert.equal(parseSlippageField("0.5"), 50);
  assert.equal(parseSlippageField("0,5"), 50, "decimal comma (mobile keyboards) normalizes to a dot");
  assert.equal(parseSlippageField("0,5%"), 50);
  assert.equal(parseSlippageField("1"), 100);
  assert.equal(parseSlippageField("-3"), null, "minus must not strip into a valid tolerance");
  assert.equal(parseSlippageField("0,5".replace(".", ",")), 50);
  for (const bad of ["0,5x", "a1", "1a", "--3", ""]) {
    if (bad === "") { assert.equal(parseSlippageField(bad), null); continue; }
    assert.equal(parseSlippageField(bad), null, `${JSON.stringify(bad)} keeps the previous tolerance`);
  }
  // The old handler stripped to "05" (5%); the field parser must not do that.
  assert.notEqual(parseSlippageField("0,5"), 500);
});

test("formatSlippageBps trims cleanly", () => {
  assert.equal(formatSlippageBps(100), "1%");
  assert.equal(formatSlippageBps(50), "0.5%");
  assert.equal(formatSlippageBps(250), "2.5%");
  assert.equal(formatSlippageBps(33), "0.33%");
});

test("storage key is per-chain; node (no localStorage) loads the default", () => {
  assert.equal(slippageStorageKey("base"), "ol:slippage-bps:base");
  assert.notEqual(slippageStorageKey("base"), slippageStorageKey("robinhood"));
  assert.equal(loadSlippageBps("base"), SLIPPAGE_DEFAULT_BPS);
});

test("bounds constants are sane", () => {
  assert.equal(SLIPPAGE_MIN_BPS, 10, "0.1%");
  assert.equal(SLIPPAGE_MAX_BPS, 2000, "20%");
});

test("external store: server snapshot is the default; set notifies subscribers", () => {
  assert.equal(getSlippageBpsServer(), SLIPPAGE_DEFAULT_BPS);
  let calls = 0;
  const unsub = subscribeSlippage(() => { calls += 1; });
  setSlippageBps("base", 300);
  assert.equal(getSlippageBps("base"), 300);
  assert.equal(calls, 1);
  setSlippageBps("base", 999_999);
  assert.equal(getSlippageBps("base"), SLIPPAGE_MAX_BPS, "store clamps like the input");
  assert.equal(calls, 2);
  unsub();
  setSlippageBps("base", 100);
  assert.equal(calls, 2, "unsubscribed");
  assert.equal(getSlippageBps("base"), 100);
});
