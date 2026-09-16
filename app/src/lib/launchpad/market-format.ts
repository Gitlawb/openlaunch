/** Compact ledger figures; exact values remain available in the row's title. */
export function marketUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (value !== 0 && Math.abs(value) < 0.01) return value > 0 ? "<$0.01" : ">-$0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: Math.abs(value) >= 1_000 ? "compact" : "standard", maximumFractionDigits: Math.abs(value) >= 1_000 ? 1 : 2, minimumFractionDigits: 0 }).format(value);
}

export function marketChange(value: number): { label: string; direction: "up" | "down" | "flat" } {
  const pct = value * 100;
  if (!Number.isFinite(pct)) return { label: "—", direction: "flat" };
  const rounded = Number(pct.toFixed(Math.abs(pct) >= 10 ? 0 : 1));
  if (rounded === 0) return { label: "0.0%", direction: "flat" };
  const amount = Math.abs(pct) >= 1e15 ? pct.toExponential(1) : new Intl.NumberFormat("en-US", { notation: Math.abs(pct) >= 1_000 ? "compact" : "standard", maximumFractionDigits: Math.abs(pct) >= 10 ? 0 : 1 }).format(pct);
  return { label: `${pct > 0 ? "+" : ""}${amount}%`, direction: pct > 0 ? "up" : "down" };
}
