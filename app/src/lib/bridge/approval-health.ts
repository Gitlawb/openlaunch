import { TransactionNotFoundError, type Address, type Hex } from "viem";
import { isMatchingApprovalTransaction, type TrackedApproval } from "./approval";

export type ApprovalHealth = {
  kind: "waiting" | "not-seen" | "queued" | "fee-too-low" | "nonce-passed" | "delayed" | "unavailable";
  title: string;
  detail: string;
};

type PendingTransaction = { hash: Hex; from: Address; to: Address | null; input: Hex; value: bigint; nonce: number; maxFeePerGas?: bigint; gasPrice?: bigint };
type ApprovalHealthClient = {
  getTransaction: (args: { hash: Hex }) => Promise<PendingTransaction>;
  getTransactionCount: (args: { address: Address; blockTag: "latest" }) => Promise<number>;
  getBlock: (args: { blockTag: "latest" }) => Promise<{ baseFeePerGas: bigint | null }>;
};

export const APPROVAL_HEALTH_UNAVAILABLE: ApprovalHealth = {
  kind: "unavailable", title: "Approval status unavailable",
  detail: "The network could not provide transaction details. Checking will retry. Check your wallet’s activity before taking any action; do not approve again.",
};

/** Advice only: never changes the journal, confirms an approval or permits a retry. */
export function describePendingApproval(input: { createdAt: number; now: number; transaction: Pick<PendingTransaction, "nonce" | "maxFeePerGas" | "gasPrice"> | null; latestNonce?: number; baseFeePerGas?: bigint | null }): ApprovalHealth {
  const delayed = input.now - input.createdAt >= 60_000;
  const waiting: ApprovalHealth = { kind: "waiting", title: "Approval submitted", detail: "Waiting for a confirmation. You’ll review a fresh bridge quote next." };
  if (!input.transaction) return delayed ? {
    kind: "not-seen", title: "Approval not found by the network",
    detail: "This network node cannot find the saved transaction. It may still be queued in your wallet, dropped, or replaced. Check your wallet’s activity; do not approve again just because it is missing here.",
  } : waiting;
  const { nonce, maxFeePerGas, gasPrice } = input.transaction;
  if (!Number.isSafeInteger(nonce) || nonce < 0 || !Number.isSafeInteger(input.latestNonce) || input.latestNonce! < 0) return APPROVAL_HEALTH_UNAVAILABLE;
  if (nonce > input.latestNonce!) return {
    kind: "queued", title: "Waiting for an earlier transaction",
    detail: `This approval uses nonce ${nonce}, but your wallet’s next confirmed nonce is ${input.latestNonce}. Check the earliest pending transaction in your wallet on this network. Later transactions cannot confirm first.`,
  };
  if (nonce < input.latestNonce!) return {
    kind: "nonce-passed", title: "Check your wallet’s transaction history",
    detail: "This nonce has already been used, but the saved approval has no receipt. It may have been replaced, or the node may be catching up. If you sped it up, verify the confirmed replacement hash below.",
  };
  const feeCap = maxFeePerGas ?? gasPrice;
  if (feeCap !== undefined && input.baseFeePerGas != null && feeCap < input.baseFeePerGas) return {
    kind: "fee-too-low", title: "Approval fee is below the network fee",
    detail: "The submitted transaction’s fee cap is below the current base fee. Review its fee in your wallet. If you choose to speed it up, return with the confirmed replacement hash; do not create a second approval.",
  };
  return delayed ? { kind: "delayed", title: "Approval is taking longer than expected", detail: "The network can see the transaction, but it has not confirmed. Check its status and fee in your wallet. If you sped it up, verify the confirmed replacement hash below." } : waiting;
}

/** Optional diagnostics. A failed RPC read is not evidence that a transaction is missing. */
export async function readPendingApprovalHealth(client: ApprovalHealthClient, approval: TrackedApproval, now: number): Promise<ApprovalHealth> {
  if (!approval.approvalHash) return APPROVAL_HEALTH_UNAVAILABLE;
  try {
    const transaction = await client.getTransaction({ hash: approval.approvalHash }).catch((error: unknown) => {
      if (error instanceof TransactionNotFoundError) return null;
      throw error;
    });
    if (!transaction) return describePendingApproval({ createdAt: approval.createdAt, now, transaction });
    if (transaction.hash.toLowerCase() !== approval.approvalHash.toLowerCase() || !isMatchingApprovalTransaction(approval, transaction)) return APPROVAL_HEALTH_UNAVAILABLE;
    const [latestNonce, block] = await Promise.all([
      client.getTransactionCount({ address: approval.address, blockTag: "latest" }),
      client.getBlock({ blockTag: "latest" }),
    ]);
    return describePendingApproval({ createdAt: approval.createdAt, now, transaction, latestNonce, baseFeePerGas: block.baseFeePerGas });
  } catch { return APPROVAL_HEALTH_UNAVAILABLE; }
}
