import { rateLimited } from "@/lib/launchpad/editServer";
import { BRIDGE_PRIVATE_HEADERS, bridgeErrorResponse, getBridgeStatus } from "@/lib/bridge/relay";
import { BridgeApiError } from "@/lib/bridge/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const ip = (req.headers.get("fly-client-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "0.0.0.0";
  if (rateLimited(`bridge:status:ip:${ip}`, 100)) return bridgeErrorResponse(new BridgeApiError("Too many status requests. Please wait a moment.", 429));
  try {
    const params = new URL(req.url).searchParams;
    if (params.size !== 1 || !params.has("requestId")) throw new BridgeApiError("Invalid bridge request ID.", 400);
    return Response.json(await getBridgeStatus(params.get("requestId")!), { headers: BRIDGE_PRIVATE_HEADERS });
  } catch (error) { return bridgeErrorResponse(error); }
}
