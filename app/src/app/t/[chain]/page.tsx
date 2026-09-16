import { notFound, redirect } from "next/navigation";
import { isAddress } from "viem";
import { DEFAULT_CHAIN, isChainKey } from "@/lib/chainPublic";
import { findLaunchChain } from "@/lib/launchpad/queries";

export const dynamic = "force-dynamic";

/**
 * /t/<chain>            → the launchpad filtered to that chain
 * /t/<token> (legacy)   → /t/<chain>/<token> (looked up; Base by default)
 */
export default async function TokenOrChainPage({ params }: { params: Promise<{ chain: string }> }) {
  const { chain } = await params;
  if (isChainKey(chain)) redirect(`/?chain=${chain}`);
  if (!isAddress(chain)) notFound();
  const found = (await findLaunchChain(chain)) ?? DEFAULT_CHAIN;
  redirect(`/t/${found}/${chain.toLowerCase()}`);
}
