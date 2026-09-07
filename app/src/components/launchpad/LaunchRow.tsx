"use client";

import Link from "next/link";
import TokenAvatar from "./TokenAvatar";
import FeeChip, { feeModeOf } from "./FeeChip";
import ChainBadge from "./ChainBadge";
import type { LaunchRow as L, VolumeWindow } from "@/lib/launchpad/queries";
import { fmtQuote, fmtUsd } from "@/lib/launchpad/math";
import { ago } from "@/lib/launchpad/time";
import ChangeChip from "./ChangeChip";

export function LaunchListHeader({ window }: { window: VolumeWindow }) {
  return (
    <div className="bb-launch-columns bb-list-heading hidden md:grid gap-3 px-4 py-3 text-[11px] font-medium text-muted">
      <span>Token</span>
      <span className="text-right">Market cap</span>
      <span className="text-right">Volume{window === "all" ? "" : ` ${window}`}</span>
      <span className="text-right">Trades</span>
      <span className="text-right">Age</span>
    </div>
  );
}

/** Live highlight state for a row: fresh launch, or a trade that just landed. */
export type RowHighlight = { kind: "new" | "buy" | "sell"; at: number } | null;

export default function LaunchRow({ l, rank, window = "all", hl = null, now, pop = false }: { l: L; ethUsd?: number | null; rank?: number; window?: VolumeWindow; hl?: RowHighlight; now: number; pop?: boolean }) {
  const mode = feeModeOf(l.lp_fee, l.recipients);
  const fdvUsd = l.fdv_usd;
  const volRaw = window === "1h" ? l.volume_1h : window === "24h" ? l.volume_24h : l.volume_quote;
  const volUsd = window === "1h" ? l.volume_1h_usd : window === "24h" ? l.volume_24h_usd : l.volume_usd;
  const volLabel = volUsd !== null ? fmtUsd(volUsd, { compact: true }) : fmtQuote(volRaw, l.quote_decimals, l.quote_symbol);
  const fdvQuoteLabel = fmtQuote(BigInt(Math.round(l.fdv_quote * 10 ** l.quote_decimals)), l.quote_decimals, l.quote_symbol);
  const ageS = (now - new Date(l.block_time).getTime()) / 1000;
  const isFresh = ageS < 600; // pulsing dot for the first 10 min
  const hot = l.trades_1h >= 3;
  const flash = hl ? (hl.kind === "new" ? "bb-row-new" : hl.kind === "buy" ? "bb-row-buy" : "bb-row-sell") : "";
  return (
    <li className={`bb-launch-row relative group bg-card hover:bg-subtle transition-colors ${flash}`}>
      <Link href={`/t/${l.chain}/${l.token}`} className="absolute inset-0" aria-label={`${l.name} (${l.symbol})`} />
      <div className="bb-launch-columns grid gap-x-3 gap-y-3 items-center px-4 py-4">
        <div className="flex items-center gap-3 min-w-0">
          {typeof rank === "number" ? <span className="hidden sm:inline w-5 text-right font-mono text-xs text-faint tnum shrink-0">{rank}</span> : null}
          <div className="relative shrink-0">
            <TokenAvatar token={l.token} symbol={l.symbol} image={l.image_url} size={40} />
            {isFresh ? (
              <span className="absolute -top-1 -right-1 inline-flex h-3 w-3" aria-label="just launched">
                <span className="absolute inline-flex h-full w-full rounded-full bg-brand opacity-60 bb-pulse" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-brand border-2 border-card" />
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="bb-token-identity flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              <span className="font-semibold text-[13px] text-ink truncate max-w-full">{l.name}</span>
              <span className="font-mono text-[11px] text-muted truncate max-w-24" title={l.symbol}>{l.symbol}</span>
              <ChangeChip v={l.change_from_launch} className={`shrink-0 ${pop ? "bb-pop" : ""}`} />
              <ChainBadge chain={l.chain} className="shrink-0" />
              {hl?.kind === "new" ? <span className="shrink-0 inline-flex items-center rounded-md px-1.5 h-5 text-[10px] font-bold uppercase tracking-wide bg-brand text-brand-fg">new</span> : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              <FeeChip lpFee={l.lp_fee} mode={mode} />
              {hot ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-warm/30 bg-warm-soft px-2 h-6 text-[11px] font-medium text-warm-ink whitespace-nowrap" title="trades in the last hour">
                  {l.trades_1h} / 1h
                </span>
              ) : null}
              {l.last_trade_at ? <span className="text-[11px] text-muted font-mono whitespace-nowrap hidden sm:inline" suppressHydrationWarning>traded {ago(l.last_trade_at, now)} ago</span> : null}
              {l.description && !hot && !l.last_trade_at ? <span className="text-xs text-muted truncate hidden sm:inline">{l.description}</span> : null}
            </div>
          </div>
        </div>
        <div className="md:hidden flex flex-wrap gap-x-3 gap-y-1 items-center justify-between font-mono text-[11px] tnum text-body">
          <span>
            <span className="text-faint">mc </span>
            <span className={`text-ink font-bold ${pop ? "bb-pop inline-block" : ""}`}>{fdvUsd !== null ? fmtUsd(fdvUsd, { compact: true }) : fdvQuoteLabel}</span>
          </span>
          <span>
            <span className="text-faint">vol </span>
            {volLabel}
          </span>
          <span>
            <span className="text-faint">holders </span>
            {l.holders}
          </span>
          <span className="text-faint" suppressHydrationWarning>{ago(l.block_time, now)}</span>
        </div>
        <div className="hidden md:block text-right font-mono tnum">
          <div className={`text-ink font-bold text-sm ${pop ? "bb-pop" : ""}`}>{fdvUsd !== null ? fmtUsd(fdvUsd, { compact: true }) : fdvQuoteLabel}</div>
          {fdvUsd !== null ? <div className="text-[11px] text-muted">{fdvQuoteLabel}</div> : null}
        </div>
        <div className="hidden md:block text-right font-mono tnum text-sm text-body">{volLabel}</div>
        <div className="hidden md:block text-right font-mono tnum text-sm">
          <span className="text-up">{l.buys}</span>
          <span className="text-faint"> / </span>
          <span className="text-down-ink">{l.sells}</span>
          <div className="text-[11px] text-muted" title="holders (pool and burn excluded)">{l.holders} holders</div>
        </div>
        <div className="hidden md:block text-right font-mono tnum text-xs text-muted" suppressHydrationWarning>{ago(l.block_time, now)}</div>
      </div>
    </li>
  );
}
