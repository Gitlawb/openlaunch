"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import LaunchRow, { LaunchListHeader, type RowHighlight } from "./LaunchRow";
import { useLive } from "./LiveProvider";
import { btn } from "@/components/ui";
import type { LaunchRow as L, LaunchSort, VolumeWindow } from "@/lib/launchpad/queries";
import { CHAIN_SHORT, type ChainKey } from "@/lib/chainPublic";
import { FILTERS, isAddressQuery, matchesFilter, matchesQuery, normalizeQuery, rankHit, type LaunchFilter } from "@/lib/launchpad/search";
import { PAGE_SIZE } from "@/lib/launchpad/paging";
import { Spinner } from "@/components/Skeleton";
import { startNav } from "@/components/RouteProgress";

const SORTS: { key: LaunchSort; label: string }[] = [
  { key: "new", label: "New" },
  { key: "trending", label: "Trending" },
  { key: "mcap", label: "Market cap" },
  { key: "volume", label: "Volume" },
  { key: "gainers", label: "Gainers" },
  { key: "holders", label: "Holders" },
];
const WINDOWS: VolumeWindow[] = ["1h", "24h", "all"];
const HL_NEW_MS = 60_000;
const HL_TRADE_MS = 2_500;
const POP_MS = 400;
const REORDER_QUIET_MS = 3_000;

/**
 * Live launch list. Seeded from the server; then every tick from LiveProvider:
 *   - a token we have not seen → "new" glow for 60s (and it enters at the top)
 *   - buys/sells count went up → green/red flash + market-cap pop
 *   - order changes are applied only when the user has not tapped in 3s, and
 *     rows that moved slide to their new place (FLIP on the row's offsetTop).
 * Sort / window switch instantly (no reload) and are mirrored into the URL.
 */
const CHAIN_FILTERS: { key: ChainKey | null; label: string }[] = [
  { key: null, label: "All chains" },
  { key: "base", label: CHAIN_SHORT.base },
  { key: "robinhood", label: CHAIN_SHORT.robinhood },
];

export default function LaunchList({ initial, initialHasMore = false, initialSort, initialWindow, initialChain, initialFilter = null, hasDb }: { initial: L[]; initialHasMore?: boolean; initialSort: LaunchSort; initialWindow: VolumeWindow; initialChain: ChainKey | null; initialFilter?: LaunchFilter | null; ethUsd?: number | null; hasDb: boolean }) {
  const router = useRouter();
  const { live, setListParams, subscribe } = useLive();
  const [sort, setSort] = useState<LaunchSort>(initialSort);
  const [window_, setWindow] = useState<VolumeWindow>(initialWindow);
  const [chain, setChain] = useState<ChainKey | null>(initialChain);
  const [filter, setFilter] = useState<LaunchFilter | null>(initialFilter);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<L[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [limit, setLimit] = useState(Math.max(PAGE_SIZE, initial.length));
  const [rows, setRows] = useState<L[]>(initial);
  const [hl, setHl] = useState<Map<string, RowHighlight>>(new Map());
  const [pop, setPop] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const prev = useRef<Map<string, L>>(new Map(initial.map((l) => [l.token, l])));
  const lastTap = useRef(0);
  const pendingOrder = useRef<L[] | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const tops = useRef<Map<string, number>>(new Map());

  // register what we want polled
  useEffect(() => {
    setListParams({ sort, window: window_, chain, filter, limit });
    return () => setListParams(null);
  }, [sort, window_, chain, filter, limit, setListParams]);

  // clock for "ago" labels
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  // apply a tick (subscription callback, not an effect body)
  const sortRef = useRef({ sort, window: window_, chain, filter });
  sortRef.current = { sort, window: window_, chain, filter };
  const hlRef = useRef(hl);
  hlRef.current = hl;
  useEffect(
    () =>
      subscribe((snap) => {
        const incoming = snap.launches;
        if (!incoming || snap.sort !== sortRef.current.sort || snap.window !== sortRef.current.window || (snap.chain ?? null) !== sortRef.current.chain || (snap.filter ?? null) !== sortRef.current.filter) return;
        const t = Date.now();
        const nextHl = new Map(hlRef.current);
        const nextPop = new Set<string>();
        for (const l of incoming) {
          const p = prev.current.get(l.token);
          if (!p) {
            if (t - new Date(l.block_time).getTime() < 10 * 60_000) nextHl.set(l.token, { kind: "new", at: t });
          } else if (l.buys > p.buys || l.sells > p.sells) {
            nextHl.set(l.token, { kind: l.sells > p.sells && l.buys === p.buys ? "sell" : "buy", at: t });
            nextPop.add(l.token);
          }
        }
        prev.current = new Map(incoming.map((l) => [l.token, l]));
        if (typeof snap.has_more === "boolean") setHasMore(snap.has_more);
        setHl(nextHl);
        if (nextPop.size) {
          setPop(nextPop);
          setTimeout(() => setPop(new Set()), POP_MS);
        }
        const quiet = t - lastTap.current > REORDER_QUIET_MS;
        if (quiet) {
          pendingOrder.current = null;
          snapshotTops();
          setRows(incoming);
        } else {
          pendingOrder.current = incoming;
          const byToken = new Map(incoming.map((l) => [l.token, l]));
          setRows((cur) => {
            const kept = cur.map((r) => byToken.get(r.token) ?? r);
            const fresh = incoming.filter((l) => !cur.some((r) => r.token === l.token));
            return [...fresh, ...kept];
          });
          setTimeout(() => {
            if (pendingOrder.current) {
              snapshotTops();
              setRows(pendingOrder.current);
              pendingOrder.current = null;
            }
          }, REORDER_QUIET_MS);
        }
      }),
    [subscribe],
  );

  // expire highlights
  useEffect(() => {
    if (hl.size === 0) return;
    const t = setInterval(() => {
      const n = Date.now();
      setHl((cur) => {
        let changed = false;
        const next = new Map(cur);
        for (const [k, v] of cur) {
          if (v && n - v.at > (v.kind === "new" ? HL_NEW_MS : HL_TRADE_MS)) {
            next.delete(k);
            changed = true;
          }
        }
        return changed ? next : cur;
      });
    }, 500);
    return () => clearInterval(t);
  }, [hl]);

  function snapshotTops() {
    const ul = listRef.current;
    if (!ul) return;
    tops.current = new Map();
    for (const el of Array.from(ul.children) as HTMLElement[]) tops.current.set(el.dataset.token ?? "", el.offsetTop);
  }

  // FLIP: slide rows from their old offset to the new one
  useLayoutEffect(() => {
    const ul = listRef.current;
    if (!ul || tops.current.size === 0) return;
    for (const el of Array.from(ul.children) as HTMLElement[]) {
      const before = tops.current.get(el.dataset.token ?? "");
      if (before === undefined) continue;
      const dy = before - el.offsetTop;
      if (!dy) continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)";
        el.style.transform = "";
      });
    }
    tops.current = new Map();
  }, [rows]);

  const pick = (s: LaunchSort, w: VolumeWindow = window_, c: ChainKey | null = chain, f: LaunchFilter | null = filter) => {
    lastTap.current = Date.now();
    snapshotTops();
    setSort(s);
    setWindow(w);
    setChain(c);
    setFilter(f);
    setLimit(PAGE_SIZE);
    setHasMore(true);
    const p = new URLSearchParams();
    if (s !== "new") p.set("sort", s);
    if (s === "volume" && w !== "all") p.set("window", w);
    if (c) p.set("chain", c);
    if (f) p.set("filter", f);
    router.replace(p.size ? `/?${p}` : "/", { scroll: false });
  };

  // search: instant over loaded rows, then the server for anything older (300ms debounce); an address jumps straight to the token
  useEffect(() => {
    const n = normalizeQuery(q);
    if (!n) return; // an empty query ignores `remote` below
    let alive = true;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/launch/search?q=${encodeURIComponent(n)}${chain ? `&chain=${chain}` : ""}`, { cache: "no-store" });
        const d = (await res.json()) as { launches: L[] };
        if (!alive) return;
        if (isAddressQuery(n) && d.launches.length === 1) {
          startNav();
          router.push(`/t/${d.launches[0].chain}/${d.launches[0].token}`);
          return;
        }
        setRemote(d.launches);
      } catch {
        if (alive) setRemote(null);
      } finally {
        if (alive) setSearching(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, chain, router]);

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const p = new URLSearchParams({ sort, window: window_, limit: String(PAGE_SIZE), offset: String(rows.length) });
      if (chain) p.set("chain", chain);
      if (filter) p.set("filter", filter);
      const res = await fetch(`/api/launch/list?${p}`, { cache: "no-store" });
      const d = (await res.json()) as { launches: L[]; has_more: boolean };
      const seen = new Set(rows.map((r) => `${r.chain}:${r.token}`));
      const extra = d.launches.filter((l) => !seen.has(`${l.chain}:${l.token}`));
      for (const l of extra) prev.current.set(l.token, l);
      setRows((cur) => [...cur, ...extra]);
      setHasMore(d.has_more);
      setLimit(Math.min(200, rows.length + extra.length));
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }

  const nq = normalizeQuery(q);
  const shown: L[] = nq
    ? (() => {
        const seen = new Set<string>();
        const local = rows.filter((l) => matchesQuery(l, nq) && matchesFilter(l, filter, now));
        const merged = [...local, ...(nq ? (remote ?? []) : []).filter((l) => matchesFilter(l, filter, now))].filter((l) => {
          const k = `${l.chain}:${l.token}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        return merged.sort((a, b) => rankHit(a, nq) - rankHit(b, nq));
      })()
    : filter
      ? rows.filter((l) => matchesFilter(l, filter, now)) // instant; the server's filtered list replaces it on the next tick
      : rows;

  const showWindow = sort === "volume";
  const ranked = sort !== "new";

  return (
    <section className="bb-directory min-w-0 space-y-3">
      <div className="space-y-2 pb-1">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <h2 className="text-base font-semibold text-ink shrink-0">
            Launches
            <span className="ml-2 text-xs font-normal text-muted font-mono tnum">{live.totals.launches}</span>
          </h2>
          <label className="relative flex-1 min-w-48 max-w-sm ml-auto">
            <span className="sr-only">Search launches</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, symbol or 0x…"
              className="w-full h-11 rounded-xl border border-line bg-card pl-8 pr-8 text-xs text-ink placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-brand/10 outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            <svg aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            {q ? (
              <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full text-faint hover:text-ink grid place-items-center">
                ×
              </button>
            ) : null}
          </label>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-full border border-line bg-card p-0.5 shrink-0" role="group" aria-label="chain">
            {CHAIN_FILTERS.map((c) => (
              <button key={c.label} type="button" onClick={() => pick(sort, window_, c.key)} className={`h-8 sm:h-7 px-2.5 rounded-full text-[11px] font-medium whitespace-nowrap ${c.key === chain ? (c.key === "robinhood" ? "bg-up-soft text-up" : c.key === "base" ? "bg-brand-soft text-brand" : "bg-ink text-brand-fg") : "text-muted hover:text-ink"}`} aria-pressed={c.key === chain}>
                {c.label}
              </button>
            ))}
          </div>
          {showWindow ? (
            <div className="flex items-center rounded-full border border-line bg-card p-0.5 shrink-0" role="group" aria-label="volume window">
              {WINDOWS.map((w) => (
                <button key={w} type="button" onClick={() => pick(sort, w)} className={`h-7 px-2.5 rounded-full text-[11px] font-mono font-medium ${w === window_ ? "bg-brand-soft text-brand" : "text-muted hover:text-ink"}`} aria-pressed={w === window_}>
                  {w}
                </button>
              ))}
            </div>
          ) : null}
          <nav className="flex items-center gap-1 rounded-full border border-line bg-card p-0.5 max-w-full overflow-x-auto bb-scroll ml-auto" aria-label="sort">
            {SORTS.map((s) => (
              <button key={s.key} type="button" onClick={() => pick(s.key)} className={`h-8 sm:h-7 px-3 inline-flex items-center rounded-full text-xs font-medium whitespace-nowrap ${s.key === sort ? "bg-ink text-brand-fg" : "text-body hover:text-ink"}`} aria-pressed={s.key === sort}>
                {s.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap pb-1">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" title={f.title} onClick={() => pick(sort, window_, chain, filter === f.key ? null : f.key)} className={`h-7 px-2.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${filter === f.key ? "bg-ink text-brand-fg border-ink" : "bg-card text-body border-line hover:border-line-strong hover:text-ink"}`} aria-pressed={filter === f.key}>
            {f.label}
          </button>
        ))}
        {nq ? <span className="text-[11px] text-muted ml-1 inline-flex items-center gap-1">{searching && nq ? <><Spinner size={10} /> searching…</> : `${shown.length} match${shown.length === 1 ? "" : "es"}`}</span> : null}
      </div>
      <div className="bb-launch-table">
        <LaunchListHeader window={showWindow ? window_ : "all"} />
        <ul ref={listRef}>
          {shown.map((l, i) => (
            <li key={l.token} data-token={l.token} className="list-none">
              <ul>
                <LaunchRow l={l} rank={ranked && !nq ? i + 1 : undefined} window={showWindow ? window_ : "all"} hl={hl.get(l.token) ?? null} now={now} pop={pop.has(l.token)} />
              </ul>
            </li>
          ))}
          {shown.length === 0 ? (
            <li className="rounded-2xl bg-card border border-line p-10 text-center space-y-3">
              <p className="text-sm text-muted">{nq ? (searching ? "Searching…" : "Nothing matches.") : filter ? "Nothing matches this filter yet." : hasDb ? "No launches yet. Yours would be the first." : "Database not configured — the list is empty until it is."}</p>
              <Link href="/launch" className={btn.primarySm}>
                Launch the first token
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
      {!nq && hasMore && rows.length < 200 ? (
        <div className="pt-3 flex justify-center">
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={btn.secondarySm}>
            {loadingMore ? <><Spinner size={13} /> Loading…</> : `Load more (${rows.length} shown)`}
          </button>
        </div>
      ) : null}
      {!nq && rows.length >= 200 && hasMore ? <p className="pt-3 text-center text-xs text-muted">Showing the first 200. Use search or a filter to narrow it down.</p> : null}
    </section>
  );
}
