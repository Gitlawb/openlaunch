/**
 * The chain list, pure (node --test loads this; no viem, no env reads). Adding a chain starts here:
 * every `Record<ChainKey, …>` in the app then fails to type-check until it has an entry, so a new
 * chain can never silently inherit another chain's RPC, explorer, copy or pricing.
 */
const KEYS = ["base", "robinhood"] as const;
export type ChainKey = (typeof KEYS)[number];
export const CHAIN_KEYS: ChainKey[] = [...KEYS];
export const DEFAULT_CHAIN: ChainKey = "base";

/** EVM chain ids. chainPublic.test.ts keeps these equal to the viem chain objects. */
export const CHAIN_IDS: Record<ChainKey, number> = { base: 8453, robinhood: 4663 };
export const CHAIN_LABELS: Record<ChainKey, string> = { base: "Base", robinhood: "Robinhood Chain" };
export const CHAIN_SHORT: Record<ChainKey, string> = { base: "Base", robinhood: "Robinhood" };
export const EXPLORERS: Record<ChainKey, { url: string; name: string }> = {
  base: { url: "https://basescan.org", name: "Basescan" },
  robinhood: { url: "https://robinhoodchain.blockscout.com", name: "Blockscout" },
};

export function isChainKey(v: unknown): v is ChainKey {
  return typeof v === "string" && (KEYS as readonly string[]).includes(v);
}
export function chainKeyOf(id: number | undefined | null): ChainKey | null {
  return CHAIN_KEYS.find((k) => CHAIN_IDS[k] === id) ?? null;
}
/** A `?chain=` style param: a known key, else the fallback (the default chain unless told otherwise). */
export function chainKeyOr<F extends ChainKey | null>(v: unknown, fallback: F): ChainKey | F {
  return isChainKey(v) ? v : fallback;
}
/** "Base or Robinhood Chain" / "Base, X or Y" — site copy that names every chain. */
export function chainList(conj: "or" | "and" | "&" = "or", labels: Record<ChainKey, string> = CHAIN_LABELS): string {
  const names = CHAIN_KEYS.map((k) => labels[k]);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} ${conj} ${names[names.length - 1]}`;
}
/** `base|robinhood`, for API docs and anchored regexes. */
export const CHAIN_KEY_PATTERN = CHAIN_KEYS.join("|");
