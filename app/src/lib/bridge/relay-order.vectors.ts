import type { Order } from "./relay-order";

export const VECTOR_VM_TYPES = {
  base: "ethereum-vm", robinhood: "ethereum-vm", ethereum: "ethereum-vm",
};

// Deterministic protocol-level vectors intentionally include non-native currencies,
// calls, fees, and multiple payments. The bridge validator rejects those features;
// the hashing primitive must nevertheless preserve every upstream field exactly.
export function evmOrderVector(index: number): Order {
  const chains = ["base", "robinhood", "ethereum"];
  const address = (offset: number) => {
    const hex = ((BigInt(index + 1) << 120n) + BigInt(offset + 1) * 0xabcdef12345n).toString(16).padStart(40, "0");
    return `0x${index % 2 ? hex.toUpperCase() : hex}`;
  };
  const bytes = (offset: number) => `0x${"Ab12cdEF".repeat((index + offset) % 9)}`;
  const amount = (offset: number) => (
    index % 16 === 0 ? (1n << 256n) - 1n - BigInt(offset) :
      index % 16 === 1 ? BigInt(offset) : (BigInt(index + 1) << BigInt(index % 192)) + BigInt(offset)
  ).toString();
  const deadline = index % 4 === 0 ? 0 : index % 4 === 1 ? 0xffffffff : 1_790_141_517 + index;
  return {
    version: "v1",
    solverChainId: chains[index % 3],
    solver: address(0).toLowerCase(),
    salt: `0x${BigInt(index + 1).toString(16).padStart(64, "0")}`,
    inputs: Array.from({ length: 1 + index % 3 }, (_, input) => ({
      payment: { chainId: chains[(index + input) % 3], currency: address(10 + input), amount: amount(input), weight: String(input + 1) },
      refunds: Array.from({ length: index % 4 }, (_, refund) => ({
        chainId: chains[(index + refund) % 3], recipient: address(20 + refund), currency: address(30 + refund),
        minimumAmount: amount(refund + 1), deadline, extraData: bytes(refund),
      })),
    })),
    output: {
      chainId: chains[(index + 1) % 3],
      payments: Array.from({ length: 1 + index % 4 }, (_, payment) => ({
        recipient: address(40 + payment), currency: address(50 + payment),
        minimumAmount: amount(payment + 2), expectedAmount: amount(payment + 1),
      })),
      calls: Array.from({ length: index % 3 }, (_, call) => bytes(call)), deadline, extraData: bytes(3),
    },
    fees: Array.from({ length: index % 3 }, (_, fee) => ({
      recipientChainId: chains[(index + fee) % 3], recipient: address(60 + fee),
      currencyChainId: chains[(index + fee + 1) % 3], currency: address(70 + fee), amount: amount(fee + 3),
    })),
  };
}
