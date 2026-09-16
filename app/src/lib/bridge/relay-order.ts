import "server-only";
import { hashStruct, hexToBytes, type Hex } from "viem";

// EVM/v1-only extraction of @relay-protocol/settlement-sdk 0.0.143.
// Copyright (c) Uneven Labs. MIT license and exact provenance: relay-order.NOTICE.md.
// Keep the upstream schema, normalization, and hashStruct algorithm in sync as a
// reviewed unit. This is NOT hashTypedData: Relay order IDs have no domain hash.
export type Order = {
  version: "v1";
  solverChainId: string;
  solver: string;
  salt: string;
  inputs: {
    payment: { chainId: string; currency: string; amount: string; weight: string };
    refunds: {
      chainId: string;
      recipient: string;
      currency: string;
      minimumAmount: string;
      deadline: number;
      extraData: string;
    }[];
  }[];
  output: {
    chainId: string;
    payments: {
      recipient: string;
      currency: string;
      minimumAmount: string;
      expectedAmount: string;
    }[];
    calls: string[];
    deadline: number;
    extraData: string;
  };
  fees: {
    recipientChainId: string;
    recipient: string;
    currencyChainId: string;
    currency: string;
    amount: string;
  }[];
};

export const ORDER_EIP712_TYPES = {
  Order: [
    { name: "version", type: "string" },
    { name: "solverChainId", type: "string" },
    { name: "solver", type: "address" },
    { name: "salt", type: "uint256" },
    { name: "inputs", type: "Input[]" },
    { name: "output", type: "Output" },
    { name: "fees", type: "Fee[]" },
  ],
  Input: [
    { name: "payment", type: "InputPayment" },
    { name: "refunds", type: "InputRefund[]" },
  ],
  InputPayment: [
    { name: "chainId", type: "string" },
    { name: "currency", type: "bytes" },
    { name: "amount", type: "uint256" },
    { name: "weight", type: "uint256" },
  ],
  InputRefund: [
    { name: "chainId", type: "string" },
    { name: "recipient", type: "bytes" },
    { name: "currency", type: "bytes" },
    { name: "minimumAmount", type: "uint256" },
    { name: "deadline", type: "uint32" },
    { name: "extraData", type: "bytes" },
  ],
  Output: [
    { name: "chainId", type: "string" },
    { name: "payments", type: "OutputPayment[]" },
    { name: "deadline", type: "uint32" },
    { name: "calls", type: "bytes[]" },
    { name: "extraData", type: "bytes" },
  ],
  OutputPayment: [
    { name: "recipient", type: "bytes" },
    { name: "currency", type: "bytes" },
    { name: "minimumAmount", type: "uint256" },
    { name: "expectedAmount", type: "uint256" },
  ],
  Fee: [
    { name: "recipientChainId", type: "string" },
    { name: "recipient", type: "bytes" },
    { name: "currencyChainId", type: "string" },
    { name: "currency", type: "bytes" },
    { name: "amount", type: "uint256" },
  ],
};

type ChainIdToVmType = Record<string, string>;
const getChainVmType = (chainId: string, chainsConfig: ChainIdToVmType) => {
  if (!Object.hasOwn(chainsConfig, chainId) || chainsConfig[chainId] !== "ethereum-vm") {
    throw new Error(`Unsupported EVM order chain ${chainId}`);
  }
  return chainsConfig[chainId];
};
const _toHexString = (arr: Uint8Array): Hex => `0x${Buffer.from(arr).toString("hex")}`;
const encodeBytesToHex = (bytes: string) => _toHexString(hexToBytes(bytes as Hex));
const encodeAddressToHex = (address: string, vmType: string) => {
  if (vmType !== "ethereum-vm") throw new Error("Unsupported vm type");
  const encoded = hexToBytes(address as Hex);
  if (encoded.length !== 20) {
    throw new Error(`Invalid ethereum-vm address byte length ${encoded.length}; expected 20`);
  }
  return _toHexString(encoded);
};

export const normalizeOrder = (order: Order, chainsConfig: ChainIdToVmType) => {
  // Local scope guards only; the normalization below is the upstream v1 algorithm.
  if (order.version !== "v1") throw new Error("Unsupported Relay order version");
  const vmType = (chainId: string) => getChainVmType(chainId, chainsConfig);
  vmType(order.solverChainId);
  vmType(order.output.chainId);
  return {
    version: order.version,
    solverChainId: order.solverChainId,
    solver: order.solver,
    salt: order.salt,
    inputs: order.inputs.map((input) => ({
      payment: {
        chainId: input.payment.chainId,
        currency: encodeAddressToHex(input.payment.currency, vmType(input.payment.chainId)),
        amount: input.payment.amount,
        weight: input.payment.weight,
      },
      refunds: input.refunds.map((refund) => ({
        chainId: refund.chainId,
        recipient: encodeAddressToHex(refund.recipient, vmType(refund.chainId)),
        currency: encodeAddressToHex(refund.currency, vmType(refund.chainId)),
        minimumAmount: refund.minimumAmount,
        deadline: refund.deadline,
        extraData: encodeBytesToHex(refund.extraData),
      })),
    })),
    output: {
      chainId: order.output.chainId,
      payments: order.output.payments.map((payment) => ({
        recipient: encodeAddressToHex(payment.recipient, vmType(order.output.chainId)),
        currency: encodeAddressToHex(payment.currency, vmType(order.output.chainId)),
        minimumAmount: payment.minimumAmount,
        expectedAmount: payment.expectedAmount,
      })),
      calls: order.output.calls.map(encodeBytesToHex),
      deadline: order.output.deadline,
      extraData: encodeBytesToHex(order.output.extraData),
    },
    fees: order.fees.map((fee) => ({
      recipientChainId: fee.recipientChainId,
      recipient: encodeAddressToHex(fee.recipient, vmType(fee.recipientChainId)),
      currencyChainId: fee.currencyChainId,
      currency: encodeAddressToHex(fee.currency, vmType(fee.currencyChainId)),
      amount: fee.amount,
    })),
  };
};

export const getOrderId = (order: Order, config: ChainIdToVmType) => {
  return hashStruct({
    types: ORDER_EIP712_TYPES,
    primaryType: "Order",
    data: normalizeOrder(order, config),
  });
};
