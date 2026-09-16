import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CHAIN_KEYS, CHAIN_IDS } from "../chainKeys.ts";
import { launchpad } from "./config.ts";

/**
 * contracts/deployments/launchpad-<chain>.json is the repo's record of each chain's deployment and Uniswap v4 addresses
 * (the deploy script, verify.sh and the fork tests carry the same values). The app's per-chain v4 config must match it,
 * so a mistyped nibble in one copy cannot leave the app quoting against a different contract than the one verified.
 */
test("the app's Uniswap v4 config matches every chain's deployments record", () => {
  for (const k of CHAIN_KEYS) {
    const file = path.join(process.cwd(), `../contracts/deployments/launchpad-${k}.json`);
    const rec = JSON.parse(readFileSync(file, "utf8")) as { chainId: number; uniswapV4: Record<string, string> };
    assert.equal(rec.chainId, CHAIN_IDS[k], `${k}: chain id`);
    const v4 = launchpad(k).v4;
    for (const field of ["poolManager", "positionManager", "permit2", "stateView", "quoter", "universalRouter"] as const) {
      assert.equal(v4[field].toLowerCase(), rec.uniswapV4[field].toLowerCase(), `${k}: ${field}`);
    }
    // the record names the router's swap layout where it was verified; Base's predates the field (its router is the v1 layout)
    const layout = rec.uniswapV4.universalRouterSwapLayout;
    if (layout !== undefined) assert.ok(layout.startsWith(v4.swapLayout), `${k}: swap layout`);
  }
});
