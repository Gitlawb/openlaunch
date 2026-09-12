"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useBalance, useConfig, useReadContract, useSwitchChain } from "wagmi";
import { getPublicClient, getWalletClient } from "wagmi/actions";
import { formatEther, formatUnits, maxUint160, maxUint256, parseEther, parseUnits, type Address, type Hex } from "viem";
import { ArrowDown, ArrowRight, Wallet } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/vendor/toggle-group";
import { btn } from "@/components/ui";
import { toast } from "./TxToasts";
import { ERC20_MIN_ABI, PERMIT2_ABI, UNIVERSAL_ROUTER_ABI, V4_QUOTER_ABI } from "@/lib/launchpad/abi";
import { BUY_PRESETS, launchpad, quoteUsdOf, type Quote } from "@/lib/launchpad/config";
import { fmtCompact, fmtQuoteUnits, fmtUsd, minOut, units, pipsToPct } from "@/lib/launchpad/math";
import { encodeV4ExactInSingle, type PoolKey } from "@/lib/launchpad/swap";
import { CHAINS, CHAIN_LABELS, BUILDER_DATA_SUFFIX, explorerTx, type ChainKey } from "@/lib/chainPublic";
import { tradeQuoteKey } from "@/lib/launchpad/token-market";
import { friendlyError } from "@/lib/errors";
import { Spinner } from "@/components/Skeleton";
import ConnectWallet from "@/components/ConnectWallet";

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
  | { k: "preparing" }
  | { k: "approving"; step: "erc20" | "permit2" }
  | { k: "signing" }
  | { k: "sent"; hash: Hex }
  | { k: "done"; hash: Hex; side: Side }
  | { k: "error"; message: string };

const SLIPPAGE_BPS = 100; // 1%
const PERMIT_EXPIRY_S = 30 * 24 * 3600;


export default function TradePanel({ chain, token, symbol, poolKey, quote, ethUsd, onTraded }: { chain: ChainKey; token: Address; symbol: string; poolKey: PoolKey; quote: Quote; ethUsd: number | null; onTraded?: () => void }) {
  const CHAIN = CHAINS[chain];
  const CHAIN_LABEL = CHAIN_LABELS[chain];
  const V4 = launchpad(chain).v4;
  const configured = launchpad(chain).configured;
  const isNative = quote.key === "eth";
  const quoteUsd = quoteUsdOf(quote, ethUsd);
  const fmtQ = (raw: bigint) => `${fmtQuoteUnits(units(raw, quote.decimals), quote.decimals)} ${quote.symbol}`;
  const router = useRouter();
  const config = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [quote_, setQuote] = useState<{ out: bigint; forKey: string } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const seq = useRef(0);
  const transactionLock = useRef(false);

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
  const busy = phase.k === "preparing" || phase.k === "approving" || phase.k === "signing" || phase.k === "sent";
  const balance = side === "buy" ? (isNative ? eth.data?.value : (qbal.data as bigint | undefined)) : (tok.data as bigint | undefined);
  const insufficient = amountIn !== null && balance !== undefined && amountIn > balance;

  const quoteKey = tradeQuoteKey(chain, token, side, amount);
  // A response can only be used for the exact chain/token/side/amount requested.
  useEffect(() => {
    const my = ++seq.current;
    if (amountIn === null) return;
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
        if (my === seq.current) setQuote({ out: result[0], forKey: quoteKey });
      } catch {
        if (my === seq.current) setQuote(null);
      } finally {
        if (my === seq.current) setQuoting(false);
      }
    }, 400);
    return () => { clearTimeout(t); seq.current = my + 1; };
  }, [amountIn, side, poolKey, config, amount, V4.quoter, CHAIN.id, quoteKey]);

  async function trade() {
    if (!address || amountIn === null || !quote_ || quote_.forKey !== quoteKey || busy || insufficient || transactionLock.current) return;
    // Lock before the first await, including wallet lookup and RPC preflight.
    transactionLock.current = true;
    setPhase({ k: "preparing" });
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
    } finally {
      transactionLock.current = false;
    }
  }

  const outLabel = quote_ && quote_.forKey === quoteKey ? (side === "buy" ? `${fmtCompact(Number(quote_.out) / 1e18)} ${symbol}` : fmtQ(quote_.out)) : null;
  const outUsd = quote_ && quote_.forKey === quoteKey && side === "sell" && quoteUsd ? fmtUsd(units(quote_.out, quote.decimals) * quoteUsd) : null;
  const inUsd = amountIn !== null && side === "buy" && quoteUsd ? fmtUsd(units(amountIn, quote.decimals) * quoteUsd) : null;

  return (
    <section className="overflow-hidden rounded-xl bg-card scroll-mt-24" id="trade" tabIndex={-1} aria-label={`Trade ${symbol}`}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-5"><h2 className="min-w-0 truncate text-sm font-semibold text-ink">Trade {symbol}</h2><span className="shrink-0 text-[11px] text-muted">{CHAIN_LABEL}</span></div>
      <div className="space-y-4 p-4 sm:p-5">
      <ToggleGroup aria-label="Trade side" value={[side]} onValueChange={(v) => { if (!v[0] || busy) return; setSide(v[0] as Side); setAmount(""); setQuote(null); setQuoting(false); setPhase({ k: "idle" }); }} className="grid w-full grid-cols-2">
        {(["buy", "sell"] as Side[]).map((s) => <ToggleGroupItem key={s} value={s} disabled={busy} className={`min-h-11 text-sm data-pressed:bg-paper ${s === "buy" ? "data-pressed:text-up" : "data-pressed:text-down-ink"}`}>{s === "buy" ? "Buy" : "Sell"}</ToggleGroupItem>)}
      </ToggleGroup>

      <div className="relative">
        <div className="border-b border-line pb-5">
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted"><label htmlFor={`amount-${chain}-${token}`}>{side === "buy" ? "You pay" : "You sell"}</label>
            {balance !== undefined ? <button type="button" disabled={busy} className="min-h-11 max-w-[65%] truncate font-mono text-[10px] hover:text-ink" title="Use maximum available balance (reserve gas for ETH)" onClick={() => setAmount(side === "buy" ? (isNative ? formatEther(balance > parseEther("0.0005") ? balance - parseEther("0.0005") : 0n) : formatUnits(balance, quote.decimals)) : formatEther(balance))}>Bal {side === "buy" ? fmtQ(balance) : fmtCompact(Number(balance) / 1e18)}</button> : <Wallet size={12} aria-hidden />}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <input id={`amount-${chain}-${token}`} disabled={busy} className="min-w-0 w-full bg-transparent py-1 font-mono text-[30px] leading-tight text-ink outline-offset-4 placeholder:text-muted tnum" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" inputMode="decimal" autoComplete="off" aria-label={side === "buy" ? `${quote.symbol} amount` : `${symbol} amount`} />
            <span className="max-w-24 shrink-0 truncate py-1.5 text-xs font-medium text-ink">{side === "buy" ? quote.symbol : symbol}</span>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {side === "buy" ? BUY_PRESETS[quote.key].map((p) => <button key={p} type="button" disabled={busy} onClick={() => setAmount(p)} aria-label={`Pay ${p} ${quote.symbol}`} className={`min-h-11 rounded-lg font-mono text-[11px] tnum hover:bg-paper disabled:opacity-40 ${amount === p ? "bg-paper text-ink" : "text-muted"}`}>{fmtQuoteUnits(Number(p), quote.decimals)}</button>) : [25, 50, 100].map((pct) => <button key={pct} type="button" disabled={busy || !balance} onClick={() => balance !== undefined && setAmount(formatEther((balance * BigInt(pct)) / 100n))} className="min-h-11 rounded-lg font-mono text-[11px] text-muted tnum hover:bg-paper disabled:opacity-40">{pct === 100 ? "Max" : `${pct}%`}</button>)}
          </div>
        </div>
        <div className="relative z-10 mx-auto -my-3 flex size-6 items-center justify-center bg-card text-muted" aria-hidden><ArrowDown size={13} /></div>
        <div className="pt-5 pb-1">
          <div className="text-[11px] text-muted">You receive <span className="text-[10px]">· estimated</span></div>
          <div className="mt-2 flex min-h-7 items-center justify-between gap-3">
            <span className="min-w-0 break-words font-mono text-base font-bold text-ink tnum">{outLabel ?? "—"}</span>{quoting && amountIn !== null ? <Spinner size={13} className="shrink-0 text-muted" /> : null}
          </div>
          <div className="mt-1 min-h-4 text-[10px] text-muted">{inUsd ?? outUsd ?? "Quote includes the pool trading fee."}</div>
        </div>
      </div>
      <dl className="space-y-2 text-[11px]">
        <div className="flex justify-between gap-3"><dt className="text-muted">Minimum received</dt><dd className="text-right font-mono text-body tnum">{quote_ && quote_.forKey === quoteKey ? (side === "buy" ? `${fmtCompact(Number(minOut(quote_.out, SLIPPAGE_BPS)) / 1e18)} ${symbol}` : fmtQ(minOut(quote_.out, SLIPPAGE_BPS))) : "—"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Slippage tolerance</dt><dd className="font-mono text-body tnum">1%</dd></div>
      </dl>

      {!configured ? (
        <button type="button" disabled className={`${btn.secondary} !border-ink !bg-ink !text-inverse w-full min-h-12`}>
          Trading unavailable
        </button>
      ) : !isConnected ? (
        <ConnectWallet className={`${btn.secondary} !border-ink !bg-ink !text-inverse w-full min-h-12`}>
          Connect wallet <ArrowRight size={15} />
        </ConnectWallet>
      ) : !onChain ? (
        <button type="button" onClick={() => void switchChainAsync({ chainId: CHAIN.id })} disabled={switching} className={`${btn.warm} w-full min-h-12`}>
          {switching ? "Switching…" : `Switch to ${CHAIN_LABEL}`}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void trade()}
          disabled={busy || amountIn === null || !quote_ || quote_.forKey !== quoteKey || insufficient}
          className={`${side === "buy" ? btn.up : `${btn.primary} !bg-down hover:brightness-110`} w-full min-h-12 text-[15px]`}
        >
          {phase.k === "preparing" ? (
            <><Spinner size={14} /> Preparing trade…</>
          ) : phase.k === "approving" ? (
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
        <p className="rounded-lg bg-down-soft text-down-ink text-sm px-3 py-2" role="alert">
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
      <p className="text-center text-[10px] leading-relaxed text-muted text-pretty">{pipsToPct(poolKey.fee)} pool fee · <span className="text-up">0% platform fee</span> · gas applies</p>
      </div>
      <div className="border-t border-line bg-card px-5 py-3 text-[11px] leading-relaxed text-muted text-pretty">Wallet → Uniswap v4 pool. Your funds never pass through openlaunch.</div>
    </section>
  );
}
