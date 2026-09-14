import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BPS, DEAD, MAX_RECIPIENTS } from "./config.ts";
import { bpsToPct, buildRecipients, describeShares, isBurnAddress, pctToBps } from "./recipients.ts";

const A = "0xabc0000000000000000000000000000000000001";
const B = "0xabc0000000000000000000000000000000000002";
const ZERO = "0x0000000000000000000000000000000000000000";

test("MAX_RECIPIENTS mirrors the locker constant", () => {
  const sol = readFileSync(new URL("../../../../contracts/src/LaunchLocker.sol", import.meta.url), "utf8");
  const m = /uint256 public constant MAX_RECIPIENTS = (\d+);/.exec(sol);
  assert.ok(m, "LaunchLocker.sol must declare MAX_RECIPIENTS");
  assert.equal(Number(m![1]), MAX_RECIPIENTS);
  assert.match(sol, /uint256 public constant BPS = 10_000;/);
  assert.equal(BPS, 10_000);
});

test("pctToBps: two decimals are exact bps, anything finer or out of range is rejected", () => {
  assert.equal(pctToBps("100"), 10_000);
  assert.equal(pctToBps(" 33.33 "), 3333);
  assert.equal(pctToBps("0.01"), 1);
  assert.equal(pctToBps("5."), 500);
  assert.equal(pctToBps("10.5"), 1050);
  assert.equal(pctToBps("0"), 0);
  assert.equal(pctToBps("33.333"), null);
  assert.equal(pctToBps("100.01"), null);
  assert.equal(pctToBps("101"), null);
  assert.equal(pctToBps("-5"), null);
  assert.equal(pctToBps(""), null);
  assert.equal(pctToBps("abc"), null);
  assert.equal(pctToBps("1e2"), null);
  assert.equal(pctToBps(".5"), null);
});

test("bpsToPct round-trips without float noise", () => {
  assert.equal(bpsToPct(10_000), "100");
  assert.equal(bpsToPct(3333), "33.33");
  assert.equal(bpsToPct(1050), "10.5");
  assert.equal(bpsToPct(1), "0.01");
  assert.equal(bpsToPct(5000), "50");
  for (let bps = 1; bps <= 10_000; bps += 7) assert.equal(pctToBps(bpsToPct(bps)), bps);
});

test("buildRecipients: a valid split checksums addresses and sums to exactly 100%", () => {
  const r = buildRecipients([{ payout: A, pct: "60" }, { payout: B, pct: "40" }]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.remainingBps, 0);
  assert.equal(r.recipients.length, 2);
  assert.equal(r.recipients[0].bps, 6000);
  assert.equal(r.recipients[1].bps, 4000);
  // getAddress normalises to EIP-55 so the chain sees one canonical spelling
  assert.equal(r.recipients[0].payout.toLowerCase(), A);
  assert.notEqual(r.recipients[0].payout, A);
});

test("buildRecipients: one row at 100% is the single-beneficiary launch", () => {
  const r = buildRecipients([{ payout: A, pct: "100" }]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.recipients.map((x) => x.bps), [10_000]);
});

test("buildRecipients: a dead-address row is a burn share and passes through", () => {
  const r = buildRecipients([{ payout: A, pct: "75" }, { payout: DEAD, pct: "25" }]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.recipients[1].payout.toLowerCase(), DEAD.toLowerCase());
  assert.ok(isBurnAddress(r.recipients[1].payout));
  assert.ok(!isBurnAddress(A));
  assert.equal(describeShares(r.recipients, (a) => a.toLowerCase().slice(0, 6)), "75% to 0xabc0, 25% burned");
});

test("buildRecipients: shares that do not reach 100% report what is left, and never yield recipients", () => {
  const r = buildRecipients([{ payout: A, pct: "60" }, { payout: B, pct: "30" }]);
  assert.equal(r.remainingBps, 1000);
  assert.deepEqual(r.recipients, []);
  assert.deepEqual(r.errors, ["Beneficiaries: shares add up to 90%. 10% left to assign."]);
});

test("buildRecipients: shares over 100% say how much to remove", () => {
  const r = buildRecipients([{ payout: A, pct: "60" }, { payout: B, pct: "45.5" }]);
  assert.equal(r.remainingBps, -550);
  assert.deepEqual(r.errors, ["Beneficiaries: shares add up to 105.5%. Remove 5.5%."]);
});

test("buildRecipients: bad addresses, the zero address and duplicates are named by row", () => {
  const r = buildRecipients([
    { payout: "0x123", pct: "25" },
    { payout: ZERO, pct: "25" },
    { payout: A, pct: "25" },
    { payout: A.toUpperCase().replace("0X", "0x"), pct: "25" },
  ]);
  assert.deepEqual(r.recipients, []);
  assert.deepEqual(r.errors, [
    "Beneficiary 1: enter a valid address.",
    "Beneficiary 2: the zero address cannot receive fees. Use 0x…dEaD to burn a share.",
    "Beneficiary 4: same address as beneficiary 3. Give it one row with the combined share.",
  ]);
});

test("buildRecipients: blank, zero and too-fine shares are rejected; unparsed rows count as 0 toward the total", () => {
  const r = buildRecipients([{ payout: A, pct: "" }, { payout: B, pct: "0" }]);
  assert.equal(r.remainingBps, BPS);
  assert.deepEqual(r.errors, [
    "Beneficiary 1: share must be a percentage between 0.01 and 100, with at most two decimals.",
    "Beneficiary 2: share must be at least 0.01%.",
    "Beneficiaries: shares add up to 0%. 100% left to assign.",
  ]);
  const fine = buildRecipients([{ payout: A, pct: "33.333" }, { payout: B, pct: "66.667" }]);
  assert.equal(fine.errors.length, 3);
});

test("buildRecipients: row count is bounded by the locker", () => {
  assert.deepEqual(buildRecipients([]).errors, ["Beneficiaries: add at least one address, or choose Burn it."]);
  const rows = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => ({ payout: `0x${String(i + 1).padStart(40, "0")}`, pct: "12.5" }));
  const r = buildRecipients(rows);
  assert.equal(r.errors[0], `Beneficiaries: at most ${MAX_RECIPIENTS} addresses.`);
  assert.deepEqual(r.recipients, []);
  const seven = buildRecipients(rows.slice(0, MAX_RECIPIENTS).map((x, i) => ({ ...x, pct: i === 0 ? "25" : "12.5" })));
  assert.deepEqual(seven.errors, []);
  assert.equal(seven.recipients.length, MAX_RECIPIENTS);
});
