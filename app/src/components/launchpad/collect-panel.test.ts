import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./CollectPanel.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/t/[chain]/[token]/page.tsx", import.meta.url), "utf8");

// Every collect pays beneficiaries both pool currencies: the quote and the launched token.
test("the token page hands the fee panel both sides of the collected and burned totals", () => {
  for (const prop of ["token={l.token as Address}", "collectedQuote={l.fees_quote_collected}", "collectedToken={l.fees_token_collected}", "burnedQuote={l.fees_quote_burned}", "burnedToken={l.fees_token_burned}"]) {
    assert.ok(page.includes(prop), prop);
  }
});

test("the fee panel shows collected, burned and paid amounts for both currencies, no USD estimate", () => {
  assert.match(source, /ft\(isBurnOnly \? burned\.token : collected\.token\)/);
  assert.match(source, /fq\(burned\.quote\)/);
  assert.match(source, /ft\(burned\.token\)/);
  assert.match(source, /Paid to beneficiaries/);
  assert.match(source, /\{fq\(toPeople\.quote\)\}.*\{ft\(toPeople\.token\)\}/);
  assert.doesNotMatch(source, /fmtUsd|feeSidesUsd|quoteUsd|≈/);
});

test("one Claim button withdraws every credited currency", () => {
  assert.match(source, /\[quote\.address, token\]\.map\(\(currency\)/);
  assert.match(source, /functionName: "claimable" as const/);
  assert.equal(source.match(/void send\("claim"/g)?.length, 1, "exactly one claim button");
  assert.match(source, /onClick=\{\(\) => void send\("claim", claims\.map\(\(c\) => c\.currency\)\)\}/);
  assert.match(source, /for \(const currency of what === "collect" \? \[null\] : currencies\)/);
  assert.match(source, /functionName: "claim", args: \[currency\], account: address/);
  // each transaction is confirmed before the next one is sent
  assert.match(source, /for \(const currency of what === "collect" \? \[null\] : currencies\) \{[\s\S]*waitForTransactionReceipt\(\{ hash \}\)[\s\S]*Transaction reverted on-chain\.[\s\S]*\n      \}/);
  assert.match(source, /Claim \$\{claims\.map\(\(c\) => c\.label\(c\.raw\)\)\.join\(" \+ "\)\}/);
});

test("pending feedback stays on the button whose transaction was sent", () => {
  assert.match(source, /\{ k: "sent"; hash: Hex; what: "collect" \| "claim" \}/);
  assert.match(source, /phase\.k === "sent" && phase\.what === "collect" \? <><Spinner size=\{13\} \/> Confirming…/);
  assert.match(source, /phase\.k === "sent" && phase\.what === "claim" \? <><Spinner size=\{13\} \/> Confirming…/);
});
