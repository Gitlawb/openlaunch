import { NextResponse } from "next/server";
import { b20RpcUrl, rpcUrl } from "@/lib/chain";
import { responseHasB20Error } from "@/lib/launchpad/baseStocks";
import { CHAINS, DEFAULT_CHAIN, isChainKey } from "@/lib/chainPublic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin JSON-RPC proxy for the browser (wagmi transport) → per-chain upstream
 * (BASE_RPC_URL / ROBINHOOD_RPC_URL, else the chain's public RPC).
 * Keeps the API key server-side. Read-only allowlist: wallets send transactions
 * through their own provider, so nothing here can move funds. Small per-IP
 * token bucket so one tab cannot burn the whole Alchemy quota.
 */
const ALLOWED = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "net_version",
]);
const BUCKET_CAP = 120; // requests
const BUCKET_REFILL_PER_S = 4;
const buckets = new Map<string, { tokens: number; at: number }>();

function take(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: BUCKET_CAP, at: now };
  b.tokens = Math.min(BUCKET_CAP, b.tokens + ((now - b.at) / 1000) * BUCKET_REFILL_PER_S);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  if (buckets.size > 10_000) buckets.clear();
  return true;
}

type Req = { id?: unknown; jsonrpc?: string; method?: string; params?: unknown };

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const c = new URL(req.url).searchParams.get("chain") ?? DEFAULT_CHAIN;
  if (!isChainKey(c)) return NextResponse.json({ error: "bad chain" }, { status: 400 });
  const upstream = rpcUrl(c) ?? CHAINS[c].rpcUrls.default.http[0];
  if (!upstream) return NextResponse.json({ error: "rpc unconfigured" }, { status: 503 });
  const ip = (req.headers.get("fly-client-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "0.0.0.0";
  if (!take(ip)) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "retry-after": "2" } });
  let body: Req | Req[];
  try {
    body = (await req.json()) as Req | Req[];
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const list = Array.isArray(body) ? body : [body];
  if (list.length > 20) return NextResponse.json({ error: "batch too large" }, { status: 400 });
  for (const r of list) {
    if (typeof r?.method !== "string" || !ALLOWED.has(r.method)) {
      return NextResponse.json({ jsonrpc: "2.0", id: r?.id ?? null, error: { code: -32601, message: `method not allowed: ${String(r?.method)}` } }, { status: 403 });
    }
  }
  try {
    const payload = JSON.stringify(body);
    const res = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: AbortSignal.timeout(15_000) });
    let text = await res.text();
    let status = res.status;
    // Base-native B20 tokens (Coinbase stocks) are precompiles the primary provider may not execute
    // ("EVM error OpcodeNotFound"): replay the batch on a node that can, transparently to the wallet.
    if (c === "base" && status === 200 && text.includes("Opcode") && responseHasB20Error(safeJson(text))) {
      const alt = await fetch(b20RpcUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: AbortSignal.timeout(15_000) });
      if (alt.ok) {
        text = await alt.text();
        status = alt.status;
      }
    }
    return new NextResponse(text, { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "upstream failed" }, { status: 502 });
  }
}
