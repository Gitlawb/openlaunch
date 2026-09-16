/**
 * Coinbase tokenized stocks on Base (B20 standard) as quote assets — pure logic, node --test loads this.
 *
 * Registry = the official list on docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base
 * (issuer Coinbase, custodian Alpaca, Regulation S: not for US/UK/CA/AU/SG/CH persons). An address
 * is a stock here ONLY if it is in this list — never by on-chain name/symbol, which anyone can fake.
 * Prices come from Chainlink's on-chain "Coinbase <TICKER>" feeds on Base (8 decimals, 24/5, the
 * feed holds the last close while markets are shut) — no third-party API, no key.
 *
 * B20 tokens are Base-native precompiles: some RPC providers (Alchemy, at the time of writing) cannot
 * execute calls that touch them and answer "EVM error OpcodeNotFound"; `isB20RpcError` lets the RPC
 * proxy and server client retry such calls on a B20-capable node.
 */
export type BaseStock = { symbol: string; name: string; address: string; feed: string; decimals: number };

export const BASE_STOCK_DECIMALS = 8;
export const BASE_STOCK_ISSUER = "Coinbase";
/** Chainlink 24/5 equity feeds hold the last close over weekends/holidays; beyond this we stop trusting them. */
export const BASE_STOCK_MAX_FEED_AGE_S = 5 * 24 * 3600;
/** All B20 token addresses start with this 10-byte prefix (then 1 variant byte + 9 bytes of hash). */
export const B20_PREFIX = "0xb200000000000000000000";

export const BASE_STOCKS: readonly BaseStock[] = [
  { symbol: "AAPLc", name: "Apple", address: "0xb200000000000000000000c2e324d24d7eecd1fb", feed: "0x787f13dEa48Db0897CbCDD985de77809D837F988", decimals: 8 },
  { symbol: "AMZNc", name: "Amazon", address: "0xb200000000000000000000d9192b6b456483c2e8", feed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295", decimals: 8 },
  { symbol: "COINc", name: "Coinbase", address: "0xb200000000000000000000c85a31389d71f3ecfb", feed: "0x408e44f504A7371a345F03a73dDC96A4b48e8aa7", decimals: 8 },
  { symbol: "CRCLc", name: "Circle", address: "0xb20000000000000000000019f6e7c675b73c2e4d", feed: "0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33", decimals: 8 },
  { symbol: "GOOGLc", name: "Alphabet", address: "0xb2000000000000000000002d0ba3164cc74f58b7", feed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2", decimals: 8 },
  { symbol: "INTCc", name: "Intel", address: "0xb2000000000000000000004aff16039ba04bdfbc", feed: "0xAB657C39bac0D5886250D70849e2E3E008F2EECB", decimals: 8 },
  { symbol: "METAc", name: "Meta Platforms", address: "0xb2000000000000000000008bc8786b856e61707c", feed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D", decimals: 8 },
  { symbol: "MSFTc", name: "Microsoft", address: "0xb200000000000000000000ab99cfa739e253872b", feed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c", decimals: 8 },
  { symbol: "MSTRc", name: "Strategy", address: "0xb2000000000000000000004884b426556b92883d", feed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a", decimals: 8 },
  { symbol: "NVDAc", name: "NVIDIA", address: "0xb20000000000000000000078ee7ce2fe4908108c", feed: "0x04689a41629776563E6822F76f2e57D148d28513", decimals: 8 },
  { symbol: "SNDKc", name: "Sandisk", address: "0xb200000000000000000000397293cb8cda9a10c5", feed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA", decimals: 8 },
  { symbol: "SPCXc", name: "SpaceX", address: "0xb2000000000000000000007b9fcbd005511acbd5", feed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68", decimals: 8 },
  { symbol: "TSLAc", name: "Tesla", address: "0xb2000000000000000000001e800a7f5189430cd0", feed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4", decimals: 8 },
];

const BY_ADDRESS = new Map(BASE_STOCKS.map((s) => [s.address, s]));

export function baseStockByAddress(address: string): BaseStock | null {
  return BY_ADDRESS.get(address.toLowerCase()) ?? null;
}

/** Address shape of a B20 token (does NOT mean it is a Coinbase stock — only the registry decides that). */
export function isB20Address(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address) && address.toLowerCase().startsWith(B20_PREFIX);
}

/** Ticker/name search over the registry: symbol prefix first, then substring on symbol/name. */
export function searchBaseStocks(q: string, limit = 12): BaseStock[] {
  const n = q.trim().toUpperCase().replace(/^\$/, "");
  const list = [...BASE_STOCKS];
  if (!n) return list.slice(0, limit);
  const pre = list.filter((s) => s.symbol.toUpperCase().startsWith(n));
  const sub = list.filter((s) => !s.symbol.toUpperCase().startsWith(n) && (s.symbol.toUpperCase().includes(n) || s.name.toUpperCase().includes(n)));
  return [...pre, ...sub].slice(0, limit);
}

/** Decode Chainlink `latestRoundData()` return data (5 × 32-byte words). */
export function parseRoundData(hex: string): { answer: bigint; updatedAt: number } | null {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length < 5 * 64) return null;
  const word = (i: number) => BigInt("0x" + h.slice(i * 64, (i + 1) * 64));
  let answer = word(1);
  if (answer >= 1n << 255n) answer -= 1n << 256n; // int256
  return { answer, updatedAt: Number(word(3)) };
}

/** USD per token from a feed reading; null when non-positive, from the future, or older than the trust window. */
export function feedUsd(r: { answer: bigint; updatedAt: number } | null, nowS: number, feedDecimals = 8, maxAgeS = BASE_STOCK_MAX_FEED_AGE_S): number | null {
  if (!r || r.answer <= 0n) return null;
  if (!(r.updatedAt > 0) || r.updatedAt > nowS || nowS - r.updatedAt > maxAgeS) return null;
  return Number(r.answer) / 10 ** feedDecimals;
}

/** RPC error text meaning "this node cannot execute Base-native (B20) precompiles" → retry elsewhere. */
export function isB20RpcError(message: unknown): boolean {
  return typeof message === "string" && /opcode\s*not\s*found|OpcodeNotFound|unsupported opcode|invalid opcode/i.test(message);
}

/** Does a JSON-RPC response (single or batch) carry a B20 execution error anywhere? */
export function responseHasB20Error(json: unknown): boolean {
  const items = Array.isArray(json) ? json : [json];
  return items.some((x) => {
    const e = (x as { error?: { message?: unknown; data?: unknown } } | null)?.error;
    return Boolean(e && (isB20RpcError(e.message) || isB20RpcError(typeof e.data === "string" ? e.data : "")));
  });
}

export const BASE_BLUE = "#0052FF";

/** Underlying ticker of a Coinbase stock token symbol ("NVDAc" → "NVDA"). */
export function underlyingTicker(symbol: string): string {
  return symbol.replace(/c$/, "").toUpperCase();
}

/**
 * Logo tile for a stock without an issuer-provided image: Base-blue rounded square with the underlying
 * ticker in white, as an inline SVG data URL (nothing to fetch, nothing third-party). Used wherever a
 * stock logo is shown; Robinhood stocks keep the logo URL their registry provides.
 */
export function stockTileSvg(symbol: string, bg = BASE_BLUE): string {
  const t = underlyingTicker(symbol).replace(/[^A-Z0-9.]/g, "").slice(0, 5) || "?";
  const size = t.length <= 2 ? 13 : t.length === 3 ? 11 : t.length === 4 ? 9.2 : 7.6;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${bg}"/><text x="16" y="16" dy="0.36em" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-weight="800" font-size="${size}" letter-spacing="-0.02em" fill="#fff">${t}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg).replace(/%20/g, " ")}`;
}
