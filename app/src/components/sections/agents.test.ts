import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { agentExamples } from "./agent-examples.ts";
import { CHAINS, SITE_URL } from "@/lib/chainPublic";
import { launchpad, NATIVE } from "@/lib/launchpad/config";

const page = readFileSync(new URL("../../app/agents/page.tsx", import.meta.url), "utf8");
const codePanel = readFileSync(new URL("./AgentsCodeBlock.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./Agents.module.css", import.meta.url), "utf8");

// Source contracts protect the documentation's reference text and safety
// boundaries. Responsive geometry and clipboard interaction get browser review.
test("agent documentation preserves contract guidance without executable signing examples", () => {
  for (const literal of [
    'launch(params)', 'findSalt(...)',
    '10000 = 1%', '30000 = 3%', '184200 ≈ 10 ETH',
    '{chain, launcher, salt, name, symbol, description?, image_url?, website?, x_handle?}',
    'metadataURI', 'V4_SWAP', 'poolKeyOf(token)', 'collect(tokenId)',
  ]) assert.ok(page.includes(literal), `Missing contract reference: ${literal}`);
  assert.match(page, /Never share your private key/);
  assert.match(page, /Example only/);
  assert.match(page, /not an executable transaction/);
  assert.doesNotMatch(page, /cast send|--private-key|\$PK/);
  assert.match(page, /launchpad\(chain\)\.quotes/);
});

test("each launch reference uses the configured factory, actual chain ID and ABI parameter names", () => {
  const examples = agentExamples("launch");
  assert.equal(examples.length, 2);
  for (const chain of ["base", "robinhood"] as const) {
    const example = examples.find((item) => item.chain === chain)!;
    const parsed = JSON.parse(example.code);
    assert.equal(parsed.chainId, CHAINS[chain].id);
    assert.equal(parsed.factory, launchpad(chain).factory ?? "<factory-not-configured>");
    assert.equal(parsed.function, "launch((string,string,string,address,uint256,int24,uint24,bytes32,(address,uint16)[]))");
    assert.equal(parsed.params.quote, NATIVE);
    assert.deepEqual(parsed.params.recipients, [{ payout: "<beneficiary-wallet-address>", bps: 10000 }]);
    assert.equal(parsed.params.salt, "<unique-32-byte-salt>");
    assert.doesNotMatch(example.code, /private.?key|sendTransaction|writeContract|cast send/i);
  }
});

test("HTTP examples choose supported chain filters and never imply the feed is chain-filtered", () => {
  for (const chain of ["base", "robinhood"] as const) {
    const read = agentExamples("read").find((item) => item.chain === chain)!.code;
    assert.ok(read.includes(`/api/launch/list?chain=${chain}&sort=live&window=24h&limit=50`));
    assert.ok(read.includes(`/api/launch/meta/<token>?chain=${chain}`));
    assert.ok(read.includes(`GET ${SITE_URL}/api/launch/feed  # both chains`));
    assert.doesNotMatch(read, /feed\?chain=/);
    assert.ok(agentExamples("sync").find((item) => item.chain === chain)!.code.includes(`/api/launch/sync?chain=${chain}&tx=<confirmed-transaction-hash>`));
  }
});

test("agent documentation retains every public endpoint and configured chain", () => {
  for (const path of [
    '/api/launch/list', '?chain=base|robinhood&sort=live|new|mcap|volume|gainers|holders&window=1h|24h|all&limit=50',
    '/api/launch/feed', '/api/launch/meta/<token>', '/llms.txt',
    '/api/launch/meta',
  ]) assert.ok(page.includes(path), `Missing endpoint: ${path}`);
  assert.match(page, /CHAIN_KEYS\.map/);
  assert.match(page, /config = launchpad\(chain\)/);
  assert.match(page, /\["factory", "locker"\]/);
  assert.match(page, /config\[contract\] \? <a href=\{explorerAddress\(chain, config\[contract\]\)\}/);
  assert.match(page, /not deployed yet/);
  assert.match(page, /CHAINS\[chain\]\.id/);
  assert.match(page, /href=\{BRAND_GITHUB\}/);
});

test("agent reference distinguishes quote units, unknown prices and indexing freshness", () => {
  for (const field of ['quote_decimals', 'price_quote', 'fdv_quote', 'price_usd', 'fdv_usd', 'volume_usd', 'null']) {
    assert.ok(page.includes(`<code>${field}</code>`), `Missing data convention: ${field}`);
  }
  assert.match(page, /Poll modestly and back off on errors/);
  assert.match(page, /not a guarantee of the latest chain state/);
  assert.match(page, /receipt availability and RPC errors can delay indexing/);
  assert.match(page, /issuer-registry stock token/);
  assert.match(page, /Regulation S, not to US persons/);
  assert.doesNotMatch(page, /floats in ETH|Poll freely|small and uncached|ETH \/ token/);
});

test("agent sections have native focus targets and accessible copy-only references", () => {
  for (const id of ['launch', 'read', 'trade']) {
    assert.ok(page.includes(`id: "${id}"`));
    assert.ok(page.includes(`<section id="${id}" tabIndex={-1}`));
  }
  assert.match(page, /aria-label="Agent documentation sections"/);
  assert.match(codePanel, /<button type="button" onClick=\{copy\}/);
  assert.match(codePanel, /navigator\.clipboard\.writeText\(code\)/);
  assert.match(codePanel, /if \(alive\.current\) setStatus\("error"\)/);
  assert.match(codePanel, /setTimeout\(\(\) => setStatus\("idle"\), 2400\)/);
  assert.match(codePanel, /clearTimeout\(timer\.current\)/);
  assert.match(codePanel, /<CopyReference key=\{selected\?\.code \?\? code\}/);
  assert.match(codePanel, /<select value=\{chain\}/);
  assert.match(codePanel, /role="status"/);
  assert.match(codePanel, /Copy unavailable\. Select and copy the code instead/);
  assert.match(codePanel, /<pre tabIndex=\{0\} role="region" aria-label=/);
  assert.doesNotMatch(codePanel, /fetch\(|eval\(|new Function|writeContract|sendTransaction|useWallet|setInterval/);
  assert.doesNotMatch(page, /"use client"/);
});

test("agent code stays width-constrained and uses the existing flat theme", () => {
  assert.match(css, /grid-template-columns: 176px minmax\(0, 1fr\)/);
  assert.match(css, /\.code \{ max-width: 100%; min-width: 0;[^}]*overflow-x: auto/);
  assert.match(css, /\.copyButton \{[^}]*min-height: 44px/);
  assert.match(css, /\.network dd a \{[^}]*min-height: 44px/);
  assert.match(css, /\.code:focus-visible/);
  assert.match(css, /@media \(max-width: 479px\)/);
  assert.doesNotMatch(css, /box-shadow|text-shadow|gradient\(|animation:|#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /background(?:-color)?: var\(--color-brand\)/);
  assert.doesNotMatch(page + codePanel + css, /font-display|font-unbounded|\u2014/);
});
