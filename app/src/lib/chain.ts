import "server-only";
import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { CHAINS, RPC_ENV_NAME, type ChainKey } from "./chainPublic";

export * from "./chainPublic";

/** SERVER chain access. BASE_RPC_URL / ROBINHOOD_RPC_URL / ARC_RPC_URL (Alchemy etc.) override the chains' public RPCs. */
const cached = new Map<ChainKey, PublicClient>();

export function rpcUrl(key: ChainKey): string | undefined {
  return process.env[RPC_ENV_NAME[key]]?.trim() || undefined;
}

/**
 * A Base node that can execute B20 precompiles (Coinbase tokenized stocks). Alchemy's Base nodes
 * answer "EVM error OpcodeNotFound" for any call touching one; the public nodes execute them.
 * Used as a fallback by the server client and the browser RPC proxy. Override with BASE_B20_RPC_URL.
 */
export function b20RpcUrl(): string {
  return process.env.BASE_B20_RPC_URL?.trim() || "https://base-rpc.publicnode.com";
}

export function publicClient(key: ChainKey): PublicClient {
  const hit = cached.get(key);
  if (hit) return hit;
  const primary = http(rpcUrl(key), { batch: true, retryCount: 3 });
  const transport = key === "base" ? fallback([primary, http(b20RpcUrl(), { batch: true, retryCount: 2 })], { rank: false }) : primary;
  const c = createPublicClient({ chain: CHAINS[key], transport });
  cached.set(key, c);
  return c;
}
