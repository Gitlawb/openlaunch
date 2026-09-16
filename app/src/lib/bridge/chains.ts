import type { Chain } from "viem";
import { CHAINS } from "../chainPublic";
import type { BridgeChainId } from "./types";

/** Wallet chains by Relay's numeric id. Arc is a launch chain like the others (chainPublic.ts); one definition for both. */
export const BRIDGE_WALLET_CHAINS: Record<BridgeChainId, Chain> = {
  8453: CHAINS.base,
  4663: CHAINS.robinhood,
  5042: CHAINS.arc,
};
