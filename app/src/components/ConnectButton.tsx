"use client";

import { useSyncExternalStore } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { CHAINS, CHAIN_SHORT, chainKeyOf, shortAddr } from "@/lib/chainPublic";

/**
 * Wallet chip. `block` renders a full-width row for the mobile menu sheet;
 * default is the compact inline chip for the desktop header.
 */
export default function ConnectButton({ block = false }: { block?: boolean }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  // Wallet state only exists on the client; render a neutral pill during SSR/hydration.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const base = `${block ? "w-full min-h-12 px-4 text-sm" : "h-9 px-3.5 text-[13px]"} inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-50 whitespace-nowrap`;

  if (!mounted) return <div className={`${base} border border-line text-faint`}>Wallet</div>;

  if (!isConnected) {
    const connector = connectors.find((c) => c.id === "coinbaseWallet") ?? connectors[0];
    return (
      <button
        onClick={() => connector && connect({ connector })}
        disabled={isPending || !connector}
        className={`${base} border border-line-strong text-ink hover:border-ink/40 hover:bg-paper`}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }
  const key = chainKeyOf(chainId);
  if (!key) {
    return (
      <button
        onClick={() => switchChain({ chainId: CHAINS.base.id })}
        disabled={switching}
        className={`${base} bg-warm-soft border border-warm/40 text-warm-ink hover:border-warm`}
      >
        {switching ? "Switching…" : "Switch to Base"}
      </button>
    );
  }
  return (
    <button onClick={() => disconnect()} title={`Disconnect (on ${CHAIN_SHORT[key]})`} className={`${base} bg-brand-soft text-brand hover:bg-brand hover:text-brand-fg font-mono tnum`}>
      <span className="inline-block h-2 w-2 rounded-full bg-up" aria-hidden />
      {shortAddr(address)}
      <span className="font-sans text-[10px] font-semibold uppercase tracking-wide opacity-70">{CHAIN_SHORT[key]}</span>
      {block ? <span className="ml-auto text-xs font-sans font-normal opacity-70">Disconnect</span> : null}
    </button>
  );
}
