"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useBalance, useConfig, useConnect, useReadContract, useSwitchChain } from "wagmi";
import { getPublicClient, getWalletClient } from "wagmi/actions";
import { formatEther, formatUnits, maxUint160, maxUint256, parseEther, parseUnits, type Address, type Hex } from "viem";
import { btn, input } from "@/components/ui";
import { toast } from "./TxToasts";
import { ERC20_MIN_ABI, PERMIT2_ABI, UNIVERSAL_ROUTER_ABI, V4_QUOTER_ABI } from "@/lib/launchpad/abi";
import { BUY_PRESETS, launchpad, quoteUsdOf, type Quote } from "@/lib/launchpad/config";
import { fmtCompact, fmtUsd, minOut, units } from "@/lib/launchpad/math";
import { encodeV4ExactInSingle, type PoolKey } from "@/lib/launchpad/swap";
import { CHAINS, CHAIN_LABELS, BUILDER_DATA_SUFFIX, explorerTx, type ChainKey } from "@/lib/chainPublic";
import { friendlyError } from "@/lib/errors";
import { Spinner } from "@/components/Skeleton";

/**
 * In-page buy / sell straight against the token's Uniswap v4 pool via the
 * Universal Router (V4_SWAP). Buys send ETH as value; sells go through Permit2
 * (one-time ERC-20 approve to Permit2, then a 30-day Permit2 allowance to the
 * router). Quotes come from the V4 Quoter with a 400ms debounce; every send is
 * simulated first so reverts surface before a signature.
 */
type Side = "buy" | "sell";
type Phase =
  | { k: "idle" }
  | { k: "approving"; step: "erc20" | "permit2" }
  | { k: "signing" }
  | { k: "sent"; hash: Hex }
  | { k: "done"; hash: Hex; side: Side }
  | { k: "error"; message: string };

const SLIPPAGE_BPS = 100; // 1%
const PERMIT_EXPIRY_S = 30 * 24 * 3600;

function fmtEthLocal(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : abs >= 0.0001 ? 6 : 8;
  return v.toFixed(digits).replace(/\.?0+$/, "");
}

export default function TradePanel({ chain, token, symbol, poolKey, quote, ethUsd, onTraded }: { chain: ChainKey; token: Address; symbol: string; poolKey: PoolKey; quote: Quote; ethUsd: number | null; onTraded?: () => void }) {
  const CHAIN = CHAINS[chain];
  const CHAIN_LABEL = CHAIN_LABELS[chain];
  const V4 = launchpad(chain).v4;
  const configured = launchpad(chain).configured;
  const isNative = quote.key === "eth";
  const quoteUsd = quoteUsdOf(quote, ethUsd);
  const fmtQ = (raw: bigint) => `${quote.decimals <= 6 ? units(raw, quote.decimals).toFixed(2).replace(/\.00$/, "") : fmtEthLocal(units(raw, 18))} ${quote.symbol}`;
  const router = useRouter();
  const config = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [quote_, setQuote] = useState<{ out: bigint; forAmount: string } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const seq = useRef(0);

  const eth = useBalance({ address, chainId: CHAIN.id, query: { enabled: Boolean(address) && isNative, refetchInterval: 15_000 } });
  const qbal = useReadContract({ address: quote.address, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: address ? [address] : undefined, chainId: CHAIN.id, query: { enabled: Boolean(address) && !isNative, refetchInterval: 15_000 } });
  const tok = useReadContract({ address: token, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: address ? [address] : undefined, chainId: CHAIN.id, query: { enabled: Boolean(address), refetchInterval: 15_000 } });

  const amountIn = useMemo(() => {
    try {
      if (!amount.trim() || Number(amount) <= 0) return null;
      return side === "buy" ? parseUnits(amount, quote.decimals) : parseUnits(amount, 18);
    } catch {
      return null;
    }
  }, [amount, side, quote.decimals]);

  const onChain = chainId === CHAIN.id;
  const busy = phase.k === "approving" || phase.k === "signing" || phase.k === "sent";
  const balance = side === "buy" ? (isNative ? eth.data?.value : (qbal.data as bigint | undefined)) : (tok.data as bigint | undefined);
  const insufficient = amountIn !== null && balance !== undefined && amountIn > balance;

  // quote
  useEffect(() => {
    if (amountIn === null) return; // a stale quote is ignored by the `forAmount === amount` checks below
    const my = ++seq.current;
    const quoter = V4.quoter;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const pub = getPublicClient(config, { chainId: CHAIN.id })!;
        const { result } = await pub.simulateContract({
          address: quoter,
          abi: V4_QUOTER_ABI,
          functionName: "quoteExactInputSingle",
          args: [{ poolKey, zeroForOne: side === "buy", exactAmount: amountIn, hookData: "0x" }],
        });
        if (my === seq.current) setQuote({ out: result[0], forAmount: amount });
      } catch {
        if (my === seq.current) setQuote(null);
      } finally {
        if (my === seq.current) setQuoting(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [amountIn, side, poolKey, config, amount, V4.quoter, CHAIN.id]);

  async function trade() {
    if (!address || amountIn === null || !quote_) return;
    try {
      if (!onChain) await switchChainAsync({ chainId: CHAIN.id });
      const pub = getPublicClient(config, { chainId: CHAIN.id })!;
      const wallet = await getWalletClient(config, { chainId: CHAIN.id });
      const min = minOut(quote_.out, SLIPPAGE_BPS);

      // Whatever ERC20 we are paying with (the token on a sell, an ERC20 quote on a buy) goes through Permit2.
      const payToken: Address | null = side === "sell" ? token : isNative ? null : quote.address;
      if (payToken) {
        const erc20Allowance = await pub.readContract({ address: payToken, abi: ERC20_MIN_ABI, functionName: "allowance", args: [address, V4.permit2] });
        if (erc20Allowance < amountIn) {
          setPhase({ k: "approving", step: "erc20" });
          const h = await wallet.writeContract({ address: payToken, abi: ERC20_MIN_ABI, functionName: "approve", args: [V4.permit2, maxUint256], dataSuffix: BUILDER_DATA_SUFFIX });
          await pub.waitForTransactionReceipt({ hash: h });
        }
        const [pAmount, pExp] = await pub.readContract({ address: V4.permit2, abi: PERMIT2_ABI, functionName: "allowance", args: [address, payToken, V4.universalRouter] });
        const now = Math.floor(Date.now() / 1000);
        if (pAmount < amountIn || pExp <= now + 60) {
          setPhase({ k: "approving", step: "permit2" });
          const h = await wallet.writeContract({
            address: V4.permit2,
            abi: PERMIT2_ABI,
            functionName: "approve",
            args: [payToken, V4.universalRouter, maxUint160, now + PERMIT_EXPIRY_S],
            dataSuffix: BUILDER_DATA_SUFFIX,
          });
          await pub.waitForTransactionReceipt({ hash: h });
        }
      }

      const { commands, inputs } = encodeV4ExactInSingle({ key: poolKey, zeroForOne: side === "buy", amountIn, minOut: min, layout: V4.swapLayout });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const { request } = await pub.simulateContract({
        address: V4.universalRouter,
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: "execute",
        args: [commands, inputs, deadline],
        value: side === "buy" && isNative ? amountIn : 0n,
        account: address,
        dataSuffix: BUILDER_DATA_SUFFIX,
      });
      setPhase({ k: "signing" });
      const hash = await wallet.writeContract(request);
      setPhase({ k: "sent", hash });
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("Transaction reverted on-chain.");
      await fetch(`/api/launch/sync?chain=${chain}&tx=${hash}`, { method: "POST" }).catch(() => {});
      setPhase({ k: "done", hash, side });
      toast({ kind: side, title: side === "buy" ? `You bought ${quote_ ? fmtCompact(Number(quote_.out) / 1e18) : ""} ${symbol}` : `You sold ${fmtCompact(Number(amountIn) / 1e18)} ${symbol}`, sub: `Confirmed on ${CHAIN_LABEL}`, chain, token, symbol, celebrate: side === "buy" });
      setAmount("");
      setQuote(null);
      void eth.refetch();
      void qbal.refetch();
      void tok.refetch();
      onTraded?.();
      router.refresh();
    } catch (err) {
      setPhase({ k: "error", message: friendlyError(err) });
    }
  }

  const outLabel = quote_ && quote_.forAmount === amount ? (side === "buy" ? `${fmtCompact(Number(quote_.out) / 1e18)} ${symbol}` : fmtQ(quote_.out)) : null;
  const outUsd = quote_ && side === "sell" && quoteUsd ? fmtUsd(units(quote_.out, quote.decimals) * quoteUsd) : null;
  const inUsd = amountIn !== null && side === "buy" && quoteUsd ? fmtUsd(units(amountIn, quote.decimals) * quoteUsd) : null;

  return (
    <section className="rounded-2xl bg-card border border-line shadow-card p-4 space-y-4" id="trade">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-paper p-1 border border-line">
        {(["buy", "sell"] as Side[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSide(s);
              setAmount("");
              setQuote(null);
              setPhase({ k: "idle" });
            }}
            className={`h-10 rounded-lg text-sm font-semibold capitalize transition-colors ${side === s ? (s === "buy" ? "bg-up text-status-fg" : "bg-down text-status-fg") : "text-body hover:text-ink"}`}
            aria-pressed={side === s}
          >
            {s}
          </button>
        ))}
      </div>

      <div>
        <div className="flex items-baseline justify-between text-xs text-muted mb-1.5">
          <span>{side === "buy" ? "You pay" : "You sell"}</span>
          {balance !== undefined ? (
            <button
              type="button"
              className="font-mono tnum hover:text-ink"
              onClick={() => setAmount(side === "buy" ? (isNative ? formatEther(balance > parseEther("0.0005") ? balance - parseEther("0.0005") : 0n) : formatUnits(balance, quote.decimals)) : formatEther(balance))}
            >
              bal {side === "buy" ? fmtQ(balance) : `${fmtCompact(Number(balance) / 1e18)} ${symbol}`}
            </button>
          ) : null}
        </div>
        <div className="relative">
          <input
            className={`${input} h-14 pr-20 font-mono text-xl tnum`}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            inputMode="decimal"
            aria-label={side === "buy" ? `${quote.symbol} amount` : `${symbol} amount`}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-muted">{side === "buy" ? quote.symbol : symbol}</span>
        </div>
        {side === "buy" ? (
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {BUY_PRESETS[quote.key].map((p) => (
              <button key={p} type="button" onClick={() => setAmount(p)} className="h-8 px-3 rounded-full border border-line bg-card text-xs font-mono font-medium text-ink hover:border-line-strong tnum">
                {p} {quote.symbol}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {[25, 50, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={!balance}
                onClick={() => balance !== undefined && setAmount(formatEther((balance * BigInt(pct)) / 100n))}
                className="h-8 px-3 rounded-full border border-line bg-card text-xs font-mono font-medium text-ink hover:border-line-strong tnum disabled:opacity-40"
              >
                {pct}%
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-paper border border-line px-3.5 py-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted text-xs">You receive</span>
          <span className={`font-mono font-bold tnum inline-flex items-center gap-1.5 ${quoting ? "text-faint" : "text-ink"}`}>{quoting ? <Spinner size={12} className="text-muted" /> : null}{outLabel ?? (quoting ? "" : "—")}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3 text-[11px] text-muted font-mono tnum">
          <span>{inUsd ?? outUsd ?? ""}</span>
          <span>min {quote_ && quote_.forAmount === amount ? (side === "buy" ? fmtCompact(Number(minOut(quote_.out, SLIPPAGE_BPS)) / 1e18) : fmtQ(minOut(quote_.out, SLIPPAGE_BPS))) : "—"} · 1% slippage</span>
        </div>
      </div>

      {!configured ? (
        <button type="button" disabled className={`${btn.primary} w-full min-h-12`}>
          Trading unavailable
        </button>
      ) : !isConnected ? (
        <button
          type="button"
          onClick={() => {
            const c = connectors.find((c) => c.id === "coinbaseWallet") ?? connectors[0];
            if (c) connect({ connector: c });
          }}
          disabled={connecting}
          className={`${btn.primary} w-full min-h-12`}
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      ) : !onChain ? (
        <button type="button" onClick={() => void switchChainAsync({ chainId: CHAIN.id })} disabled={switching} className={`${btn.warm} w-full min-h-12`}>
          {switching ? "Switching…" : `Switch to ${CHAIN_LABEL}`}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void trade()}
          disabled={busy || amountIn === null || !quote_ || quote_.forAmount !== amount || insufficient}
          className={`${side === "buy" ? btn.up : `${btn.primary} bg-down hover:brightness-110`} w-full min-h-12 text-[15px]`}
        >
          {phase.k === "approving" ? (
            <>
              <Spinner size={14} /> {phase.step === "erc20" ? "Approve once (1/2)…" : "Allow router (2/2)…"}
            </>
          ) : phase.k === "signing" ? (
            <>
              <Spinner size={14} /> Confirm in your wallet…
            </>
          ) : phase.k === "sent" ? (
            <>
              <Spinner size={14} /> Confirming on {CHAIN_LABEL}…
            </>
          ) : insufficient ? (
            `Not enough ${side === "buy" ? quote.symbol : symbol}`
          ) : side === "buy" ? (
            `Buy ${symbol}`
          ) : (
            `Sell ${symbol}`
          )}
        </button>
      )}

      {phase.k === "error" ? (
        <p className="rounded-xl bg-down-soft border border-down/20 text-down-ink text-sm px-3 py-2" role="alert">
          {phase.message}
        </p>
      ) : null}
      {phase.k === "done" ? (
        <p className="text-xs text-up">
          {phase.side === "buy" ? "Bought" : "Sold"}.{" "}
          <a href={explorerTx(chain, phase.hash)} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-2">
            {phase.hash.slice(0, 10)}…
          </a>
        </p>
      ) : null}
      <p className="text-[11px] text-muted leading-relaxed">Swaps go straight to the Uniswap v4 pool on {CHAIN_LABEL} through the Universal Router. We never touch your funds.</p>
    </section>
  );
}
