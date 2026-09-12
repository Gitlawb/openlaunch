/**
 * User slippage control for token-page trades (pure; unit-tested).
 *
 * TradePanel hardcoded 1% (`SLIPPAGE_BPS = 100`): on a fresh launch that is
 * often too tight (reverts, frontrun failures) and sometimes too loose for a
 * large size. This module owns the presets, parsing, clamping and per-chain
 * persistence; TradePanel keeps rendering the default on the server and loads
 * the stored value in an effect, so hydration never mismatches.
 */

/** Default when nothing is stored (the old hardcoded 1%). */
export const SLIPPAGE_DEFAULT_BPS = 100;
/** Quick presets shown under the quote. */
export const SLIPPAGE_PRESETS_BPS: readonly number[] = [50, 100, 300];
/** Hard bounds for custom input: 0.1% … 20%. */
export const SLIPPAGE_MIN_BPS = 10;
export const SLIPPAGE_MAX_BPS = 2000;

/** Clamp anything to an integer within [MIN, MAX]; garbage → default. */
export function clampSlippageBps(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return SLIPPAGE_DEFAULT_BPS;
  return Math.min(SLIPPAGE_MAX_BPS, Math.max(SLIPPAGE_MIN_BPS, Math.round(n)));
}

/**
 * Parse a percent string the user typed ("1", "0.5", "2.5%") into integer bps.
 * Null when empty, unusable, or outside 0.1–20% (caller keeps the previous
 * value and shows a hint — never silently clamps a below-minimum entry up).
 */
export function parseSlippageInput(raw: string): number | null {
  const t = raw.trim().replace(/%$/, "").trim();
  if (!t) return null;
  const pct = Number(t);
  if (!Number.isFinite(pct) || pct < SLIPPAGE_MIN_BPS / 100 || pct > SLIPPAGE_MAX_BPS / 100) return null;
  return clampSlippageBps(Math.round(pct * 100));
}

/**
 * Validate the raw field value before stripping characters (PR #30).
 *
 * The input handler used to `replace(/[^0-9.%]/g, "")` first, so pasting
 * `0,5` became `05` (5% instead of 0.5%) and `-3` became `3`. This validates
 * the raw text: a leading `-` or any letter is rejected (caller keeps the
 * previous tolerance), while a decimal comma (common on mobile keyboards) is
 * normalized to a dot. Covered by unit tests since parser-only tests bypass
 * the input transformation.
 */
export function parseSlippageField(raw: string): number | null {
  if (raw.includes("-")) return null;
  const normalized = raw.replace(/,/g, ".");
  if (/[^0-9.%\s]/.test(normalized)) return null;
  return parseSlippageInput(normalized);
}

/** "1%" / "0.5%" for labels. */
export function formatSlippageBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function slippageStorageKey(chain: string): string {
  return `ol:slippage-bps:${chain}`;
}

/** Stored value, or the default on the server / when storage is blocked. */
export function loadSlippageBps(chain: string): number {
  try {
    if (typeof localStorage === "undefined") return SLIPPAGE_DEFAULT_BPS;
    return clampSlippageBps(localStorage.getItem(slippageStorageKey(chain)));
  } catch {
    return SLIPPAGE_DEFAULT_BPS;
  }
}

export function saveSlippageBps(chain: string, bps: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(slippageStorageKey(chain), String(clampSlippageBps(bps)));
  } catch {
    /* storage blocked: the in-memory state above is what the UI keeps until reload */
  }
}

const slippageListeners = new Set<() => void>();
const slippageCache = new Map<string, number>();

function readStoredSlippage(chain: string): number | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(slippageStorageKey(chain));
    if (raw === null || raw.trim() === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return clampSlippageBps(n);
  } catch {
    return null;
  }
}

/**
 * External-store plumbing so components read stored slippage with
 * useSyncExternalStore (server snapshot is always the default, so server and
 * client render the same markup during hydration; an effect that sets state
 * is rejected by the lint rules).
 */
export function subscribeSlippage(cb: () => void): () => void {
  slippageListeners.add(cb);
  return () => { slippageListeners.delete(cb); };
}

/** Client snapshot: cached value, else storage, else the default. */
export function getSlippageBps(chain: string): number {
  const hit = slippageCache.get(chain);
  if (hit !== undefined) return hit;
  const v = readStoredSlippage(chain) ?? SLIPPAGE_DEFAULT_BPS;
  slippageCache.set(chain, v);
  return v;
}

/** Server snapshot: always the default. */
export function getSlippageBpsServer(): number {
  return SLIPPAGE_DEFAULT_BPS;
}

export function setSlippageBps(chain: string, bps: number): void {
  const v = clampSlippageBps(bps);
  slippageCache.set(chain, v);
  saveSlippageBps(chain, v);
  for (const cb of slippageListeners) cb();
}
