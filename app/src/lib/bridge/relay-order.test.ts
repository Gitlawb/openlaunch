import assert from "node:assert/strict";
import { test } from "node:test";
import { getOrderId, normalizeOrder, type Order } from "./relay-order.ts";
import { SDK_0_0_143_ORDER_IDS } from "./relay-order.golden.ts";
import { evmOrderVector, VECTOR_VM_TYPES } from "./relay-order.vectors.ts";
import { FIXTURE_ORDER_ID, relayQuoteFixture } from "./relay.fixture.ts";

test("EVM v1 hashes match 256 golden outputs captured from official settlement-sdk 0.0.143", () => {
  assert.equal(SDK_0_0_143_ORDER_IDS.length, 256);
  SDK_0_0_143_ORDER_IDS.forEach((expected, index) => {
    assert.equal(getOrderId(evmOrderVector(index), VECTOR_VM_TYPES), expected, `SDK vector ${index}`);
  });
});

test("captured real native ETH order retains its provider order ID", () => {
  assert.equal(getOrderId(relayQuoteFixture().protocol.v2.orderData as Order, VECTOR_VM_TYPES), FIXTURE_ORDER_ID);
});

test("EVM address normalization remains 20 bytes with no padding or endian changes", () => {
  const order = evmOrderVector(1);
  order.output.payments[0].recipient = "0x0123456789AbCdEf0123456789AbCdEf01234567";
  order.output.extraData = "0xAbCdEf01";
  const result = normalizeOrder(order, VECTOR_VM_TYPES);
  assert.equal(result.output.payments[0].recipient, "0x0123456789abcdef0123456789abcdef01234567");
  assert.equal(result.output.payments[0].recipient.length, 42);
  assert.equal(result.output.extraData, "0xabcdef01");
  assert.equal(result.solver, order.solver);
  assert.equal(result.solverChainId, order.solverChainId);
});

for (const length of [0, 19, 21, 32]) {
  test(`rejects a ${length}-byte EVM address`, () => {
    const order = evmOrderVector(1);
    order.output.payments[0].recipient = `0x${"ab".repeat(length)}`;
    assert.throws(() => getOrderId(order, VECTOR_VM_TYPES), /Invalid ethereum-vm address byte length/);
  });
}

test("rejects unsupported versions instead of silently hashing a new schema", () => {
  for (const version of ["v0", "v2", "", undefined]) {
    const order = { ...evmOrderVector(1), version } as Order;
    assert.throws(() => getOrderId(order, VECTOR_VM_TYPES), /Unsupported Relay order version/);
  }
});

test("rejects non-EVM, unknown, and inherited chain configurations", () => {
  const order = evmOrderVector(2);
  for (const chain of Object.keys(VECTOR_VM_TYPES)) {
    assert.throws(() => getOrderId(order, { ...VECTOR_VM_TYPES, [chain]: "solana-vm" }), /Unsupported EVM order chain/);
    assert.throws(() => getOrderId(order, { ...VECTOR_VM_TYPES, [chain]: "gateway-vm" }), /Unsupported EVM order chain/);
  }
  assert.throws(() => getOrderId(order, {}), /Unsupported EVM order chain/);
  assert.throws(() => getOrderId(order, Object.create(VECTOR_VM_TYPES)), /Unsupported EVM order chain/);
});

test("non-EVM output is rejected even when no payments reference it", () => {
  const order = evmOrderVector(0);
  order.output.payments = [];
  assert.throws(() => getOrderId(order, { ...VECTOR_VM_TYPES, robinhood: "solana-vm" }), /Unsupported EVM order chain/);
});
