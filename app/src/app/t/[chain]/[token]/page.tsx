import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAddress, type Address } from "viem";
import TokenAvatar from "@/components/launchpad/TokenAvatar";
import FeeChip, { feeModeOf } from "@/components/launchpad/FeeChip";
import TradePanel from "@/components/launchpad/TradePanel";
import CollectPanel from "@/components/launchpad/CollectPanel";
import CopyChip from "@/components/launchpad/CopyChip";
import MobileBuyBar from "@/components/launchpad/MobileBuyBar";
import PriceChart from "@/components/launchpad/PriceChart";
import TokenComments from "@/components/launchpad/Posts";
import ChangeChip from "@/components/launchpad/ChangeChip";
import HoldersPanel from "@/components/launchpad/HoldersPanel";
import { getHolderPanel } from "@/lib/launchpad/holdersServer";
import { memo } from "@/lib/launchpad/memo";
import { ago, nowMs } from "@/lib/launchpad/time";
import ChainBadge from "@/components/launchpad/ChainBadge";
import { getLaunch, getSwaps } from "@/lib/launchpad/queries";
import { ethUsd } from "@/lib/launchpad/ethPrice";
import { NATIVE, TICK_SPACING, uniswapSwapUrl, type Quote } from "@/lib/launchpad/config";
import { fmtCompact, fmtPrice, fmtQuote, fmtUsd } from "@/lib/launchpad/math";
import { CHAIN_LABELS, SITE_URL, explorerAddress, explorerName, explorerTx, isChainKey, shortAddr } from "@/lib/chainPublic";
import { stockByAddress } from "@/lib/launchpad/stocksServer";
import { BRAND_DOMAIN, BRAND_X } from "@/lib/brand";
import { clampSocial } from "@/lib/launchpad/ogcard";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ chain: string; token: string }> }): Promise<Metadata> {
  const { chain, token } = await params;
  const l = isChainKey(chain) && isAddress(token) ? await getLaunch(chain, token) : null;
  if (!l) return { title: "Token not found" };
  const title = `${l.name} (${l.symbol})`;
  const description = clampSocial(l.description ?? `${l.name} launched on openlaunch.lol — 100% of supply locked as Uniswap v4 liquidity on ${CHAIN_LABELS[l.chain]}, ${l.lp_fee === 0 ? "0% trading fee" : "no platform fee"}.`, 155);
  // Next replaces nested metadata objects rather than merging them, so repeat the site-level fields here:
  // og:site_name (Discord shows it above the title) and twitter summary_large_image (full-width card).
  return {
    title,
    description,
    openGraph: { siteName: BRAND_DOMAIN, type: "website", title, description: clampSocial(description), url: `${SITE_URL}/t/${l.chain}/${l.token}` },
    twitter: { card: "summary_large_image", site: `@${BRAND_X}`, title, description: clampSocial(description) },
  };
}

export default async function TokenPage({ params }: { params: Promise<{ chain: string; token: string }> }) {
  const { chain, token } = await params;
  if (!isChainKey(chain) || !isAddress(token)) notFound();
  const usd = await ethUsd();
  const l = await getLaunch(chain, token, usd);
  if (!l) notFound();
  const quote: Quote = {
    key: l.quote === NATIVE ? "eth" : l.quote_symbol === "USDG" ? "usdg" : "stock",
    address: l.quote as Address,
    symbol: l.quote_symbol,
    decimals: l.quote_decimals,
    usd: l.quote_usd,
  };
  const stockQuote = quote.key === "stock" ? stockByAddress(chain, l.quote) : null;
  const [swaps, holders] = await Promise.all([getSwaps(chain, l.token, quote.decimals, 40), memo(`holders:${chain}:${l.token}`, 5_000, () => getHolderPanel(chain, l.token))]);
  const now = nowMs();
  const mode = feeModeOf(l.lp_fee, l.recipients);
  const poolKey = { currency0: l.quote as Address, currency1: l.token as Address, fee: l.lp_fee, tickSpacing: TICK_SPACING, hooks: NATIVE as Address };
  const priceUsd = l.price_usd;
  const fdvUsd = l.fdv_usd;
  const chainLabel = CHAIN_LABELS[chain];
  const fdvQuoteLabel = fmtQuote(BigInt(Math.round(l.fdv_quote * 10 ** quote.decimals)), quote.decimals, quote.symbol);
  const shareText = `${l.name} ($${l.symbol}) on ${chainLabel} — ${l.lp_fee === 0 ? "0% fee" : mode === "burn" ? "fees burned" : "no platform fee"}, liquidity locked forever`;

  return (
    <>
      <div className="bb-sky" aria-hidden />
      <main className="relative mx-auto max-w-6xl px-4 pt-6 sm:pt-8 pb-24 md:pb-16 space-y-6">
        <nav className="text-xs text-muted">
          <Link href="/" className="hover:text-ink">
            Launchpad
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-body">{l.symbol}</span>
          <span className="mx-1.5">·</span>
          <ChainBadge chain={chain} />
        </nav>

        {/* header */}
        <header className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
          <TokenAvatar token={l.token} symbol={l.symbol} image={l.image_url} size={72} className="rounded-2xl hidden sm:block" />
          <TokenAvatar token={l.token} symbol={l.symbol} image={l.image_url} size={48} className="rounded-xl sm:hidden" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="font-display font-bold tracking-[-0.02em] text-ink text-2xl sm:text-3xl break-words">{l.name}</h1>
              <span className="font-mono text-base text-muted">{l.symbol}</span>
              <FeeChip lpFee={l.lp_fee} mode={mode} />
              <ChainBadge chain={chain} size="md" />
            </div>
            {l.description ? <p className="mt-1.5 text-[15px] text-body max-w-2xl">{l.description}</p> : null}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <CopyChip value={l.token} />
              <a href={explorerAddress(chain, l.token)} target="_blank" rel="noreferrer" className="h-7 px-2.5 inline-flex items-center rounded-full border border-line bg-card text-[11px] font-medium text-body hover:text-ink hover:border-line-strong">
                {explorerName(chain)} ↗
              </a>
              <a href={uniswapSwapUrl(chain, l.token)} target="_blank" rel="noreferrer" className="h-7 px-2.5 inline-flex items-center rounded-full border border-line bg-card text-[11px] font-medium text-body hover:text-ink hover:border-line-strong">
                {chain === "base" ? "Uniswap" : "pools.trade"} ↗
              </a>
              {l.website ? (
                <a href={l.website} target="_blank" rel="noreferrer nofollow" className="h-7 px-2.5 inline-flex items-center rounded-full border border-line bg-card text-[11px] font-medium text-body hover:text-ink hover:border-line-strong">
                  {new URL(l.website).host} ↗
                </a>
              ) : null}
              {l.x_handle ? (
                <a href={`https://x.com/${l.x_handle}`} target="_blank" rel="noreferrer nofollow" className="h-7 px-2.5 inline-flex items-center rounded-full border border-line bg-card text-[11px] font-medium text-body hover:text-ink hover:border-line-strong">
                  @{l.x_handle}
                </a>
              ) : null}
              <a
                href={`https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(`${SITE_URL}/t/${chain}/${l.token}`)}`}
                target="_blank"
                rel="noreferrer"
                className="h-7 px-2.5 inline-flex items-center rounded-full border border-line bg-card text-[11px] font-medium text-body hover:text-ink hover:border-line-strong"
              >
                Share on X
              </a>
            </div>
          </div>
          <div className="sm:text-right shrink-0 flex items-baseline justify-between sm:block gap-3">
            <div className="font-display font-bold tracking-[-0.02em] text-ink text-3xl sm:text-4xl tnum">{fdvUsd !== null ? fmtUsd(fdvUsd, { compact: true }) : fdvQuoteLabel}</div>
            <div className="sm:mt-1 flex sm:justify-end items-center gap-2 text-xs text-muted">
              <span>market cap</span>
              <ChangeChip v={l.change_from_launch} />
              {stockQuote ? (
                <span className="inline-flex items-center gap-1.5 h-6 pl-1 pr-2 rounded-full border border-line bg-card text-[11px] font-semibold text-ink" title={`${stockQuote.name} · quote asset`}>
                  {stockQuote.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={stockQuote.logo} alt="" width={16} height={16} className={stockQuote.logo.startsWith("data:") ? "rounded" : "rounded-full"} referrerPolicy="no-referrer" />
                  ) : null}
                  priced in {stockQuote.symbol}
                </span>
              ) : null}
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem] gap-6 items-start">
          <div className="min-w-0 space-y-6 order-2 lg:order-1">
            <PriceChart chain={chain} token={l.token} symbol={l.symbol} launchedAt={l.block_time} />
            {/* stats */}
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <Stat k="Price" v={priceUsd !== null ? fmtUsd(priceUsd) : `${fmtPrice(l.price_quote)} ${quote.symbol}`} sub={priceUsd !== null ? `${fmtPrice(l.price_quote)} ${quote.symbol}` : null} />
              <Stat k="Volume" v={fmtQuote(l.volume_quote, quote.decimals, quote.symbol)} sub={l.volume_usd !== null ? fmtUsd(l.volume_usd, { compact: true }) : null} />
              <Stat k="Trades" v={`${l.buys + l.sells}`} sub={`${l.buys} buys · ${l.sells} sells`} />
              <Stat k="Supply" v={fmtCompact(Number(BigInt(l.supply)) / 1e18, 0)} sub="100% in the pool" />
              <Stat k="Launched" v={`${ago(l.block_time, now)} ago`} sub={new Date(l.block_time).toUTCString().replace(" GMT", " UTC")} />
              <Stat k="Platform fee" v="0" sub="by construction" accent />
            </dl>

            {/* holders & trust */}
            <HoldersPanel chain={chain} symbol={l.symbol} p={holders} />

            {/* trades */}
            <section className="rounded-2xl bg-card border border-line shadow-card overflow-hidden">
              <div className="px-4 h-11 flex items-center justify-between border-b border-line">
                <h2 className="text-sm font-semibold text-ink">Trades</h2>
                <span className="text-[11px] text-muted">latest {swaps.length}</span>
              </div>
              {swaps.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted">No trades yet. Be the first.</p>
              ) : (
                <div className="overflow-x-auto bb-scroll">
                  <table className="w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-[0.08em] text-muted">
                      <tr className="border-b border-line">
                        <th className="text-left font-semibold px-4 py-2">Side</th>
                        <th className="text-right font-semibold px-4 py-2">{quote.symbol}</th>
                        <th className="text-right font-semibold px-4 py-2">{l.symbol}</th>
                        <th className="text-right font-semibold px-4 py-2 hidden sm:table-cell">Price</th>
                        <th className="text-left font-semibold px-4 py-2 hidden md:table-cell">Trader</th>
                        <th className="text-right font-semibold px-4 py-2">Age</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tnum">
                      {swaps.map((s) => {
                        const q = BigInt(s.amount0);
                        const t = BigInt(s.amount1);
                        return (
                          <tr key={`${s.tx_hash}:${s.log_index}`} className="border-b border-line last:border-0 hover:bg-paper">
                            <td className="px-4 py-2">
                              <span className={`font-sans font-semibold ${s.is_buy ? "text-up" : "text-down-ink"}`}>{s.is_buy ? "Buy" : "Sell"}</span>
                            </td>
                            <td className="px-4 py-2 text-right text-ink">{fmtQuote(q < 0n ? -q : q, quote.decimals, "").trim()}</td>
                            <td className="px-4 py-2 text-right text-body">{fmtCompact(Number(t < 0n ? -t : t) / 1e18)}</td>
                            <td className="px-4 py-2 text-right text-muted hidden sm:table-cell">{l.quote_usd !== null ? fmtUsd(s.price_quote * l.quote_usd) : `${fmtPrice(s.price_quote)} ${quote.symbol}`}</td>
                            <td className="px-4 py-2 text-left text-muted hidden md:table-cell">
                              {s.trader ? (
                                <a href={explorerAddress(chain, s.trader)} target="_blank" rel="noreferrer" className="hover:text-ink">
                                  {shortAddr(s.trader)}
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-4 py-2 text-right text-muted">
                              <a href={explorerTx(chain, s.tx_hash)} target="_blank" rel="noreferrer" className="hover:text-ink">
                                {ago(s.block_time, now)}
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <TokenComments chain={chain} token={l.token} symbol={l.symbol} launcher={l.launcher} />

            {/* details */}
            <section className="rounded-2xl bg-card border border-line shadow-card p-4">
              <h2 className="text-sm font-semibold text-ink">On-chain</h2>
              <dl className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <Row k="Chain" v={<span className="text-body">{chainLabel}</span>} />
                <Row k="Token" v={<A href={explorerAddress(chain, l.token)}>{shortAddr(l.token)}</A>} />
                <Row k="Creator" v={<A href={explorerAddress(chain, l.launcher)}>{shortAddr(l.launcher)}</A>} />
                <Row k="Launch tx" v={<A href={explorerTx(chain, l.tx_hash)}>{shortAddr(l.tx_hash)}</A>} />
                <Row k="Pool id" v={<span className="font-mono text-muted">{shortAddr(l.pool_id)}</span>} />
                <Row k="Pool" v={<span className="text-body">{quote.symbol} / {l.symbol} · Uniswap v4 · no hook</span>} />
                <Row k="Liquidity" v={<span className="text-up font-medium">locked forever in the locker</span>} />
              </dl>
            </section>
          </div>

          <div className="lg:sticky lg:top-32 min-w-0 space-y-4 order-1 lg:order-2">
            <TradePanel chain={chain} token={l.token as Address} symbol={l.symbol} poolKey={poolKey} quote={quote} ethUsd={usd} />
            <CollectPanel
              chain={chain}
              quote={quote}
              tokenId={l.token_id}
              symbol={l.symbol}
              lpFee={l.lp_fee}
              recipients={l.recipients}
              collectedQuote={l.fees_quote_collected}
              burnedQuote={l.fees_quote_burned}
              burnedToken={l.fees_token_burned}
              ethUsd={usd}
            />
          </div>
        </div>
      </main>

      <MobileBuyBar symbol={l.symbol} mcap={fdvUsd !== null ? fmtUsd(fdvUsd, { compact: true }) : fdvQuoteLabel} />
    </>
  );
}

function Stat({ k, v, sub, accent }: { k: string; v: string; sub?: string | null; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-card border border-line shadow-card px-3.5 py-3 min-w-0">
      <dt className="text-xs text-muted truncate">{k}</dt>
      <dd className={`mt-0.5 font-mono font-bold text-lg tnum truncate ${accent ? "text-up" : "text-ink"}`}>{v}</dd>
      {sub ? <dd className="text-[11px] font-mono tnum text-muted truncate">{sub}</dd> : null}
    </div>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-line last:border-0 sm:[&:nth-last-child(2)]:border-0">
      <dt className="text-muted">{k}</dt>
      <dd className="font-mono tnum text-right min-w-0 truncate">{v}</dd>
    </div>
  );
}
function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-ink hover:underline underline-offset-2">
      {children}
    </a>
  );
}
