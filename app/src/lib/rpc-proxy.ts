/**
 * Public RPC nodes answer rate limiting and outages inside a 200 body, and
 * sometimes with a single object where a batch array was due. viem retries
 * HTTP 429/502 with backoff but cannot use those bodies (a short batch even
 * throws a TypeError in its scheduler). Map them to statuses clients can retry.
 */
const RATE_LIMITED = /rate limit|too many requests|exceeded (?:the )?(?:quota|capacity|throughput)/i;
const RATE_LIMIT_CODES = new Set([-32005, -32016, 429]);

export function upstreamStatus(text: string, batch: boolean, expected: number, status: number, expectedIds?: readonly unknown[]): number {
  if (status !== 200) return status;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return 502; }
  if (Array.isArray(parsed) !== batch) return 502;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (Array.isArray(parsed) && parsed.length !== expected) return 502;
  if (items.some((item) => !item || typeof item !== "object")) return 502;
  const errors = items.map((item) => (item as { error?: { code?: unknown; message?: unknown } }).error).filter((error): error is { code?: unknown; message?: unknown } => !!error && typeof error === "object");
  if (errors.some((error) => (typeof error.code === "number" && RATE_LIMIT_CODES.has(error.code)) || RATE_LIMITED.test(String(error.message ?? "")))) return 429;
  // Length alone is not enough: duplicate/missing IDs can assign a balance or
  // gas result to the wrong call in a client's batch scheduler.
  if (items.some((item) => {
    const response = item as Record<string, unknown>;
    const hasResult = Object.hasOwn(response, "result");
    const hasError = Object.hasOwn(response, "error");
    const error = response.error as { code?: unknown; message?: unknown } | null;
    return response.jsonrpc !== "2.0" || hasResult === hasError ||
      (hasError && (!error || typeof error.code !== "number" || typeof error.message !== "string"));
  })) return 502;
  if (expectedIds) {
    const ids = items.map((item) => (item as { id?: unknown }).id);
    if (expectedIds.length !== items.length || new Set(ids).size !== ids.length ||
      expectedIds.some((id) => !ids.includes(id))) return 502;
  }
  return 200;
}
