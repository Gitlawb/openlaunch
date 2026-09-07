import { CHAIN_SHORT, type ChainKey } from "@/lib/chainPublic";

/** Tiny chain label. Text only — no third-party logos. */
export default function ChainBadge({ chain, className = "", size = "sm" }: { chain: ChainKey; className?: string; size?: "sm" | "md" }) {
  const tone = chain === "base" ? "bg-brand-soft text-brand border-brand/20" : "bg-up-soft text-up border-up/20";
  return (
    <span className={`inline-flex items-center rounded-md border font-medium whitespace-nowrap ${size === "md" ? "h-6 px-2 text-[11px]" : "h-5 px-1.5 text-[10px]"} ${tone} ${className}`} title={chain === "base" ? "Base" : "Robinhood Chain"}>
      {CHAIN_SHORT[chain]}
    </span>
  );
}
