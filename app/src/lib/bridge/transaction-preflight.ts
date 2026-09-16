import type { Address } from "viem";

type WalletQueueClient = {
  getTransactionCount: (request: { address: Address; blockTag: "latest" | "pending" }) => Promise<number>;
};

/**
 * Do not stack a bridge transaction behind a queue visible to the source RPC.
 * This is a read-only preflight, not a guarantee that every node sees the same
 * mempool. Never choose a nonce or replace an existing wallet transaction here.
 */
export async function assertBridgeWalletQueueClear(client: WalletQueueClient, address: Address, networkName: string): Promise<void> {
  // Pending first avoids reporting a queue just because a transaction mined
  // between a latest read and a newer pending read. A reverse mismatch fails
  // closed as an inconsistent observation, not as evidence of a stuck queue.
  const pending = await client.getTransactionCount({ address, blockTag: "pending" });
  const latest = await client.getTransactionCount({ address, blockTag: "latest" });
  if (!Number.isSafeInteger(pending) || pending < 0 || !Number.isSafeInteger(latest) || latest < 0 || pending < latest) {
    throw new Error(`Could not verify a consistent transaction count on ${networkName}. Wait a moment and try again before approving or bridging.`);
  }
  if (pending > latest) {
    throw new Error(`Your wallet has a pending transaction on ${networkName}. Open your wallet and resolve the earliest pending transaction before approving or bridging.`);
  }
}
