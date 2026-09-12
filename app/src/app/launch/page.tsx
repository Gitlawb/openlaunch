import type { Metadata } from "next";
import LaunchForm from "@/components/launchpad/LaunchForm";
import { ethUsd } from "@/lib/launchpad/ethPrice";
import { gitlawbUsd } from "@/lib/launchpad/gitlawbServer";
import { isChainKey } from "@/lib/chainPublic";

export const metadata: Metadata = {
  title: "Launch a token for free",
  description: "Deploy a token on Base or Robinhood Chain with 100% of supply locked as Uniswap v4 liquidity. No platform fee. Gas only.",
};

export const dynamic = "force-dynamic";

export default async function LaunchPage({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
  const sp = await searchParams;
  const [usd, gitlawb] = await Promise.all([ethUsd(), gitlawbUsd()]);
  return (
    <>
      <main className="workspace-shell relative pt-6 sm:pt-10 pb-16 space-y-8 sm:space-y-10">
        <header className="max-w-2xl">
          <h1 className="font-display font-bold tracking-[-0.02em] text-ink text-3xl sm:text-4xl">Launch a token</h1>
          <p className="mt-2 text-base text-body">Pick a chain, fill this in, sign once, done. No platform fee. You only pay gas.</p>
        </header>
        <LaunchForm ethUsd={usd} gitlawbUsd={gitlawb} initialChain={isChainKey(sp.chain) ? sp.chain : "base"} />
      </main>
    </>
  );
}
