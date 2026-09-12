import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATIC_SITEMAP_ROUTES,
  canonicalUrl,
  isCanonicalTokenPath,
  jsonLdHtml,
  staticSitemapEntries,
  tokenCanonical,
  tokenJsonLd,
  tokenPath,
  tokenSitemapEntries,
} from "./seo.ts";

const SITE = "https://openlaunch.lol";
const TOKEN = "0x1234567890abcdef1234567890abcdef12345678";

test("canonicalUrl joins base + path without double slashes", () => {
  assert.equal(canonicalUrl(SITE, "/"), `${SITE}/`);
  assert.equal(canonicalUrl(`${SITE}/`, "/launch"), `${SITE}/launch`);
  assert.equal(canonicalUrl(SITE, "feed"), `${SITE}/feed`);
});

test("token path helpers lowercase the address", () => {
  assert.equal(tokenPath("base", TOKEN.toUpperCase()), `/t/base/${TOKEN}`);
  assert.equal(tokenCanonical(SITE, "base", TOKEN), `${SITE}/t/base/${TOKEN}`);
});

test("isCanonicalTokenPath rejects bad chains and addresses", () => {
  assert.equal(isCanonicalTokenPath("base", TOKEN), true);
  assert.equal(isCanonicalTokenPath("robinhood", TOKEN), true);
  assert.equal(isCanonicalTokenPath("ethereum", TOKEN), false);
  assert.equal(isCanonicalTokenPath("base", "not-an-address"), false);
  assert.equal(isCanonicalTokenPath("base", "0x123"), false);
});

test("static sitemap covers every public route and skips /admin", () => {
  const paths = STATIC_SITEMAP_ROUTES.map((r) => r.path);
  for (const p of ["/", "/launch", "/feed", "/rules", "/agents", "/me"]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
  assert.ok(!paths.includes("/admin"), "/admin must stay out of the sitemap");
  const entries = staticSitemapEntries(SITE, "2026-09-06T00:00:00.000Z");
  assert.equal(entries.length, STATIC_SITEMAP_ROUTES.length);
  for (const entry of entries) {
    assert.equal(new URL(entry.url).origin, new URL(SITE).origin);
  }
  assert.equal(entries[0].url, `${SITE}/`);
});

test("token sitemap skips invalid rows and keeps block_time", () => {
  const entries = tokenSitemapEntries(SITE, [
    { chain: "base", token: TOKEN, block_time: "2026-09-06T00:00:00.000Z" },
    { chain: "base", token: "junk", block_time: null },
    { chain: "ethereum" as never, token: TOKEN, block_time: null },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, `${SITE}/t/base/${TOKEN}`);
  assert.equal(entries[0].lastModified, "2026-09-06T00:00:00.000Z");
  assert.equal(entries[0].priority, 0.9);
});

test("token JSON-LD is facts-only: identifiers, no scores", () => {
  const ld = tokenJsonLd({
    name: "Trend Coin",
    symbol: "TREND",
    chain: "base",
    chainId: 8453,
    token: TOKEN,
    launcher: "0xAbC0000000000000000000000000000000000001",
    quoteSymbol: "ETH",
    supply: "1000000000000000000000000000",
    poolId: "0xpool",
    startTick: 184200,
    lpFee: 10000,
    blockTime: "2026-09-06T00:00:00.000Z",
    description: null,
    siteUrl: SITE,
  });
  assert.equal(ld["@type"], "WebPage");
  assert.equal(ld["url"], `${SITE}/t/base/${TOKEN}`);
  const about = ld["about"] as Record<string, unknown>;
  assert.equal(about["identifier"], TOKEN);
  const text = JSON.stringify(ld).toLowerCase();
  assert.ok(!text.includes("score"), "no scores");
  assert.ok(!text.includes("trust"), "no trust flags");
  assert.ok(!text.includes("rank"), "no rankings");
});

test("jsonLdHtml escapes < so creator input cannot break out of the script tag", () => {
  const input = {
    name: "</script><script>alert(1)</script>",
    symbol: "XSS",
    chain: "base" as const,
    chainId: 8453,
    token: TOKEN,
    launcher: "0xAbC0000000000000000000000000000000000001",
    quoteSymbol: "ETH",
    supply: "1000000000000000000000000000",
    poolId: "0xpool",
    startTick: 184200,
    lpFee: 10000,
    blockTime: "2026-09-06T00:00:00.000Z",
    description: "a < b",
    siteUrl: SITE,
  };
  const html = jsonLdHtml(input);
  assert.ok(!html.includes("<"), "no literal angle brackets remain");
  assert.ok(html.includes("\\u003c/script>"), "closing tag is unicode-escaped");
  assert.deepEqual(JSON.parse(html.replace(/\\u003c/g, "<")), JSON.parse(JSON.stringify(tokenJsonLd(input))), "escapes round-trip");
});
