import { NextResponse } from "next/server";
import { chainKeyOr } from "@/lib/chainPublic";
import { readMeta } from "@/lib/launchpad/meta";

export const dynamic = "force-dynamic";

/** GET /api/launch/meta/<token> — token metadata JSON (image, description, links). */
export async function GET(_req: Request, ctx: { params: Promise<{ a: string }> }) {
  const { a } = await ctx.params;
  const c = new URL(_req.url).searchParams.get("chain");
  const m = await readMeta({ token: a, chain: chainKeyOr(c, null) ?? undefined });
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(m, { headers: { "cache-control": "public, max-age=300" } });
}
