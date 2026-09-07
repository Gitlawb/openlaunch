import Link from "next/link";
import LaunchHero from "@/components/launchpad/LaunchHero";
import LaunchList from "@/components/launchpad/LaunchList";
import LaunchTape from "@/components/launchpad/LaunchTape";
import { PostsFeed } from "@/components/launchpad/Posts";
import { listFeed } from "@/lib/launchpad/postsServer";
import { LAUNCH_SORTS, VOLUME_WINDOWS, getLaunchFeed, listLaunchesPage, type LaunchSort, type VolumeWindow, getTrending } from "@/lib/launchpad/queries";
import { PAGE_SIZE } from "@/lib/launchpad/paging";
import { ethUsd } from "@/lib/launchpad/ethPrice";
import { LAUNCHPAD_CONFIGURED } from "@/lib/launchpad/config";
import { dbConfigured } from "@/lib/db";
import { isChainKey } from "@/lib/chainPublic";
import { isFilter } from "@/lib/launchpad/search";
import TrendingStrip from "@/components/launchpad/TrendingStrip";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ sort?: string; window?: string; chain?: string; filter?: string }> }) {
  const sp = await searchParams;
  const sort: LaunchSort = LAUNCH_SORTS.includes(sp.sort as LaunchSort) ? (sp.sort as LaunchSort) : "new";
  const window: VolumeWindow = VOLUME_WINDOWS.includes(sp.window as VolumeWindow) ? (sp.window as VolumeWindow) : "all";
  const chain = isChainKey(sp.chain) ? sp.chain : null;
  const filter = isFilter(sp.filter) ? sp.filter : null;
  const usd = await ethUsd();
  const [page, feed, posts, trending] = await Promise.all([listLaunchesPage({ sort, window, chain, filter, limit: PAGE_SIZE, ethUsd: usd }), getLaunchFeed(24, usd), listFeed(30), getTrending(usd)]);

  return (
    <>
      <main className="relative mx-auto max-w-6xl px-4 pb-16 space-y-8">
        <LaunchHero configured={LAUNCHPAD_CONFIGURED} />
        <TrendingStrip initial={trending} />
        <div className="grid xl:grid-cols-[minmax(0,1fr)_18rem] gap-6 items-start">
          <LaunchList initial={page.items} initialHasMore={page.hasMore} initialSort={sort} initialWindow={window} initialChain={chain} initialFilter={filter} hasDb={dbConfigured()} />
          <div className="xl:sticky xl:top-32 min-w-0 grid sm:grid-cols-2 xl:block gap-4 xl:space-y-4">
            <PostsFeed initial={posts} compact />
            <LaunchTape initial={feed} />
            <div className="rounded-2xl bg-card border border-line shadow-card p-4 text-[13px] leading-relaxed text-body">
              <p className="font-semibold text-ink">Why it&apos;s free</p>
              <p className="mt-1">
                There is no fee address in the code, on either chain. The factory charges nothing and the locker has no cut — verifiable on-chain. Creators pick a 0–3% trading fee that goes
                100% to a beneficiary they name, or gets burned.
              </p>
              <p className="mt-2">
                <Link href="/agents" className="text-brand hover:underline underline-offset-4">
                  Agents can launch too →
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
