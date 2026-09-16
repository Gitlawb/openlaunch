import assert from "node:assert/strict";
import { test } from "node:test";
import { getOrderId, type Order } from "./relay-order.ts";
import { encodeFunctionData, zeroAddress } from "viem";
import { BridgeApiError, DEPOSIT_ABI, QUOTE_TTL_MS, parseBridgeRequest, parseRelayStatus, validateRelayChains, validateRelayQuote } from "./validation.ts";
import { FIXTURE_ADDRESS, FIXTURE_INPUT, FIXTURE_NOW, FIXTURE_ORDER_ID, FIXTURE_REQUEST_ID, relayChainsFixture, relayQuoteFixture } from "./relay.fixture.ts";

const metadata = () => validateRelayChains(relayChainsFixture());
const validate = (quote: unknown) => validateRelayQuote(quote, FIXTURE_INPUT, metadata(), FIXTURE_NOW);
function setPath(value: unknown, path: string, replacement: unknown) {
  const parts = path.split(".");
  let target = value as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
  target[parts.at(-1)!] = replacement;
}
function rebind(quote: ReturnType<typeof relayQuoteFixture>) {
  const orderId = getOrderId(quote.protocol.v2.orderData as unknown as Order, metadata().vmTypes);
  quote.protocol.v2.orderId = orderId;
  quote.steps[0].items[0].data.data = encodeFunctionData({ abi: DEPOSIT_ABI, functionName: "depositNative", args: [FIXTURE_ADDRESS, orderId] });
}

test("captured native quote hashes to the independently captured order ID and normalizes ETH fees", () => {
  const fixture = relayQuoteFixture();
  assert.equal(getOrderId(fixture.protocol.v2.orderData as unknown as Order, metadata().vmTypes), FIXTURE_ORDER_ID);
  const quote = validate(fixture);
  assert.equal(quote.requestId, FIXTURE_REQUEST_ID);
  assert.equal(quote.amountOut, "9987669548275956");
  assert.equal(quote.minimumAmountOut, "9937731200534577");
  assert.equal(quote.relayFee, "0.000012330451724044");
  assert.equal(quote.sourceGas, "0.000003");
  assert.equal(quote.expiresAt, FIXTURE_NOW + QUOTE_TTL_MS);
  assert.equal(quote.ttlMs, QUOTE_TTL_MS);
  assert.deepEqual(quote.transaction, { to: fixture.steps[0].items[0].data.to, data: fixture.steps[0].items[0].data.data, value: FIXTURE_INPUT.amount, chainId: 8453 });
});

for (const [name, value] of [
  ["zero amount", { ...FIXTURE_INPUT, amount: "0" }], ["negative", { ...FIXTURE_INPUT, amount: "-1" }],
  ["fraction", { ...FIXTURE_INPUT, amount: "0.1" }], ["exponent", { ...FIXTURE_INPUT, amount: "1e18" }],
  ["uint256 overflow", { ...FIXTURE_INPUT, amount: (1n << 256n).toString() }],
  ["same chain", { ...FIXTURE_INPUT, destinationChainId: 8453 }], ["testnet", { ...FIXTURE_INPUT, destinationChainId: 46630 }],
  ["zero recipient", { ...FIXTURE_INPUT, address: zeroAddress }], ["injected recipient", { ...FIXTURE_INPUT, recipient: FIXTURE_ADDRESS }], ["null", null],
] as const) {
  test(`rejects request: ${name}`, () => assert.throws(() => parseBridgeRequest(value), (e) => e instanceof BridgeApiError && e.status === 400));
}

const orderAttacks: [string, unknown][] = [
  ["output.payments.0.recipient", "0x1111111111111111111111111111111111111111"],
  ["output.payments.0.currency", "0x1111111111111111111111111111111111111111"],
  ["output.chainId", "base"], ["inputs.0.payment.chainId", "robinhood"],
  ["inputs.0.payment.amount", "20000000000000000"], ["inputs.0.payment.currency", "0x1111111111111111111111111111111111111111"],
  ["output.payments.0.minimumAmount", "1"], ["output.deadline", Math.floor(FIXTURE_NOW / 1000)],
  ["inputs.0.refunds.0.recipient", "0x1111111111111111111111111111111111111111"],
  ["inputs.0.refunds.0.chainId", "robinhood"], ["output.extraData", "0x"],
  ["solver", "0x1111111111111111111111111111111111111111"],
];
for (const [path, value] of orderAttacks) {
  test(`rejects malicious order even when its hash and calldata are rebound: ${path}`, () => {
    const fixture = relayQuoteFixture();
    setPath(fixture.protocol.v2.orderData, path, value);
    rebind(fixture);
    assert.throws(() => validate(fixture), BridgeApiError);
  });
}

for (const [path, value] of [
  ["protocol.v2.orderId", `0x${"1".repeat(64)}`],
  ["protocol.v2.paymentDetails.depository", FIXTURE_ADDRESS],
  ["steps.0.items.0.data.to", FIXTURE_ADDRESS], ["steps.0.items.0.data.from", zeroAddress],
  ["steps.0.items.0.data.value", "10000000000000001"], ["steps.0.items.0.data.chainId", 4663],
  ["steps.0.items.0.data.data", "0x"], ["steps.0.items.0.check.endpoint", "https://attacker.example/execute"],
  ["steps.0.kind", "signature"], ["steps.0.depositAddress", FIXTURE_ADDRESS],
  ["details.recipient", zeroAddress], ["details.currencyOut.amount", "10000000000000000"],
  ["fees.app.amount", "1"], ["fees.relayer.amount", "0"], ["fees.gas.currency.chainId", 4663],
] as [string, unknown][]) {
  test(`rejects tampered quote: ${path}`, () => {
    const fixture = relayQuoteFixture(); setPath(fixture, path, value);
    assert.throws(() => validate(fixture), BridgeApiError);
  });
}

test("rejects additional transactions, output calls, input payments, and protocol fees", () => {
  for (const path of ["steps", "steps.0.items", "protocol.v2.orderData.inputs", "protocol.v2.orderData.output.calls", "protocol.v2.orderData.fees"]) {
    const fixture = relayQuoteFixture();
    setPath(fixture, path, [{}, {}]);
    assert.throws(() => validate(fixture), BridgeApiError, path);
  }
});

test("canonical metadata rejects a changed depository, missing or disabled chain", () => {
  for (const [path, value] of [["chains.0.protocol.v2.depository", FIXTURE_ADDRESS], ["chains.1.disabled", true], ["chains.1.currency.supportsBridging", false], ["chains.1.protocol.v2.chainId", "robinhood-testnet"]] as [string, unknown][]) {
    const fixture = relayChainsFixture(); setPath(fixture, path, value);
    assert.throws(() => validateRelayChains(fixture), BridgeApiError);
  }
  assert.throws(() => validateRelayChains({ chains: [relayChainsFixture().chains[0]] }), BridgeApiError);
});

test("status distinguishes refunds and delays and accepts waiting before hashes exist", () => {
  assert.deepEqual(parseRelayStatus({ status: "waiting" }), { status: "waiting", inTxHashes: [], txHashes: [] });
  assert.equal(parseRelayStatus({ status: "delayed" }).status, "delayed");
  assert.equal(parseRelayStatus({ status: "refund", txHashes: [FIXTURE_REQUEST_ID] }).status, "refund");
  assert.throws(() => parseRelayStatus({ status: "success", txHashes: ["javascript:alert(1)"] }), BridgeApiError);
  assert.throws(() => parseRelayStatus({ status: "success", destinationChainId: 1 }), BridgeApiError);
});
