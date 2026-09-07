"use client";

import { useEffect, useRef, useState } from "react";
import { useLive } from "./LiveProvider";
import { fmtUsd, units } from "@/lib/launchpad/math";

/** Hero stat grid, in USD across both chains; a value that changed pops once. */
export default function LiveTotals() {
  const { live, subscribe } = useLive();
  const t = live.totals;
  const prev = useRef(t);
  const [popped, setPopped] = useState<Set<string>>(new Set());
  useEffect(
    () =>
      subscribe((snap) => {
        const n = snap.totals;
        const o = prev.current;
        const changed = new Set<string>();
        if (n.launches !== o.launches) changed.add("launches");
        if (n.trades !== o.trades) changed.add("trades");
        if (n.volume_usd !== o.volume_usd) changed.add("vol");
        if (n.fees_burned_usd !== o.fees_burned_usd) changed.add("burned");
        if (n.fees_to_creators_usd !== o.fees_to_creators_usd) changed.add("creators");
        prev.current = n;
        if (changed.size) {
          setPopped(changed);
          setTimeout(() => setPopped(new Set()), 400);
        }
      }),
    [subscribe],
  );
  const bc = t.by_chain;
  const eu = live.ethUsd ?? 0;
  const baseUsd = units(bc.base.volume_quote_eth, 18) * eu;
  const rhUsd = units(bc.robinhood.volume_quote_usdg, 6) + units(bc.robinhood.volume_quote_eth, 18) * eu;
  const volSub = `${fmtUsd(baseUsd, { compact: true })} Base · ${fmtUsd(rhUsd, { compact: true })} Robinhood`;
  return (
    <dl className="bb-overview-stats">
      <Stat k="Launches" v={t.launches.toLocaleString("en-US")} sub={`${bc.base.launches} Base · ${bc.robinhood.launches} Robinhood`} pop={popped.has("launches")} />
      <Stat k="Trades" v={t.trades.toLocaleString("en-US")} sub={`${bc.base.trades} Base · ${bc.robinhood.trades} Robinhood`} pop={popped.has("trades")} />
      <Stat k="Volume" v={fmtUsd(t.volume_usd, { compact: true })} sub={volSub} pop={popped.has("vol")} />
      <Stat k="Fees burned" v={fmtUsd(t.fees_burned_usd, { compact: true })} accent="warm" pop={popped.has("burned")} />
      <Stat k="Fees to creators" v={fmtUsd(t.fees_to_creators_usd, { compact: true })} accent="up" pop={popped.has("creators")} />
      <Stat k="Platform fee" v="0%" sub="both chains" accent="up" />
    </dl>
  );
}

function Stat({ k, v, sub, accent, pop }: { k: string; v: string; sub?: string | null; accent?: "up" | "warm"; pop?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={`bb-stat-value tnum ${pop ? "bb-pop" : ""} ${accent === "up" ? "text-up" : accent === "warm" ? "text-warm-ink" : "text-ink"}`}>{v}</dd>
      {sub ? <dd className="text-[10px] tnum text-muted mt-1">{sub}</dd> : null}
    </div>
  );
}
