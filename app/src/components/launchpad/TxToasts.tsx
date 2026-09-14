"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import TokenAvatar from "./TokenAvatar";
import type { FeedItem } from "@/lib/launchpad/queries";
import { fmtQuote } from "@/lib/launchpad/math";
import type { ChainKey } from "@/lib/chainPublic";
import { CHAIN_SHORT, DEFAULT_CHAIN } from "@/lib/chainPublic";
import { shortAddr } from "@/lib/chainPublic";
import { useLive } from "./LiveProvider";

/**
 * Global transaction toasts. Reads the shared LiveProvider feed and pops one toast
 * per NEW launch / buy / sell (history seen on first load is not replayed).
 * Local events (your own launch / trade confirming) arrive via
 * `window.dispatchEvent(new CustomEvent("bb:toast", { detail }))` and also fire
 * a confetti burst. Max 4 on screen, 6s each, hover to pause. Reduced-motion safe.
 */
export type ToastDetail = { kind: "launch" | "buy" | "sell" | "collect" | "info"; title: string; sub?: string; chain?: ChainKey; token?: string; symbol?: string; image?: string | null; celebrate?: boolean };
type Toast = ToastDetail & { id: string; at: number; leaving?: boolean };

const TTL_MS = 6_000;
const MAX = 4;

function keyOf(i: FeedItem): string {
  return `${i.kind}:${i.tx_hash}:${i.token}${i.kind === "swap" ? `:${i.quote_wei}` : ""}`;
}

export function toast(detail: ToastDetail) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<ToastDetail>("bb:toast", { detail }));
}

export default function TxToasts() {
  const { live, subscribe } = useLive();
  const [items, setItems] = useState<Toast[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const paused = useRef(false);
  const [burst, setBurst] = useState(0);

  const push = (t: ToastDetail) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((cur) => [...cur.slice(-(MAX - 1)), { ...t, id, at: Date.now() }]);
    if (t.celebrate) setBurst((b) => b + 1);
  };

  // local events
  useEffect(() => {
    const h = (e: Event) => push((e as CustomEvent<ToastDetail>).detail);
    window.addEventListener("bb:toast", h);
    return () => window.removeEventListener("bb:toast", h);
  }, []);

  // chain feed (from the shared poller). History present at mount is remembered, not replayed.
  useEffect(() => {
    if (!seen.current) seen.current = new Set((live.feed ?? []).map(keyOf));
    return subscribe((snap) => {
      const incoming = snap.feed ?? [];
      const fresh = incoming.filter((i) => !seen.current!.has(keyOf(i))).reverse(); // oldest first
      for (const i of fresh) {
        seen.current!.add(keyOf(i));
        if (i.kind === "launch") {
          push({ kind: "launch", title: `${i.name} just launched on ${CHAIN_SHORT[i.chain]}`, sub: `${i.symbol} · by ${shortAddr(i.launcher)}${i.lp_fee === 0 ? " · 0% fee" : ""}`, chain: i.chain, token: i.token, symbol: i.symbol, image: i.image_url });
        } else {
          push({ kind: i.is_buy ? "buy" : "sell", title: `${i.is_dev ? (i.is_buy ? "Dev buy" : "Dev sold") : i.is_buy ? "Buy" : "Sell"} ${fmtQuote(i.quote_wei, i.quote_decimals, i.quote_symbol)} of ${i.symbol}`, sub: `${i.is_dev ? "creator wallet" : shortAddr(i.trader)} · ${CHAIN_SHORT[i.chain]}`, chain: i.chain, token: i.token, symbol: i.symbol, image: i.image_url });
        }
      }
      if (seen.current!.size > 2000) seen.current = new Set(incoming.map(keyOf));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  // expiry
  useEffect(() => {
    if (items.length === 0) return;
    const t = setInterval(() => {
      if (paused.current) return;
      const now = Date.now();
      setItems((cur) => {
        let changed = false;
        const next = cur
          .map((x) => {
            if (!x.leaving && now - x.at > TTL_MS) {
              changed = true;
              return { ...x, leaving: true };
            }
            return x;
          })
          .filter((x) => !(x.leaving && now - x.at > TTL_MS + 350));
        if (next.length !== cur.length) changed = true;
        return changed ? next : cur;
      });
    }, 250);
    return () => clearInterval(t);
  }, [items.length]);

  return (
    <>
      {burst > 0 ? <Confetti key={burst} /> : null}
      <div
        className="fixed z-50 inset-x-3 top-[4.25rem] sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
        onMouseEnter={() => (paused.current = true)}
        onMouseLeave={() => (paused.current = false)}
      >
        {items.map((t) => (
          <ToastCard key={t.id} t={t} onClose={() => setItems((cur) => cur.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </>
  );
}

function ToastCard({ t, onClose }: { t: Toast; onClose: () => void }) {
  const accent = t.kind === "buy" ? "bg-up" : t.kind === "sell" ? "bg-down" : t.kind === "launch" ? "bg-brand" : "bg-warm";
  const inner = (
    <div className={`pointer-events-auto flex items-center gap-3 rounded-2xl bg-card border border-line shadow-dialog pl-3 pr-2 py-2.5 w-full sm:w-80 ${t.leaving ? "bb-toast-out" : "bb-toast-in"}`}>
      <span className={`h-9 w-1 rounded-full ${accent} shrink-0`} aria-hidden />
      {t.token && t.symbol ? <TokenAvatar chain={t.chain ?? "unknown"} token={t.token} symbol={t.symbol} image={t.image} size={32} /> : null}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-ink truncate">{t.title}</div>
        {t.sub ? <div className="text-[11px] text-muted font-mono truncate">{t.sub}</div> : null}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        aria-label="Dismiss"
        className="h-7 w-7 rounded-lg text-faint hover:text-ink hover:bg-paper grid place-items-center shrink-0"
      >
        ×
      </button>
    </div>
  );
  return t.token ? (
    <Link href={`/t/${t.chain ?? DEFAULT_CHAIN}/${t.token}`} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** 24 CSS particles, one burst, no library. Positions are drawn once (lazy state) so render stays pure. */
function Confetti() {
  const colors = ["#0052FF", "#15803D", "#D97706", "#DC2626", "#0F172A"];
  const [parts] = useState(() =>
    Array.from({ length: 24 }, (_, i) => ({
      left: 50 + (Math.random() - 0.5) * 40,
      dx: (Math.random() - 0.5) * 60,
      delay: Math.random() * 0.2,
      rot: Math.random() * 720 - 360,
      color: colors[i % colors.length],
    })),
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden>
      {parts.map((p, i) => (
        <span
          key={i}
          className="bb-confetti absolute top-[45%] h-2.5 w-1.5 rounded-sm"
          style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, ["--dx" as string]: `${p.dx}vw`, ["--rot" as string]: `${p.rot}deg` }}
        />
      ))}
    </div>
  );
}
