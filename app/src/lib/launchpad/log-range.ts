/**
 * Log-range splitting for RPC nodes that cap one eth_getLogs call by result count rather than by block span
 * (Arc: 2000 results, "query exceeds max results 2000, retry with the range …"; Alchemy: "Log response size
 * exceeded"). Pure, so node --test loads it directly.
 */

// deliberately not "query timeout": an overloaded node times out on every range, and bisecting it 2000 → 1 would only multiply the calls
const TOO_LARGE = /range too large|max allowed range|exceeds max results|more than \d+ results|response size exceeded|too many (results|logs)/i;

/** True when the node refused the query for its size (as opposed to failing outright). */
export function isRangeTooLarge(err: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  // viem wraps the RPC error a few layers deep: check every message along the cause chain
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const e = cur as { message?: unknown; details?: unknown; cause?: unknown };
    for (const text of [e.message, e.details]) if (typeof text === "string" && TOO_LARGE.test(text)) return true;
    cur = e.cause;
  }
  return typeof err === "string" && TOO_LARGE.test(err);
}

/**
 * Fetch logs over [from, to]; when the node says the range is too big, halve it and retry each half, down to a
 * single block. Any other error propagates unchanged. Results keep block order (left half first).
 */
export async function fetchLogsSplit<T>(fetch: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint): Promise<T[]> {
  try {
    return await fetch(from, to);
  } catch (err) {
    if (to <= from || !isRangeTooLarge(err)) throw err;
    const mid = from + (to - from) / 2n;
    const left = await fetchLogsSplit(fetch, from, mid);
    const right = await fetchLogsSplit(fetch, mid + 1n, to);
    return [...left, ...right];
  }
}
