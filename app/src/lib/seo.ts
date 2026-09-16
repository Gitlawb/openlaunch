/**
 * Pure SEO helpers (node --test loads this). No Next.js, no DB, no env reads:
 * callers pass `siteUrl` in so unit tests stay deterministic.
 */

import { CHAIN_LABELS, isChainKey, type ChainKey } from "./chainKeys.ts";

export { isChainKey, type ChainKey };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isTokenAddress(v: unknown): boolean {
  return typeof v === "string" && ADDRESS_RE.test(v);
}

export function isCanonicalTokenPath(chain: unknown, token: unknown): boolean {
  return isChainKey(chain) && isTokenAddress(token);
}

export function canonicalUrl(siteUrl: string, path: string): string {
  const base = siteUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export function tokenPath(chain: ChainKey, token: string): string {
  return `/t/${chain}/${token.toLowerCase()}`;
}

export function tokenCanonical(siteUrl: string, chain: ChainKey, token: string): string {
  return canonicalUrl(siteUrl, tokenPath(chain, token));
}

export type StaticRoute = {
  path: string;
  changeFrequency: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority: number;
};

/**
 * Static sitemap routes. Facts only: every path exists in src/app.
 * /admin is intentionally excluded (robots noindex + disallowed in robots.txt).
 */
export const STATIC_SITEMAP_ROUTES: StaticRoute[] = [
  { path: "/", changeFrequency: "hourly", priority: 1 },
  { path: "/launch", changeFrequency: "weekly", priority: 0.8 },
  { path: "/feed", changeFrequency: "hourly", priority: 0.7 },
  { path: "/rules", changeFrequency: "monthly", priority: 0.6 },
  { path: "/agents", changeFrequency: "monthly", priority: 0.6 },
  { path: "/me", changeFrequency: "weekly", priority: 0.4 },
];

export type SitemapEntry = {
  url: string;
  lastModified?: string;
  changeFrequency: StaticRoute["changeFrequency"];
  priority: number;
};

export function staticSitemapEntries(siteUrl: string, lastModified?: string): SitemapEntry[] {
  return STATIC_SITEMAP_ROUTES.map((r) => ({
    url: canonicalUrl(siteUrl, r.path),
    ...(lastModified ? { lastModified } : {}),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}

export type TokenRow = {
  chain: ChainKey;
  token: string;
  block_time: string | null;
};

export function tokenSitemapEntries(siteUrl: string, rows: TokenRow[]): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const r of rows) {
    if (!isCanonicalTokenPath(r.chain, r.token)) continue;
    out.push({
      url: tokenCanonical(siteUrl, r.chain, r.token),
      ...(r.block_time ? { lastModified: r.block_time } : {}),
      changeFrequency: "hourly",
      priority: 0.9,
    });
  }
  return out;
}

export type TokenJsonLdInput = {
  name: string;
  symbol: string;
  chain: ChainKey;
  chainId: number;
  token: string;
  launcher: string;
  quoteSymbol: string;
  supply: string;
  poolId: string;
  startTick: number;
  lpFee: number;
  blockTime: string;
  description: string | null;
  siteUrl: string;
};

/**
 * Facts-only JSON-LD for a token page. Every field is on-chain (factory /
 * locker / pool) or creator-supplied metadata — no scores, no flags, no
 * predictions (see CONTRIBUTING.md "Facts over scores").
 */
export function tokenJsonLd(l: TokenJsonLdInput): Record<string, unknown> {
  const url = tokenCanonical(l.siteUrl, l.chain, l.token);
  const chainLabel = CHAIN_LABELS[l.chain];
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${l.name} (${l.symbol})`,
    description: (l.description ?? `${l.name} launched on openlaunch.lol.`).slice(0, 500),
    url,
    dateCreated: l.blockTime,
    about: {
      "@type": "DigitalDocument",
      name: l.name,
      identifier: l.token.toLowerCase(),
      url,
      inLanguage: "en",
      creator: { "@type": "Organization", identifier: l.launcher.toLowerCase() },
      isPartOf: { "@type": "WebSite", name: chainLabel, identifier: String(l.chainId) },
      additionalProperty: [
        { "@type": "PropertyValue", name: "symbol", value: l.symbol },
        { "@type": "PropertyValue", name: "quoteSymbol", value: l.quoteSymbol },
        { "@type": "PropertyValue", name: "supply", value: l.supply },
        { "@type": "PropertyValue", name: "poolId", value: l.poolId },
        { "@type": "PropertyValue", name: "startTick", value: String(l.startTick) },
        { "@type": "PropertyValue", name: "lpFeePips", value: String(l.lpFee) },
      ],
    },
  };
}

/**
 * Render JSON-LD for a `<script type="application/ld+json">` sink.
 * `name` / `description` are creator-supplied, so `<` is escaped to
 * `\u003c`: a literal `</script>` in a token name must never terminate
 * the script element (XSS). The JSON parses identically.
 */
export function jsonLdHtml(l: TokenJsonLdInput): string {
  return JSON.stringify(tokenJsonLd(l)).replace(/</g, "\\u003c");
}
