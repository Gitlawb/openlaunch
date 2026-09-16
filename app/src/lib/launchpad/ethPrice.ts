import "server-only";
import { publicClient } from "@/lib/chain";
import { feedUsd } from "./baseStocks";

/**
 * ETH/USD spot, 60s memo, null when unavailable (UI then shows ETH only).
 *
 * Order of preference on every refresh:
 *   1. Coinbase spot (what people compare against on exchanges and screeners);
 *   2. the Chainlink ETH/USD feed on Base, when its round is under ETH_FEED_MAX_AGE_S old (it updates on a 0.15%
 *      move or every 20 minutes, so a normal answer can be that old; it fails independently of Coinbase);
 *   3. the last good value, for at most ETH_STALE_MAX_MS after it was confirmed;
 *   4. null.
 * A non-200, an unusable body, or a thrown fetch/parse error therefore never blanks USD on its own (before the
 * guard a single Coinbase 429 blanked every USD figure on the site for a TTL), and a long double outage never leaves
 * a day-old dollar figure on every page either: past the bound the honest answer is "unknown". Failures still advance
 * the attempt timestamp, so a dead upstream is retried once per TTL, not on every request.
 * Display and sorting only: nothing on-chain reads any of this.
 */
export const ETH_SPOT_URL = "https://api.coinbase.com/v2/prices/ETH-USD/spot";
export const ETH_PRICE_TTL_MS = 60_000;
export const ETH_FETCH_TIMEOUT_MS = 5_000;
/** Chainlink ETH / USD on Base. Verified on-chain 2026-09-11: description() = "ETH / USD", decimals() = 8. */
export const ETH_USD_FEED_BASE = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70" as const;
export const ETH_FEED_DECIMALS = 8;
/** An ETH feed round older than this is not a price (the stock feeds allow days because equities close; ETH does not). */
export const ETH_FEED_MAX_AGE_S = 30 * 60;
/** How long the last good value is served once both live sources fail. */
export const ETH_STALE_MAX_MS = 15 * 60_000;

export type EthPriceSource = "coinbase" | "chainlink";
type Cache = { at: number; goodAt: number; usd: number | null; source: EthPriceSource | null };
let cached: Cache = { at: 0, goodAt: 0, usd: null, source: null };
/** One refresh at a time: concurrent callers share it, so a slow earlier attempt can never overwrite a newer result. */
let inflight: Promise<number | null> | null = null;

/** Test-only: drop the memo so each case starts cold. */
export function resetEthPriceCache(): void {
  cached = { at: 0, goodAt: 0, usd: null, source: null };
  inflight = null;
}

/** Test-only: which source the current value came from (null when none). */
export function ethPriceSource(): EthPriceSource | null {
  return cached.source;
}

/** Pull a positive finite USD number out of a Coinbase spot body; null when unusable. */
export function parseEthSpot(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const amount = (body as { data?: { amount?: unknown } }).data?.amount;
  if (typeof amount !== "string") return null;
  const v = Number(amount);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export type FeedRound = { answer: bigint; updatedAt: number };

/** USD from a Chainlink ETH/USD round: positive answer, updated within ETH_FEED_MAX_AGE_S of `nowS` and never from the future; else null. */
export function feedEthUsd(round: FeedRound | null, nowS: number): number | null {
  return feedUsd(round, nowS, ETH_FEED_DECIMALS, ETH_FEED_MAX_AGE_S);
}

const AGGREGATOR_ABI = [
  { type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }] },
] as const;

/** The live Chainlink read, under the same timeout as the Coinbase call. */
async function readFeed(): Promise<FeedRound | null> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`feed timeout after ${ETH_FETCH_TIMEOUT_MS}ms`)), ETH_FETCH_TIMEOUT_MS).unref?.());
  const r = await Promise.race([publicClient("base").readContract({ address: ETH_USD_FEED_BASE, abi: AGGREGATOR_ABI, functionName: "latestRoundData" }), timeout]);
  return { answer: r[1], updatedAt: Number(r[3]) };
}

type FetchFn = (
  input: string,
  init?: RequestInit & { next?: { revalidate: number } },
) => Promise<Response>;
type FeedFn = () => Promise<FeedRound | null>;

async function fromCoinbase(fetchFn: FetchFn): Promise<number | null> {
  try {
    const res = await fetchFn(ETH_SPOT_URL, { next: { revalidate: 60 }, signal: AbortSignal.timeout(ETH_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return parseEthSpot(await res.json());
  } catch {
    return null;
  }
}

async function fromChainlink(feedFn: FeedFn, now: () => number): Promise<number | null> {
  try {
    const round = await feedFn();
    // Sample the clock after the read completes: the Coinbase fallback can
    // take seconds, and a round published while it was running is already
    // seconds old — not from the future.
    return feedEthUsd(round, Math.floor(now() / 1000));
  } catch {
    return null;
  }
}

export async function ethUsd(
  opts: { fetchFn?: FetchFn; feedFn?: FeedFn; now?: () => number } = {},
): Promise<number | null> {
  const now = opts.now ?? Date.now;
  const t = now();
  // the memo never extends a stale value past its bound: once over it, refresh regardless of the TTL
  const staleExpired = cached.usd !== null && t - cached.goodAt > ETH_STALE_MAX_MS;
  if (t - cached.at < ETH_PRICE_TTL_MS && !staleExpired) return cached.usd;
  const fetchFn: FetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init as RequestInit));
  const feedFn: FeedFn = opts.feedFn ?? readFeed;
  inflight ??= refresh(fetchFn, feedFn, now).finally(() => { inflight = null; });
  return inflight;
}

async function refresh(fetchFn: FetchFn, feedFn: FeedFn, now: () => number): Promise<number | null> {
  let source: EthPriceSource = "coinbase";
  let usd = await fromCoinbase(fetchFn);
  if (usd === null) {
    source = "chainlink";
    usd = await fromChainlink(feedFn, now);
  }
  const t = now();
  if (usd !== null) {
    if (source !== cached.source && cached.source !== null) console.warn(`[eth-price] serving ${source} (${source === "chainlink" ? "Coinbase spot unavailable" : "Coinbase spot back"})`);
    cached = { at: t, goodAt: t, usd, source };
    return usd;
  }
  // both live sources failed: the last good value for a bounded time, then null
  const stale = cached.usd !== null && t - cached.goodAt <= ETH_STALE_MAX_MS;
  if (!stale && cached.usd !== null) console.warn(`[eth-price] Coinbase and Chainlink both unavailable for over ${ETH_STALE_MAX_MS / 60_000} minutes: USD figures off until one recovers`);
  cached = { at: t, goodAt: cached.goodAt, usd: stale ? cached.usd : null, source: stale ? cached.source : null };
  return cached.usd;
}
