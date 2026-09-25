import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCustomMcapInput, resolveFirstBuyInput, sanitizeDecimalInput } from "./decimal-input.ts";

test("plain decimals pass through", () => {
  assert.equal(sanitizeDecimalInput(""), "");
  assert.equal(sanitizeDecimalInput("0"), "0");
  assert.equal(sanitizeDecimalInput("1.5"), "1.5");
  assert.equal(sanitizeDecimalInput(".5"), ".5");
  assert.equal(sanitizeDecimalInput("007"), "007");
});

test("scientific notation is rejected, never corrupted into a tradable size", () => {
  assert.equal(sanitizeDecimalInput("1e-7"), "", "must not become 17 (~1e8x the intent)");
  assert.equal(sanitizeDecimalInput("1E21"), "", "must not become 121");
  assert.equal(sanitizeDecimalInput("2.5e3"), "");
  assert.equal(sanitizeDecimalInput("e"), "");
  assert.equal(sanitizeDecimalInput("1 e-7"), "", "a space before the exponent must not make it 17");
  assert.equal(sanitizeDecimalInput("1,000e3"), "", "grouping before the exponent too");
  assert.equal(sanitizeDecimalInput("1e"), "", "an exponent being typed is rejected, not silently dropped");
});

test("grouping, currency and whitespace are stripped; only the first dot survives", () => {
  assert.equal(sanitizeDecimalInput("1,234.5"), "1234.5");
  assert.equal(sanitizeDecimalInput(" 3.5 "), "3.5");
  assert.equal(sanitizeDecimalInput("$12.25"), "12.25");
  assert.equal(sanitizeDecimalInput("1..2"), "1.2");
  assert.equal(sanitizeDecimalInput("1.2.3"), "1.23", "extra dots are dropped, digits kept");
  assert.equal(sanitizeDecimalInput("abc1.5"), "1.5");
  assert.equal(sanitizeDecimalInput("12 USD"), "12");
  // "ETH" carries an E: a unit after a space is not an exponent, so the amount survives
  assert.equal(sanitizeDecimalInput("0.5 ETH"), "0.5");
  assert.equal(sanitizeDecimalInput("1.5eth"), "1.5", "a unit word right after the number is not an exponent");
  assert.equal(sanitizeDecimalInput("1.e5"), "", "an exponent right after the dot is still rejected");
});

test("resolveCustomMcapInput clears the preset pick when the entry sanitizes to empty", () => {
  assert.deepEqual(resolveCustomMcapInput("1e-7"), { value: "", clearPick: true }, "rejected entry must not fall back to the old preset cap");
  assert.deepEqual(resolveCustomMcapInput("25000"), { value: "25000", clearPick: false });
  assert.deepEqual(resolveCustomMcapInput(""), { value: "", clearPick: false }, "clearing the field is not a rejection");
  assert.deepEqual(resolveCustomMcapInput("   "), { value: "", clearPick: false });
});

test("resolveFirstBuyInput: a rejected entry keeps the shown amount; only clearing declines", () => {
  assert.deepEqual(resolveFirstBuyInput("0.05"), { kind: "choose", value: "0.05" });
  assert.deepEqual(resolveFirstBuyInput("0.5 ETH"), { kind: "choose", value: "0.5" });
  assert.deepEqual(resolveFirstBuyInput("1e-7"), { kind: "ignore" }, "never launch without the buy because a paste was rejected");
  assert.deepEqual(resolveFirstBuyInput("1 e-7"), { kind: "ignore" });
  assert.deepEqual(resolveFirstBuyInput(""), { kind: "decline" });
  assert.deepEqual(resolveFirstBuyInput("  "), { kind: "decline" });
});
