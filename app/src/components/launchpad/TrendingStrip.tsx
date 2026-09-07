"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import TokenAvatar from "./TokenAvatar";
import ChainBadge from "./ChainBadge";
import ChangeChip from "./ChangeChip";
import { useLive } from "./LiveProvider";
import type { LaunchRow } from "@/lib/launchpad/queries";
import { fmtUsd } from "@/lib/launchpad/math";
import { orderWithKing, stickyKing } from "@/lib/launchpad/trending";

/**
 * "Hot right now" strip: five cards ranked by the last hour's trades, volume and holders (see
 * lib/launchpad/trending.ts). Rides the shared live poller; cards slide to their new place (FLIP on
 * offsetLeft), a card entering the strip flashes once, and the top card only changes hands after a
 * challenger leads two polls in a row.
 */
type Snap = { window: "1h" | "24h"; items: LaunchRow[] };

export default function TrendingStrip({ initial }: { initial: Snap }) {
  const { subscribe } = useLive();
  const [snap, setSnap] = useState<Snap>(initial);
  // king + challenger streak live together so the sticky rule is a pure state update
  const [crown, setCrown] = useState<{ king: string | null; streak: { token: string | null; n: number } }>({ king: initial.items[0]?.token ?? null, streak: { token: null, n: 0 } });
  const king = crown.king;
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef(new Set(initial.items.map((i) => i.token)));
  const lefts = useRef(new Map<string, number>());
  const track = useRef<HTMLUListElement>(null);

  useEffect(
    () =>
      subscribe((live) => {
        const next = live.trending;
        if (!next) return;
        const leader = next.items[0]?.token ?? null;
        const entering = new Set(next.items.map((i) => i.token).filter((t) => !seen.current.has(t)));
        seen.current = new Set(next.items.map((i) => i.token));
        // snapshot positions for FLIP before the reorder commits
        const ul = track.current;
        if (ul) for (const el of Array.from(ul.children) as HTMLElement[]) lefts.current.set(el.dataset.token ?? "", el.offsetLeft);
        setCrown((prev) => stickyKing(prev.king, leader, prev.streak));
        setSnap(next);
        if (entering.size) {
          setFresh(entering);
          setTimeout(() => setFresh(new Set()), 1_800);
        }
      }),
    [subscribe],
  );

  useLayoutEffect(() => {
    const ul = track.current;
    if (!ul || lefts.current.size === 0) return;
    for (const el of Array.from(ul.children) as HTMLElement[]) {
      const before = lefts.current.get(el.dataset.token ?? "");
      if (before === undefined) continue;
      const dx = before - el.offsetLeft;
      if (!dx) continue;
      el.style.transition = "none";
      el.style.transform = `translateX(${dx}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)";
        el.style.transform = "";
      });
    }
    lefts.current = new Map();
  }, [snap, king]);

  const items = orderWithKing(snap.items, king);
  if (items.length === 0) return null;
  const windowLabel = snap.window === "1h" ? "last hour" : "last 24h · quiet hour";

  return (
    <section aria-label="trending" className="space-y-2.5">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="font-semibold text-ink">Trending</h2>
        <span className="text-xs text-muted">{windowLabel}</span>
      </div>
      <ul ref={track} className="flex gap-3 overflow-x-auto bb-scroll snap-x snap-mandatory pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 xl:grid xl:grid-cols-5 xl:overflow-visible">
        {items.map((l, i) => {
          const isKing = i === 0 && l.token === king;
          const win = snap.window;
          const trades = win === "1h" ? l.trades_1h : l.trades_24h;
          const vol = win === "1h" ? l.volume_1h_usd : l.volume_24h_usd;
          return (
            <li key={l.token} data-token={l.token} className={`snap-start shrink-0 min-w-0 w-[15.5rem] sm:w-[16.5rem] xl:w-auto ${fresh.has(l.token) ? "bb-flash-up" : ""}`}>
              <Link href={`/t/${l.chain}/${l.token}`} className={`block h-full rounded-2xl border bg-card p-3.5 transition-colors hover:border-ink/40 ${isKing ? "border-line-strong" : "border-line"}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <TokenAvatar token={l.token} symbol={l.symbol} image={l.image_url} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      {isKing ? (
                        <span className="text-[10px] text-muted whitespace-nowrap">#1 Trending</span>
                      ) : (
                        <span className="font-mono text-[11px] text-faint">#{i + 1}</span>
                      )}
                      <ChainBadge chain={l.chain} />
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-1.5 min-w-0">
                      <span className={`font-semibold text-ink truncate ${isKing ? "text-base" : "text-sm"}`}>{l.name}</span>
                      <span className="font-mono text-[10px] text-muted truncate max-w-16">{l.symbol}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className={`font-mono font-bold tnum text-ink ${isKing ? "text-xl" : "text-base"}`}>{l.fdv_usd !== null ? fmtUsd(l.fdv_usd, { compact: true }) : "—"}</span>
                    <span className="text-[11px] text-muted whitespace-nowrap">mcap</span>
                  </div>
                  <ChangeChip v={l.change_from_launch} />
                </div>
                <div className="mt-1.5 font-mono tnum text-[11px] text-muted truncate">
                  {trades} trades · {vol !== null ? fmtUsd(vol, { compact: true }) : "—"} · {win}
                  {isKing ? ` · ${l.holders} holders` : ""}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
