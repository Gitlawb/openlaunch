import { isAddress, type Address } from "viem";
import { CHAIN_KEYS, SITE_URL, type ChainKey } from "@/lib/chainPublic";
import { GITLAWB_ADDRESS, GITLAWB_ADDRESS_ROBINHOOD, GITLAWB_DECIMALS, GITLAWB_LOGO_PATH, GITLAWB_NAME, GITLAWB_SYMBOL } from "./gitlawb";

/**
 * CLIENT-SAFE launchpad config, per chain. Only NEXT_PUBLIC_* vars are read here.
 * Three ownerless contracts per chain (LaunchFactory / LaunchLocker / LaunchToken)
 * on top of Uniswap v4. No platform fee anywhere.
 */
export { TICK_SPACING } from "./math";
export const MAX_LP_FEE = 30_000; // pips (3%)
export const DEFAULT_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const DEAD = "0x000000000000000000000000000000000000dEaD" as const;
export const NATIVE = "0x0000000000000000000000000000000000000000" as const;
export const BPS = 10_000;
/** Locker limit on beneficiaries per launch (LaunchLocker.MAX_RECIPIENTS); recipients.test.ts keeps the two in sync. */
export const MAX_RECIPIENTS = 7;

export type Quote = { key: "eth" | "usdg" | "gitlawb" | "stock"; address: Address; symbol: string; decimals: number; usd: number | null /* fixed USD price (stables); live for stocks + GITLAWB (server-filled) */; name?: string; logo?: string | null };
export type V4 = { poolManager: Address; positionManager: Address; stateView: Address; quoter: Address; universalRouter: Address; permit2: Address; swapLayout: "v1" | "v2" };
export type ChainLaunchpad = { key: ChainKey; factory: Address | null; locker: Address | null; v4: V4; quotes: Quote[]; configured: boolean };

const ETH: Quote = { key: "eth", address: NATIVE, symbol: "ETH", decimals: 18, usd: null };
const USDG: Quote = { key: "usdg", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", symbol: "USDG", decimals: 6, usd: 1 };
/** GITLAWB: usd is null here (client-safe static); the server fills the live price (gitlawbServer.ts). Robinhood's is the LayerZero OFT of the Base token. */
const GITLAWB: Quote = { key: "gitlawb", address: GITLAWB_ADDRESS as Address, symbol: GITLAWB_SYMBOL, decimals: GITLAWB_DECIMALS, usd: null, name: GITLAWB_NAME, logo: GITLAWB_LOGO_PATH };
const GITLAWB_RH: Quote = { ...GITLAWB, address: GITLAWB_ADDRESS_ROBINHOOD as Address };

/** Canonical Uniswap v4 deployments (developers.uniswap.org/docs/protocols/v4/deployments). */
const V4_BY_CHAIN: Record<ChainKey, V4> = {
  base: {
    poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    positionManager: "0x7C5f5A4bBd8fD63184577525326123B519429bDc",
    stateView: "0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71",
    quoter: "0x0d5e0F971ED27FBfF6c2837bf31316121532048D",
    universalRouter: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    swapLayout: "v1", // router predates minHopPriceX36 (verified on a fork)
  },
  robinhood: {
    poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    positionManager: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
    stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
    quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
    universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    swapLayout: "v2", // newer router build: ExactInputSingleParams carries minHopPriceX36 (verified on a fork)
  },
};
/** Quote assets offered per chain, first = default. */
const QUOTES_BY_CHAIN: Record<ChainKey, Quote[]> = { base: [ETH, GITLAWB], robinhood: [USDG, ETH, GITLAWB_RH] };

function addr(v: string | undefined): Address | null {
  const raw = (v ?? "").trim();
  return isAddress(raw) ? (raw as Address) : null;
}

const CFG: Record<ChainKey, ChainLaunchpad> = {
  base: {
    key: "base",
    factory: addr(process.env.NEXT_PUBLIC_LAUNCH_FACTORY),
    locker: addr(process.env.NEXT_PUBLIC_LAUNCH_LOCKER),
    v4: V4_BY_CHAIN.base,
    quotes: QUOTES_BY_CHAIN.base,
    configured: false,
  },
  robinhood: {
    key: "robinhood",
    factory: addr(process.env.NEXT_PUBLIC_LAUNCH_FACTORY_ROBINHOOD),
    locker: addr(process.env.NEXT_PUBLIC_LAUNCH_LOCKER_ROBINHOOD),
    v4: V4_BY_CHAIN.robinhood,
    quotes: QUOTES_BY_CHAIN.robinhood,
    configured: false,
  },
};
for (const k of CHAIN_KEYS) CFG[k].configured = CFG[k].factory !== null && CFG[k].locker !== null;

export function launchpad(key: ChainKey): ChainLaunchpad {
  return CFG[key];
}
export const CONFIGURED_CHAINS: ChainKey[] = CHAIN_KEYS.filter((k) => CFG[k].configured);
export const LAUNCHPAD_CONFIGURED = CONFIGURED_CHAINS.length > 0;

/**
 * Quote metadata for an on-chain quote address. Unknown ERC20 → generic 18-dec, symbol "?", NEVER priced
 * (key "stock" = "some ERC20": Permit2 path, no USD). It must not fall back to "eth": an unknown quote
 * priced at ETH once inflated site volume ~2× (NVDA-quoted launches before the stock registry shipped).
 */
export function quoteInfo(key: ChainKey, address: string): Quote {
  const a = address.toLowerCase();
  return QUOTES_BY_CHAIN[key].find((q) => q.address.toLowerCase() === a) ?? { key: "stock", address: address as Address, symbol: "?", decimals: 18, usd: null };
}

/** Quote key for a stored quote address: a fixed quote's key, else "stock" (= some ERC20, priced only if a registry knows it). */
export function quoteKeyOf(key: ChainKey, address: string): Quote["key"] {
  return quoteInfo(key, address).key;
}

export { quoteUsdOf } from "./math";

/** LP fee presets offered in the form (pips). */
export const FEE_PRESETS = [
  { pips: 0, label: "0%", blurb: "Totally free. Nobody earns anything on trades." },
  { pips: 10_000, label: "1%", blurb: "Standard. Goes to your beneficiary, or is burned." },
  { pips: 30_000, label: "3%", blurb: "Max. Same routing, three times the yield." },
] as const;

/** Starting market cap presets per quote (fully diluted, in quote units). */
export const MCAP_PRESETS: Record<Quote["key"], number[]> = { eth: [1, 5, 10, 25], usdg: [5_000, 10_000, 25_000, 100_000], gitlawb: [] /* derived from the live price */, stock: [] /* derived from the live price */ };
/** Buy amount presets per quote. */
export const BUY_PRESETS: Record<Quote["key"], string[]> = { eth: ["0.01", "0.05", "0.1", "0.5"], usdg: ["5", "25", "100", "500"], gitlawb: ["100000", "500000", "1000000", "5000000"], stock: ["0.1", "0.5", "1", "5"] };

/** Browser RPC: dev override per chain, else our same-origin proxy (→ Alchemy/public, key stays server-side). */
export function browserRpc(key: ChainKey): string {
  const dev = (key === "base" ? process.env.NEXT_PUBLIC_RPC_URL_BASE : process.env.NEXT_PUBLIC_RPC_URL_ROBINHOOD)?.trim();
  return dev || `${SITE_URL}/api/rpc?chain=${key}`;
}

export function uniswapSwapUrl(key: ChainKey, token: string): string {
  return key === "base" ? `https://app.uniswap.org/swap?chain=base&outputCurrency=${token}` : `https://pools.trade/token/${token}`;
}
