import assert from "node:assert/strict";
import test from "node:test";
import { formatFeeWarningPercent } from "./fee-display";

test("warning percentages are compact while retaining just-over-limit meaning", () => {
  assert.equal(formatFeeWarningPercent("5.5548"), "5.55");
  assert.equal(formatFeeWarningPercent("6"), "6");
  assert.equal(formatFeeWarningPercent("22.279"), "22.28");
  assert.equal(formatFeeWarningPercent("5.000001"), ">5");
  assert.equal(formatFeeWarningPercent("-5.000000000000000001"), ">5");
  assert.equal(formatFeeWarningPercent("-12.1234567890123456789012345678"), "12.12");
  assert.equal(formatFeeWarningPercent("5.0000"), "5");
});
