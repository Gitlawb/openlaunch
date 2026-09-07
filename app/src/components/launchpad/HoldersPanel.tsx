import type { HolderPanel } from "@/lib/launchpad/holdersServer";
import { fmtShare } from "@/lib/launchpad/holders";
import { fmtCompact } from "@/lib/launchpad/math";
import { explorerAddress, shortAddr, type ChainKey } from "@/lib/chainPublic";

/**
 * Holders & trust panel (server component). Facts only — no score: who holds the supply, what the
 * creator did, who bought in the launch window, and how much sits in the locked pool.
 */
const TAG_STYLE: Record<string, string> = {
  creator: "border-brand/40 bg-brand-soft text-brand",
  pool: "border-line bg-paper text-muted",
  burn: "border-line bg-paper text-muted",
  sniper: "border-warm/40 bg-warm-soft text-warm-ink",
  whale: "border-line-strong bg-card text-ink",
};
const NOTE_STYLE = { warn: "border-warm/40 bg-warm-soft text-warm-ink", info: "border-line bg-card text-body", good: "border-up/30 bg-up-soft text-up" } as const;

export default function HoldersPanel({ chain, symbol, p }: { chain: ChainKey; symbol: string; p: HolderPanel | null }) {
  if (!p) return null;
  const supply = Number(BigInt(p.supply)) / 1e18;
  return (
    <section className="rounded-2xl bg-card border border-line shadow-card overflow-hidden" aria-label="holders">
      <div className="px-4 pt-4 pb-3 flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-ink">Holders</h2>
        <span className="text-xs text-muted">{p.synced ? "from every transfer of the token, live" : "indexing transfer history…"}</span>
      </div>
      <dl className="px-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat k="Holders" v={`${p.holders}`} />
        <Stat k="Top 10 hold" v={fmtShare(p.top10Bps)} warn={p.top10Bps >= 5000} />
        <Stat k="Creator holds" v={fmtShare(p.creator.bps)} sub={p.creator.sells > 0 ? `sold ${p.creator.sells}×` : "never sold"} warn={p.creator.bps >= 2000 || p.creator.sells > 0} />
        <Stat k="Sniped at launch" v={fmtShare(p.sniper.bps)} sub={`${p.sniper.wallets} wallet${p.sniper.wallets === 1 ? "" : "s"}`} warn={p.sniper.bps >= 1000} />
      </dl>
      <ul className="px-4 pt-3 flex flex-wrap gap-1.5">
        {p.notes.map((n) => (
          <li key={n.text} className={`inline-flex items-center h-6 px-2 rounded-full border text-[11px] font-medium ${NOTE_STYLE[n.level]}`}>
            {n.text}
          </li>
        ))}
      </ul>
      {p.top.length > 0 ? (
        <ol className="mt-3 border-t border-line divide-y divide-line">
          {p.top.map((h, i) => (
            <li key={h.address} className="px-4 py-2 flex items-center gap-3 text-sm">
              <span className="w-5 text-right font-mono text-xs text-faint tnum">{i + 1}</span>
              <a href={explorerAddress(chain, h.address)} target="_blank" rel="noreferrer" className="font-mono text-xs text-body hover:text-ink" title={h.address}>
                {shortAddr(h.address)}
              </a>
              <span className="flex gap-1">
                {h.tags.map((t) => (
                  <span key={t} className={`inline-flex items-center h-5 px-1.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide ${TAG_STYLE[t]}`}>
                    {t}
                  </span>
                ))}
              </span>
              <span className="ml-auto flex items-center gap-2 min-w-0">
                <span className="hidden sm:block h-1.5 w-24 rounded-full bg-paper overflow-hidden" aria-hidden>
                  <span className="block h-full bg-brand" style={{ width: `${Math.min(100, h.bps / 100)}%` }} />
                </span>
                <span className="font-mono tnum text-xs text-muted hidden md:inline">{fmtCompact(Number(BigInt(h.balance)) / 1e18, 1)}</span>
                <span className="font-mono tnum font-semibold text-ink w-14 text-right">{fmtShare(h.bps)}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-4 pb-4 pt-3 text-sm text-muted">{p.synced ? `Nobody holds ${symbol} outside the pool yet.` : "Holder list appears once the transfer history is indexed."}</p>
      )}
      <p className="px-4 py-3 text-[11px] text-muted border-t border-line">
        {fmtShare(p.poolBps)} of the {fmtCompact(supply, 0)} supply is in the locked Uniswap v4 pool. Pool, locker and burn addresses are never counted as holders.
      </p>
    </section>
  );
}

function Stat({ k, v, sub, warn }: { k: string; v: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 min-w-0 ${warn ? "border-warm/40 bg-warm-soft" : "border-line bg-paper"}`}>
      <dt className="text-[11px] text-muted truncate">{k}</dt>
      <dd className={`font-mono font-bold tnum truncate ${warn ? "text-warm-ink" : "text-ink"}`}>{v}</dd>
      {sub ? <dd className="text-[11px] font-mono text-muted truncate">{sub}</dd> : null}
    </div>
  );
}
