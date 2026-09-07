"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { CandlestickSeries, HistogramSeries, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp } from "lightweight-charts";
import { nowMs } from "@/lib/launchpad/time";
import { useLive } from "./LiveProvider";
import { INTERVAL_KEYS, INTERVALS, defaultInterval, fillCandles, highLow, mergeTail, scaleCandles, type Candle, type Interval, type RawCandle } from "@/lib/launchpad/candles";
import { fmtCompact, fmtPrice, fmtUsd } from "@/lib/launchpad/math";
import type { ChainKey } from "@/lib/chainPublic";
import { Sk } from "@/components/Skeleton";

type Payload = { interval: Interval; from: number; launch: { t: number; price: number }; quote: { symbol: string; decimals: number; usd: number | null }; supply: number; candles: RawCandle[]; mine: { t: number; is_buy: boolean; quote: string }[] | null };
type Unit = "usd" | "quote" | "mcap";

const UP = "#21864a";
const DOWN = "#dc454e";

/**
 * Candles + volume from the indexed swaps. Units: USD (default when the quote
 * has a USD price), the pool's quote, or market cap. Live: when the shared
 * feed shows a new trade for this token, the last buckets are re-fetched and
 * merged. Own trades (connected wallet) are drawn as markers.
 */
export default function PriceChart({ chain, token, symbol, launchedAt }: { chain: ChainKey; token: string; symbol: string; launchedAt: string }) {
  const [interval, setInterval_] = useState<Interval>(() => defaultInterval((nowMs() - new Date(launchedAt).getTime()) / 1000));
  const [unit, setUnit] = useState<Unit>("usd");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { address } = useAccount();
  const { subscribe } = useLive();
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeries = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lastSeen = useRef<string>("");

  const load = useCallback(
    async (tailOnly = false) => {
      try {
        const intervalS = INTERVALS[interval];
        const from = tailOnly ? Math.floor(nowMs() / 1000) - intervalS * 3 : undefined;
        const q = new URLSearchParams({ chain, token, interval });
        if (from) q.set("from", String(from));
        if (address) q.set("wallet", address);
        const res = await fetch(`/api/launch/candles?${q}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`candles ${res.status}`);
        const p = (await res.json()) as Payload;
        setError(null);
        setData((cur) => (tailOnly && cur && cur.interval === p.interval ? { ...cur, candles: mergeRaw(cur.candles, p.candles, intervalS), mine: p.mine ?? cur.mine } : p));
      } catch (e) {
        setError(e instanceof Error ? e.message : "chart unavailable");
      }
    },
    [chain, token, interval, address],
  );

  useEffect(() => {
    const id = setTimeout(() => void load(false), 0);
    return () => clearTimeout(id);
  }, [load]);

  // live: refetch the tail when the shared feed shows a new trade on this token
  useEffect(
    () =>
      subscribe((snap) => {
        const hit = snap.feed.find((i) => i.kind === "swap" && i.token === token && i.chain === chain);
        if (!hit) return;
        const k = `${hit.tx_hash}:${hit.kind === "swap" ? hit.quote_wei : ""}`;
        if (k === lastSeen.current) return;
        lastSeen.current = k;
        void load(true);
      }),
    [subscribe, token, chain, load],
  );

  const usdAvailable = data?.quote.usd !== null && data?.quote.usd !== undefined;
  const effUnit: Unit = unit === "usd" && !usdAvailable ? "quote" : unit;
  const series = useMemo(() => {
    if (!data) return null;
    const intervalS = INTERVALS[data.interval];
    const now = Math.floor(nowMs() / 1000);
    const filled = fillCandles(data.candles, intervalS, Math.max(data.launch.t, data.from), now, data.launch.price);
    const factor = effUnit === "usd" ? (data.quote.usd ?? 1) : effUnit === "mcap" ? data.supply * (data.quote.usd ?? 1) : 1;
    return { candles: scaleCandles(filled, factor), hl: highLow(scaleCandles(filled, factor)) };
  }, [data, effUnit]);

  // chart lifecycle
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const c = createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, fontFamily: getComputedStyle(el).fontFamily, fontSize: 11 },
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.25 } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 3 },
      crosshair: { horzLine: { labelBackgroundColor: "#454545" }, vertLine: { labelBackgroundColor: "#454545" } },
      handleScale: { axisPressedMouseMove: true },
      localization: { priceFormatter: (p: number) => (p >= 1000 ? fmtCompact(p, 1) : p >= 1 ? p.toFixed(2) : fmtPrice(p)) },
    });
    const cs = c.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceFormat: { type: "price", precision: 8, minMove: 1e-8 } });
    const vs = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", color: "#888888" });
    const theme = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => {
      const styles = getComputedStyle(el);
      const color = (name: string) => styles.getPropertyValue(`--color-${name}`).trim();
      c.applyOptions({
        layout: { textColor: color("muted") },
        grid: { vertLines: { color: color("line-muted") }, horzLines: { color: color("line-muted") } },
        rightPriceScale: { borderColor: color("line") },
        timeScale: { borderColor: color("line") },
      });
      cs.applyOptions({ upColor: color("up"), borderUpColor: color("up"), wickUpColor: color("up"), downColor: color("down"), borderDownColor: color("down"), wickDownColor: color("down") });
    };
    syncTheme();
    theme.addEventListener("change", syncTheme);
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    candleSeries.current = cs;
    volSeries.current = vs;
    markers.current = createSeriesMarkers(cs, []);
    return () => {
      theme.removeEventListener("change", syncTheme);
      c.remove();
      chart.current = null;
      candleSeries.current = null;
      volSeries.current = null;
      markers.current = null;
    };
  }, []);

  // push data
  useEffect(() => {
    const cs = candleSeries.current;
    const vs = volSeries.current;
    if (!cs || !vs || !series) return;
    cs.setData(series.candles.map((k) => ({ time: k.t as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
    vs.setData(series.candles.map((k) => ({ time: k.t as UTCTimestamp, value: k.volume, color: k.close >= k.open ? "rgba(21,128,61,0.25)" : "rgba(220,38,38,0.25)" })));
    const intervalS = INTERVALS[interval];
    const mine = (data?.mine ?? []).map((m) => ({ time: (Math.floor(m.t / intervalS) * intervalS) as UTCTimestamp, position: m.is_buy ? ("belowBar" as const) : ("aboveBar" as const), color: m.is_buy ? UP : DOWN, shape: m.is_buy ? ("arrowUp" as const) : ("arrowDown" as const), text: m.is_buy ? "buy" : "sell" }));
    markers.current?.setMarkers(mine.sort((a, b) => Number(a.time) - Number(b.time)));
    chart.current?.timeScale().fitContent();
  }, [series, data?.mine, interval]);

  const unitLabel = effUnit === "usd" ? "USD" : effUnit === "mcap" ? "MCAP" : data?.quote.symbol ?? "quote";
  const last = series?.candles.at(-1);
  const first = series?.candles.find((c) => !c.filled) ?? series?.candles[0];
  const chg = last && first && first.open > 0 ? last.close / first.open - 1 : 0;
  const fmtV = (v: number) => (effUnit === "quote" ? `${fmtPrice(v)} ${data?.quote.symbol ?? ""}` : effUnit === "mcap" ? fmtUsd(v, { compact: true }) : fmtUsd(v));

  return (
    <section className="rounded-2xl bg-card border border-line shadow-card overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono font-bold text-xl text-ink tnum">{last ? fmtV(last.close) : "—"}</span>
            {last && first ? <span className={`font-mono text-xs font-bold tnum ${chg >= 0 ? "text-up" : "text-down-ink"}`}>{chg >= 0 ? "+" : ""}{(chg * 100).toFixed(1)}%</span> : null}
            <span className="text-[11px] text-muted">{symbol} · {unitLabel}</span>
          </div>
          {series?.hl ? (
            <div className="text-[11px] font-mono text-muted tnum">
              range <span className="text-ink">{fmtV(series.hl.low)}</span> – <span className="text-ink">{fmtV(series.hl.high)}</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center rounded-full border border-line bg-paper p-0.5" role="group" aria-label="interval">
            {INTERVAL_KEYS.map((k) => (
              <button key={k} type="button" onClick={() => setInterval_(k)} className={`h-7 px-2 rounded-full text-[11px] font-mono font-medium ${k === interval ? "bg-ink text-brand-fg" : "text-muted hover:text-ink"}`} aria-pressed={k === interval}>
                {k}
              </button>
            ))}
          </div>
          <div className="flex items-center rounded-full border border-line bg-paper p-0.5" role="group" aria-label="unit">
            {(usdAvailable ? (["usd", "quote", "mcap"] as Unit[]) : (["quote"] as Unit[])).map((u) => (
              <button key={u} type="button" onClick={() => setUnit(u)} className={`h-7 px-2 rounded-full text-[11px] font-mono font-medium uppercase ${u === effUnit ? "bg-brand-soft text-brand" : "text-muted hover:text-ink"}`} aria-pressed={u === effUnit}>
                {u === "quote" ? data?.quote.symbol ?? "quote" : u}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="relative">
        <div ref={box} className="h-64 sm:h-80 w-full" />
        {!data && !error ? (
          <div className="absolute inset-0 px-4 pb-4 flex items-end gap-1" aria-hidden>
            {Array.from({ length: 28 }, (_, i) => (
              <Sk key={i} className="flex-1 rounded-sm" style={{ height: `${28 + ((i * 53) % 55)}%` }} />
            ))}
          </div>
        ) : null}
      </div>
      {error ? <p className="px-4 pb-3 text-xs text-down-ink">{error}</p> : null}
      {!error && data && data.candles.length === 0 ? <p className="px-4 pb-3 text-xs text-muted">No trades yet — the line is the launch price.</p> : null}
    </section>
  );
}

function mergeRaw(existing: RawCandle[], tail: RawCandle[], intervalS: number): RawCandle[] {
  const asCandles = (xs: RawCandle[]): Candle[] => xs.map((c) => ({ ...c, t: Math.floor(c.t / intervalS) * intervalS }));
  return mergeTail(asCandles(existing), asCandles(tail)).map((c) => ({ t: c.t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, trades: c.trades }));
}
