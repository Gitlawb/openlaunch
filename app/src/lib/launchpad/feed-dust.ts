/**
 * Dust filter for the activity feed (the home tape, the toasts, the live poll) — pure, node --test loads it directly.
 *
 * A Uniswap v4 swap can move 1 wei of quote: bots probing a pool, or a hand-typed 0.000001 USDG. Such a
 * trade is real and stays in the token's trade table, its totals and the ranking, but it is not activity
 * worth announcing — and until fmtQuoteUnits grew a floor it printed as a "0 USDG" buy. Below FEED_DUST_USD
 * a swap is dropped from the feed. A quote with no USD price right now falls back to the display floor, so
 * anything that would have read "0" is dust even while a price feed is down.
 */
import { quoteDisplayFloor, units } from "./math.ts";

/** Trades worth less than this (in dollars) never reach the feed. Tune here, nowhere else. */
export const FEED_DUST_USD = 0.01;

export type DustSwap = { usd: number | null; quote_wei: string; quote_decimals: number };

export function isDustSwap(s: DustSwap): boolean {
  // A zero or broken USD figure is "no price", not "worthless": a quote whose feed reads 0 must not vanish wholesale.
  if (s.usd !== null && Number.isFinite(s.usd) && s.usd > 0) return s.usd < FEED_DUST_USD;
  return units(s.quote_wei, s.quote_decimals) < quoteDisplayFloor(s.quote_decimals);
}

/** Pages of swap candidates (2×limit rows each) the feed reads before giving up on filling its quota. */
export const FEED_SWAP_PAGES = 4;

/**
 * Newest-first swaps that are not dust, up to `limit`. Reads `fetchPage(after, size)` in pages of 2×limit — the
 * newest page first (`after` null), then the rows older than the last one seen — and stops when the quota is met,
 * the source runs dry, or FEED_SWAP_PAGES pages have been read, so even a bot flood is a bounded read. The cursor
 * is the last row itself: the caller turns it into a keyset condition on its complete unique ordering, so a swap
 * indexed between two reads can neither be skipped nor served twice. `keyOf` dedupes all the same, as a belt.
 */
export async function collectNonDust<T extends DustSwap>(fetchPage: (after: T | null, size: number) => Promise<T[]>, limit: number, keyOf: (item: T) => string): Promise<T[]> {
  const size = 2 * limit;
  const seen = new Set<string>();
  const out: T[] = [];
  let after: T | null = null;
  for (let page = 0; page < FEED_SWAP_PAGES && out.length < limit; page++) {
    const rows = await fetchPage(after, size);
    for (const row of rows) {
      if (out.length >= limit) break;
      const key = keyOf(row);
      if (seen.has(key) || isDustSwap(row)) continue;
      seen.add(key);
      out.push(row);
    }
    if (rows.length < size) break;
    after = rows[rows.length - 1];
  }
  return out;
}
