import Link from "next/link";
import { btn } from "@/components/ui";
import LiveTotals from "./LiveTotals";
import { launchpad } from "@/lib/launchpad/config";
import { explorerAddress } from "@/lib/chainPublic";
import { BRAND_GITHUB } from "@/lib/brand";

export default function LaunchHero({ configured }: { ethUsd?: number | null; configured: boolean }) {
  const b = launchpad("base");
  const r = launchpad("robinhood");
  return (
    <section className="bb-launch-hero">
      <div className="bb-hero-intro">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted">
          <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-up" aria-hidden />Free to launch. Open by default.</span>
          <a href={BRAND_GITHUB} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">View source</a>
        </div>
        <h1>Launch a token.</h1>
        <p className="bb-hero-description">
          One transaction. A token, a Uniswap v4 pool, and liquidity locked forever.
          Launch on Base or Robinhood Chain. The only cost is gas.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
          <Link href="/launch" className={`${btn.primary} rounded-full px-6`}>Launch a token</Link>
          <Link href="/rules#launchpad" className={`${btn.secondary} rounded-full px-6`}>How it works</Link>
        </div>
        <div className="bb-hero-facts">
          <span>0% platform fee</span>
          <span>No owner or admin</span>
          <a href="/rules#contracts" className="hover:text-ink underline underline-offset-4">Verified contracts</a>
        </div>
        {!configured ? (
          <p className="mt-5 inline-block rounded-xl bg-warm-soft border border-warm/30 text-warm-ink text-xs px-3 py-2">
            Launching is not available yet. You can still explore the launchpad.
          </p>
        ) : null}
      </div>
      <LiveTotals />
      <p className="bb-locker-note">
        Liquidity is held in Uniswap&apos;s PoolManager, with the position NFT in an ownerless locker on each chain (
        {b.locker ? <a href={explorerAddress("base", b.locker)} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">Base</a> : "Base"}
        ,{" "}
        {r.locker ? <a href={explorerAddress("robinhood", r.locker)} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">Robinhood</a> : "Robinhood"}
        ). Nobody can withdraw it.
      </p>
    </section>
  );
}
