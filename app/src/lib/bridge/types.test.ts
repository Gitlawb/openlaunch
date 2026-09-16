import assert from "node:assert/strict";
import test from "node:test";
import { formatUnits, zeroAddress } from "viem";
import { ARC_USDC, BASE_USDC, BRIDGE_ASSETS, bridgeCurrency, bridgeFeePercent, bridgeTransferInputCurrency, isBridgeAssetSupported } from "./types";

test("bridge assets are chain-scoped and never inferred from a symbol alone", () => {
  assert.deepEqual(BRIDGE_ASSETS[8453], ["ETH", "USDC"]);
  assert.deepEqual(BRIDGE_ASSETS[4663], ["ETH"]);
  assert.deepEqual(BRIDGE_ASSETS[5042], ["USDC"]);
  assert.equal(isBridgeAssetSupported(4663, "USDC"), false);
  assert.equal(isBridgeAssetSupported(8453, BASE_USDC), false);
  assert.equal(isBridgeAssetSupported(8453, "usdc"), false);
  assert.throws(() => bridgeCurrency(4663, "USDC", "input"));
  assert.throws(() => bridgeCurrency(4663, "USDC", "output"));
  assert.throws(() => bridgeCurrency(5042, "ETH", "input"));
});

test("Base USDC uses the same six-decimal contract in both directions", () => {
  for (const side of ["input", "output"] as const) {
    assert.deepEqual(bridgeCurrency(8453, "USDC", side), { address: BASE_USDC, symbol: "USDC", decimals: 6 });
  }
});

test("Arc keeps distinct ERC20 input and native output representations", () => {
  assert.deepEqual(bridgeCurrency(5042, "USDC", "input"), { address: ARC_USDC, symbol: "USDC", decimals: 6 });
  assert.deepEqual(bridgeCurrency(5042, "USDC", "output"), { address: zeroAddress, symbol: "USDC", decimals: 18 });
});

test("omitted asset fields preserve legacy route semantics", () => {
  for (const chain of [8453, 4663] as const) {
    for (const side of ["input", "output"] as const) assert.deepEqual(bridgeCurrency(chain, undefined, side), { address: zeroAddress, symbol: "ETH", decimals: 18 });
  }
  assert.equal(bridgeCurrency(5042, undefined, "input").address, ARC_USDC);
  assert.equal(bridgeCurrency(5042, undefined, "output").address, zeroAddress);
});

test("recovered Arc native and ERC20 journals both display the original USDC amount", () => {
  const native = bridgeTransferInputCurrency({ originChainId: 5042 });
  assert.equal(native.address, zeroAddress);
  assert.equal(formatUnits(25n * 10n ** 18n, native.decimals), "25");
  const erc20 = bridgeTransferInputCurrency({ originChainId: 5042, depositKind: "erc20" });
  assert.equal(erc20.address, ARC_USDC);
  assert.equal(formatUnits(25_000_000n, erc20.decimals), "25");
  const modern = bridgeTransferInputCurrency({ originChainId: 5042, originAsset: "USDC", depositKind: "erc20" });
  assert.deepEqual(modern, erc20);
  assert.equal(bridgeTransferInputCurrency({ originChainId: 8453 }).decimals, 18);
  assert.equal(bridgeTransferInputCurrency({ originChainId: 8453, originAsset: "USDC", depositKind: "erc20" }).decimals, 6);
});

test("relay fee percentages preserve exact boundaries and round upward without floats", () => {
  assert.equal(bridgeFeePercent(50_000n, 1_000_000n), "5");
  assert.equal(bridgeFeePercent(50_001n, 1_000_000n), "5.0001");
  assert.equal(bridgeFeePercent(500_000_000_000_001n, 10_000_000_000_000_000n), "5.000001");
  assert.equal(bridgeFeePercent(1n, 3n), "33.333334");
  assert.equal(bridgeFeePercent(0n, 1n), "0");
  assert.throws(() => bridgeFeePercent(-1n, 1n));
  assert.throws(() => bridgeFeePercent(1n, 0n));
});
