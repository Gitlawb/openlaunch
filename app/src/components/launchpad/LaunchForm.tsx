"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConfig, useConnect, useSwitchChain } from "wagmi";
import { getPublicClient, getWalletClient } from "wagmi/actions";
import { isAddress, parseEventLogs, type Address, type Hex } from "viem";
import TokenAvatar from "./TokenAvatar";
import ImageUpload from "./ImageUpload";
import FeeChip from "./FeeChip";
import { toast } from "./TxToasts";
import { btn, card, helper, input, label } from "@/components/ui";
import { LAUNCH_FACTORY_ABI } from "@/lib/launchpad/abi";
import { BPS, DEFAULT_SUPPLY, FEE_PRESETS, MCAP_PRESETS, launchpad, quoteUsdOf, type Quote } from "@/lib/launchpad/config";
import { fdvForStartTick, fmtCompact, fmtUsd, startTickForFdv, tickToTokensPerQuote } from "@/lib/launchpad/math";
import { stockMcapPresets } from "@/lib/launchpad/stocks";
import { CHAINS, CHAIN_LABELS, CHAIN_KEYS, BUILDER_DATA_SUFFIX, explorerTx, shortAddr, type ChainKey } from "@/lib/chainPublic";
import { friendlyError } from "@/lib/errors";
import { Spinner } from "@/components/Skeleton";
import { startNav } from "@/components/RouteProgress";

/**
 * Launch flow — honest states, nothing claimed before the chain says so:
 *   idle → saving (metadata → predicted address) → simulating → signing → sent (hash) → indexing → done → /t/<token>
 */
type Phase =
  | { k: "idle" }
  | { k: "saving" }
  | { k: "simulating" }
  | { k: "signing" }
  | { k: "sent"; hash: Hex }
  | { k: "indexing"; hash: Hex }
  | { k: "done"; hash: Hex; token: string }
  | { k: "error"; message: string };

type Beneficiary = "burn" | "me" | "custom";

function randomSalt(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export default function LaunchForm({ ethUsd, initialChain = "base" }: { ethUsd: number | null; initialChain?: ChainKey }) {
  const router = useRouter();
  const [chain, setChain] = useState<ChainKey>(initialChain);
  const cfg = launchpad(chain);
  const CHAIN = CHAINS[chain];
  const CHAIN_LABEL = CHAIN_LABELS[chain];
  const [quoteKey, setQuoteKey] = useState<Quote["key"]>(launchpad(initialChain).quotes[0].key);
  const [stock, setStock] = useState<Quote | null>(null);
  const [stockQ, setStockQ] = useState("");
  const [stockHits, setStockHits] = useState<Quote[]>([]);
  const quote: Quote = quoteKey === "stock" && stock ? stock : (cfg.quotes.find((q) => q.key === quoteKey) ?? cfg.quotes[0]);
  const quoteUsd = quoteUsdOf(quote, ethUsd);
  // stock search (per-chain registry via our server; only registry addresses are ever offered)
  useEffect(() => {
    if (quoteKey !== "stock") return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/quotes?chain=${chain}&q=${encodeURIComponent(stockQ)}`, { cache: "no-store" });
        const d = (await res.json()) as { stocks: Quote[] };
        if (alive) setStockHits(d.stocks ?? []);
      } catch {
        if (alive) setStockHits([]);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [chain, quoteKey, stockQ]);
  const config = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [website, setWebsite] = useState("");
  const [x, setX] = useState("");
  const [mcapPick, setMcapPick] = useState<number | null>(null);
  const [customMcap, setCustomMcap] = useState("");
  const [feePips, setFeePips] = useState<number>(0);
  const [beneficiary, setBeneficiary] = useState<Beneficiary>("burn");
  const [customAddr, setCustomAddr] = useState("");
  // Generated lazily at launch time (a render-time random value would break hydration).
  const saltRef = useRef<Hex | null>(null);
  // The metadataURI is keyed by meta_key, so findSalt can change the salt freely within one attempt. Both refs are
  // kept across attempts so an identical retry is idempotent; when the details changed since the key was registered
  // the server answers 409 and launch() rotates BOTH (a key is locked to the details it was first registered with).
  const metaKeyRef = useRef<Hex | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });

  const presets = quote.key === "stock" ? stockMcapPresets(quote.usd ?? 0) : MCAP_PRESETS[quote.key];
  const mcap = customMcap.trim() ? Number(customMcap) : (mcapPick ?? presets[2] ?? 0);
  const startTick = mcap > 0 && Number.isFinite(mcap) ? startTickForFdv(mcap, quote.decimals) : null;
  const fdvPreview = startTick !== null ? fdvForStartTick(startTick, quote.decimals) : null;
  const tokensPerEth = startTick !== null ? tickToTokensPerQuote(startTick, quote.decimals) : null;
  const fmtMcap = (v: number) => (quote.decimals <= 6 ? `${v.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${quote.symbol}` : `${v.toFixed(quote.key === "stock" ? 3 : 2)} ${quote.symbol}`);

  const symbolClean = symbol.trim().toUpperCase();
  const errors: string[] = [];
  if (name.trim().length === 0 || name.trim().length > 32) errors.push("Name: 1–32 characters.");
  if (!/^[A-Z0-9]{1,10}$/.test(symbolClean)) errors.push("Symbol: 1–10 letters or digits.");
  if (startTick === null) errors.push("Starting market cap must be a positive number.");
  if (quoteKey === "stock" && !stock) errors.push("Pick a stock to price the token in.");
  if (image && !/^https:\/\//.test(image.trim())) errors.push("Image must be an https URL.");
  if (website && !/^https:\/\//.test(website.trim())) errors.push("Website must be an https URL.");
  if (feePips > 0 && beneficiary === "custom" && !isAddress(customAddr.trim())) errors.push("Beneficiary: enter a valid address.");
  const valid = errors.length === 0;

  const onChain = chainId === CHAIN.id;

  const recipients = useMemo(() => {
    if (feePips === 0 || beneficiary === "burn") return [] as { payout: Address; bps: number }[];
    const payout = (beneficiary === "me" ? address : (customAddr.trim() as Address)) as Address | undefined;
    return payout ? [{ payout, bps: BPS }] : [];
  }, [feePips, beneficiary, address, customAddr]);

  async function launch() {
    if (!valid || !address || !cfg.factory || startTick === null) return;
    const FACTORY_ADDRESS = cfg.factory;
    let salt = saltRef.current ?? (saltRef.current = randomSalt());
    let metaKey = metaKeyRef.current ?? (metaKeyRef.current = randomSalt());
    const register = async (s: Hex) => {
      const res = await fetch("/api/launch/meta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chain, launcher: address, salt: s, meta_key: metaKey, name: name.trim(), symbol: symbolClean, description, image_url: image, website, x_handle: x }),
      });
      const j = (await res.json()) as { uri?: string; token?: string; error?: string };
      return { status: res.status, ...j };
    };
    try {
      if (!onChain) await switchChainAsync({ chainId: CHAIN.id });
      setPhase({ k: "saving" });
      let meta = await register(salt);
      if (meta.status === 409) {
        // An earlier attempt registered this key (and salt) with different details, and a key is locked to the
        // details it was first registered with: start a fresh attempt with a new key AND a new salt. The new key
        // then stays fixed for the rest of this attempt, including the salt search below.
        metaKey = metaKeyRef.current = randomSalt();
        salt = saltRef.current = randomSalt();
        meta = await register(salt);
      }
      if (meta.status !== 200 || !meta.uri) throw new Error(meta.error ?? "could not save metadata");

      setPhase({ k: "simulating" });
      const pub = getPublicClient(config, { chainId: CHAIN.id })!;
      if (quote.key !== "eth") {
        // ERC20 quote: the token must sort above the quote address — let the factory pick a salt that does.
        const [found] = await pub.readContract({
          address: FACTORY_ADDRESS,
          abi: LAUNCH_FACTORY_ABI,
          functionName: "findSalt",
          args: [address, salt, name.trim(), symbolClean, DEFAULT_SUPPLY, meta.uri, quote.address, 64n],
        });
        if (found !== salt) {
          salt = found;
          saltRef.current = found;
          // the URI is keyed by meta_key, so it does not change; register the row for the token the new salt produces
          const meta2 = await register(salt);
          if (meta2.status !== 200 || !meta2.uri) throw new Error(meta2.error ?? "could not save metadata");
          if (meta2.uri !== meta.uri) throw new Error("metadata URI changed during the salt search");
          meta.token = meta2.token;
        }
      }
      const params = {
        name: name.trim(),
        symbol: symbolClean,
        metadataURI: meta.uri,
        quote: quote.address as Address,
        supply: DEFAULT_SUPPLY,
        startTick,
        lpFee: feePips,
        salt,
        recipients,
      };
      const { request } = await pub.simulateContract({
        address: FACTORY_ADDRESS,
        abi: LAUNCH_FACTORY_ABI,
        functionName: "launch",
        args: [params],
        account: address,
        dataSuffix: BUILDER_DATA_SUFFIX,
      });

      setPhase({ k: "signing" });
      const wallet = await getWalletClient(config, { chainId: CHAIN.id });
      const hash = await wallet.writeContract(request);
      setPhase({ k: "sent", hash });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted on-chain.");
      const [ev] = parseEventLogs({ abi: LAUNCH_FACTORY_ABI, eventName: "Launched", logs: receipt.logs });
      const token = (ev?.args.token ?? meta.token ?? "").toLowerCase();

      setPhase({ k: "indexing", hash });
      await fetch(`/api/launch/sync?chain=${chain}&tx=${hash}`, { method: "POST" }).catch(() => {});
      setPhase({ k: "done", hash, token });
      toast({ kind: "launch", title: `${name.trim()} is live on ${CHAIN_LABEL}`, sub: "Liquidity locked forever. Taking you to your token.", chain, token, symbol: symbolClean, celebrate: true });
      startNav();
      router.push(`/t/${chain}/${token}`);
    } catch (err) {
      setPhase({ k: "error", message: friendlyError(err) });
    }
  }

  const previewMcapUsd = fdvPreview !== null && quoteUsd ? fmtUsd(fdvPreview * quoteUsd, { compact: true }) : null;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem] gap-6 lg:gap-8 items-start">
      <form
        className="space-y-6 min-w-0"
        onSubmit={(e) => {
          e.preventDefault();
          void launch();
        }}
      >
        {/* chain + quote */}
        <section className={`${card} p-5 space-y-4`}>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-ink">Chain</h2>
            <span className="text-xs text-muted">same contracts, same rules, on both</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {CHAIN_KEYS.map((k) => {
              const active = chain === k;
              const ok = launchpad(k).configured;
              return (
                <button
                  type="button"
                  key={k}
                  disabled={!ok}
                  onClick={() => {
                    setChain(k);
                    setQuoteKey(launchpad(k).quotes[0].key);
                    setMcapPick(null);
                    setCustomMcap("");
                  }}
                  className={`text-left rounded-xl border p-3.5 transition-colors disabled:opacity-40 ${active ? "border-brand bg-brand-soft" : "border-line-strong bg-card hover:border-ink/40"}`}
                  aria-pressed={active}
                >
                  <div className={`font-semibold text-sm ${active ? "text-brand" : "text-ink"}`}>{CHAIN_LABELS[k]}</div>
                  <div className="text-xs text-body mt-0.5 leading-snug">{k === "base" ? "Priced in ETH or a Coinbase tokenized stock. Gas ≈ cents." : ok ? "Priced in USDG (dollars), ETH or a Robinhood Stock Token. Gas ≈ cents." : "Coming soon."}</div>
                </button>
              );
            })}
          </div>
          {/* every chain offers at least one fixed quote plus tokenized stocks */}
          {cfg.quotes.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className={label}>Priced in</span>
              <div className="flex items-center rounded-full border border-line bg-card p-0.5" role="group" aria-label="quote asset">
                {[...cfg.quotes.map((q) => ({ key: q.key, label: q.symbol })), { key: "stock" as const, label: "Stock" }].map((q) => (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => {
                      setQuoteKey(q.key);
                      setMcapPick(null);
                      setCustomMcap("");
                    }}
                    className={`h-8 px-3 rounded-full text-xs font-mono font-bold ${quoteKey === q.key ? "bg-ink text-brand-fg" : "text-body hover:text-ink"}`}
                    aria-pressed={quoteKey === q.key}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted">
                {quote.key === "usdg" ? "Buyers pay with USDG; market cap and fees are in dollars." : quote.key === "stock" ? (chain === "base" ? "Buyers pay with a Coinbase tokenized stock; fees are paid in that stock." : "Buyers pay with a Robinhood Stock Token; fees are paid in that stock.") : "Buyers pay with ETH."}
              </span>
            </div>
          ) : null}
          {quoteKey === "stock" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {stock ? (
                  <span className="inline-flex items-center gap-2 h-9 pl-1.5 pr-3 rounded-full border border-brand bg-brand-soft text-brand text-sm font-semibold">
                    {stock.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={stock.logo} alt="" width={22} height={22} className={`${stock.logo.startsWith("data:") ? "rounded-md" : "rounded-full"} bg-card`} referrerPolicy="no-referrer" />
                    ) : null}
                    {stock.symbol}
                    <span className="font-normal text-xs opacity-80">{stock.name}</span>
                    {stock.usd ? <span className="font-mono text-xs opacity-80">{fmtUsd(stock.usd)}</span> : null}
                    <button type="button" onClick={() => setStock(null)} aria-label="change stock" className="ml-1 opacity-70 hover:opacity-100">
                      ×
                    </button>
                  </span>
                ) : (
                  <input className={`${input} h-10 max-w-xs font-mono uppercase`} value={stockQ} onChange={(e) => setStockQ(e.target.value)} placeholder="Search ticker, e.g. AAPL" aria-label="search stock tokens" autoComplete="off" />
                )}
              </div>
              {!stock ? (
                <ul className="flex flex-wrap gap-1.5">
                  {stockHits.map((h) => (
                    <li key={h.address}>
                      <button
                        type="button"
                        onClick={() => {
                          setStock(h);
                          setMcapPick(null);
                          setCustomMcap("");
                        }}
                        className="inline-flex items-center gap-1.5 h-8 pl-1.5 pr-2.5 rounded-full border border-line bg-card text-xs font-semibold text-ink hover:border-ink/40"
                        title={h.name}
                      >
                        {h.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={h.logo} alt="" width={18} height={18} className={`${h.logo.startsWith("data:") ? "rounded" : "rounded-full"} bg-paper`} referrerPolicy="no-referrer" />
                        ) : null}
                        {h.symbol}
                        {h.usd ? <span className="font-mono font-normal text-muted">{fmtUsd(h.usd)}</span> : null}
                      </button>
                    </li>
                  ))}
                  {stockHits.length === 0 ? <li className="text-xs text-muted">{chain === "base" ? "No match. 13 Coinbase tokenized stocks are available on Base: NVDAc, AAPLc, TSLAc, METAc, GOOGLc, AMZNc, MSFTc, MSTRc, COINc, CRCLc, INTCc, SNDKc, SPCXc." : "No match. 194 Robinhood Stock Tokens are available, e.g. AAPL, TSLA, NVDA, SPY."}</li> : null}
                </ul>
              ) : null}
              <p className={helper}>
                {chain === "base"
                  ? "Coinbase tokenized stocks are securities issued by Coinbase under Regulation S and are not offered to persons in the US, UK, Canada, Australia, Singapore or Switzerland — that is Coinbase's rule for the stock token, not ours. The pool itself is ordinary Uniswap v4."
                  : "Robinhood Stock Tokens are tokenised securities issued by Robinhood and are not offered to US persons — that is Robinhood's rule for the stock token, not ours. The pool itself is ordinary Uniswap v4."}
              </p>
            </div>
          ) : null}
        </section>

        {/* identity */}
        <section className={`${card} p-5 space-y-4`}>
          <h2 className="text-sm font-semibold text-ink">Token</h2>
          <div className="grid sm:grid-cols-[minmax(0,1fr)_9rem] gap-4">
            <div>
              <label className={label} htmlFor="name">
                Name
              </label>
              <input id="name" className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Clear Sky" maxLength={32} autoComplete="off" />
            </div>
            <div>
              <label className={label} htmlFor="symbol">
                Symbol
              </label>
              <input id="symbol" className={`${input} font-mono uppercase`} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="SKY" maxLength={10} autoComplete="off" />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="desc">
              Description <span className="text-muted font-normal">· optional</span>
            </label>
            <textarea id="desc" className={`${input} h-auto py-3 min-h-20 resize-y`} value={description} onChange={(e) => setDescription(e.target.value.slice(0, 280))} placeholder="What is this? One or two lines." />
            <p className={helper}>{280 - description.length} left</p>
          </div>
          <div>
            <p className={label}>
              Image <span className="text-muted font-normal">· optional, but tokens with a logo get traded</span>
            </p>
            <ImageUpload value={image} onChange={setImage} wallet={address} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="web">
                Website <span className="text-muted font-normal">· optional</span>
              </label>
              <input id="web" className={input} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" inputMode="url" />
            </div>
            <div>
              <label className={label} htmlFor="x">
                X <span className="text-muted font-normal">· optional</span>
              </label>
              <input id="x" className={input} value={x} onChange={(e) => setX(e.target.value)} placeholder="@handle" />
            </div>
          </div>
        </section>

        {/* price */}
        <section className={`${card} p-5 space-y-4`}>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-ink">Starting market cap</h2>
            <span className="text-xs text-muted">1,000,000,000 supply · all of it in the pool</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.map((v) => {
              const active = !customMcap.trim() && (mcapPick ?? presets[2] ?? presets[0]) === v;
              return (
                <button
                  type="button"
                  key={v}
                  onClick={() => {
                    setMcapPick(v);
                    setCustomMcap("");
                  }}
                  className={`h-11 px-4 rounded-xl border font-mono text-sm font-bold tnum ${active ? "bg-ink text-brand-fg border-ink" : "bg-card text-ink border-line-strong hover:border-ink/40"}`}
                >
                  {quote.key === "stock" ? `$${fmtCompact(v * (quote.usd ?? 0), 0)}` : quote.decimals <= 6 ? `$${fmtCompact(v, 0)}` : `${v} ${quote.symbol}`}
                </button>
              );
            })}
            <div className="relative">
              <input
                className={`${input} h-11 w-36 font-mono pr-12`}
                value={customMcap}
                onChange={(e) => setCustomMcap(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="custom"
                inputMode="decimal"
                aria-label={`custom starting market cap in ${quote.symbol}`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted">{quote.symbol}</span>
            </div>
          </div>
          {fdvPreview !== null && tokensPerEth !== null ? (
            <p className="text-sm text-body">
              Opens at <span className="font-mono font-bold text-ink tnum">{fmtMcap(fdvPreview)}</span>
              {previewMcapUsd && quote.key !== "usdg" ? <span className="font-mono text-muted tnum"> ≈ {previewMcapUsd}</span> : null} fully diluted. The first {quote.symbol} buys about{" "}
              <span className="font-mono font-bold text-ink tnum">{fmtCompact(tokensPerEth, 0)}</span> tokens, then the price climbs along the curve.
            </p>
          ) : null}
        </section>

        {/* fees */}
        <section className={`${card} p-5 space-y-4`}>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-ink">Trading fee</h2>
            <span className="text-xs text-up font-medium">Platform fee: 0, always</span>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            {FEE_PRESETS.map((f) => {
              const active = feePips === f.pips;
              return (
                <button
                  type="button"
                  key={f.pips}
                  onClick={() => {
                    setFeePips(f.pips);
                    if (f.pips === 0) setBeneficiary("burn");
                  }}
                  className={`text-left rounded-xl border p-3.5 transition-colors ${active ? "border-brand bg-brand-soft" : "border-line-strong bg-card hover:border-ink/40"}`}
                  aria-pressed={active}
                >
                  <div className={`font-mono font-bold text-lg tnum ${active ? "text-brand" : "text-ink"}`}>{f.label}</div>
                  <div className="text-xs text-body mt-0.5 leading-snug">{f.blurb}</div>
                </button>
              );
            })}
          </div>

          {feePips > 0 ? (
            <div className="space-y-3 pt-1">
              <p className={label}>Who receives the fee?</p>
              <div className="grid sm:grid-cols-3 gap-2">
                {(
                  [
                    { k: "burn", t: "Burn it", d: "No beneficiary. Every fee is sent to 0x…dEaD at collect time." },
                    { k: "me", t: "Me", d: address ? shortAddr(address) : "The connected wallet." },
                    { k: "custom", t: "Someone else", d: "Any address: a friend, a charity, a DAO." },
                  ] as { k: Beneficiary; t: string; d: string }[]
                ).map((o) => {
                  const active = beneficiary === o.k;
                  return (
                    <button
                      type="button"
                      key={o.k}
                      onClick={() => setBeneficiary(o.k)}
                      className={`text-left rounded-xl border p-3.5 transition-colors ${active ? "border-brand bg-brand-soft" : "border-line-strong bg-card hover:border-ink/40"}`}
                      aria-pressed={active}
                    >
                      <div className={`font-semibold text-sm ${active ? "text-brand" : "text-ink"}`}>{o.t}</div>
                      <div className="text-xs text-body mt-0.5 leading-snug">{o.d}</div>
                    </button>
                  );
                })}
              </div>
              {beneficiary === "custom" ? (
                <input className={`${input} font-mono`} value={customAddr} onChange={(e) => setCustomAddr(e.target.value.trim())} placeholder="0x…" aria-label="beneficiary address" />
              ) : null}
              <p className={helper}>Fixed forever at launch. Not even you can change it later — that&apos;s the point.</p>
            </div>
          ) : (
            <p className={helper}>A 0% pool: trades cost only Uniswap gas. Nobody, including you, earns from volume.</p>
          )}
        </section>

        {/* submit */}
        <section className={`${card} p-5 space-y-3`}>
          {errors.length > 0 && (name || symbol) ? (
            <ul className="text-xs text-warm-ink space-y-0.5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          <SubmitButton
            chainLabel={CHAIN_LABEL}
            configured={cfg.configured}
            connected={isConnected}
            onChain={onChain}
            connecting={connecting || switching}
            valid={valid}
            phase={phase}
            onConnect={() => {
              const c = connectors.find((c) => c.id === "coinbaseWallet") ?? connectors[0];
              if (c) connect({ connector: c });
            }}
            onSwitch={() => void switchChainAsync({ chainId: CHAIN.id })}
          />
          <PhaseNote phase={phase} chain={chain} />
          <p className="text-xs text-muted leading-relaxed">
            One transaction on {CHAIN_LABEL}: deploys the token, creates the Uniswap v4 pool ({quote.symbol} / your token), locks 100% of the supply in it forever, and registers the fee routing. Cost: gas only, usually a few cents.
            Nothing is refundable and nothing can be edited afterwards.
          </p>
        </section>
      </form>

      {/* preview */}
      <aside className="lg:sticky lg:top-32 space-y-4 min-w-0 order-first lg:order-none">
        <div className={`${card} p-4`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Preview</p>
          <div className="mt-3 flex items-center gap-3">
            <TokenAvatar token={`0x${symbolClean || "token"}`} symbol={symbolClean || "?"} image={/^https:\/\//.test(image.trim()) ? image.trim() : null} size={48} />
            <div className="min-w-0">
              <div className="font-semibold text-ink truncate">{name.trim() || "Your token"}</div>
              <div className="font-mono text-xs text-muted">{symbolClean || "TICKER"}</div>
            </div>
            <FeeChip lpFee={feePips} mode={feePips === 0 ? "free" : beneficiary === "burn" ? "burn" : "creator"} className="ml-auto" />
          </div>
          {description.trim() ? <p className="mt-3 text-sm text-body line-clamp-3">{description.trim()}</p> : null}
          <dl className="mt-4 grid grid-cols-2 gap-2">
            <Mini k="Opens at" v={fdvPreview !== null ? fmtMcap(fdvPreview) : "—"} sub={quote.key !== "usdg" ? previewMcapUsd : CHAIN_LABELS[chain]} />
            <Mini k="Supply" v="1B" sub="100% in pool" />
            <Mini k="Trading fee" v={FEE_PRESETS.find((f) => f.pips === feePips)?.label ?? "—"} sub={feePips === 0 ? "free pool" : beneficiary === "burn" ? "burned" : "to beneficiary"} />
            <Mini k="Platform fee" v="0" sub="always" accent />
          </dl>
        </div>
        <ul className="text-[13px] text-body space-y-2 px-1">
          {[
            ["Deploys a plain ERC-20", "no mint, no pause, no blacklist, no tax"],
            ["Opens a Uniswap v4 pool", `${quote.symbol} / your token on ${CHAIN_LABELS[chain]}, no hook`],
            ["Locks 100% of supply as liquidity", "the position NFT lives in an ownerless locker, forever"],
            ["Routes trading fees", feePips === 0 ? "nothing to route at 0%" : beneficiary === "burn" ? "burned at collect time" : "100% to the beneficiary, claimable any time"],
          ].map(([t, d]) => (
            <li key={t} className="flex gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-brand shrink-0" aria-hidden />
              <span>
                <span className="font-medium text-ink">{t}</span> <span className="text-muted">— {d}</span>
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function Mini({ k, v, sub, accent }: { k: string; v: string; sub?: string | null; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-paper border border-line px-3 py-2.5 min-w-0">
      <dt className="text-[11px] text-muted truncate">{k}</dt>
      <dd className={`font-mono font-bold text-sm tnum truncate ${accent ? "text-up" : "text-ink"}`}>{v}</dd>
      {sub ? <dd className="text-[11px] text-muted truncate">{sub}</dd> : null}
    </div>
  );
}

function SubmitButton({
  chainLabel,
  configured,
  connected,
  onChain,
  connecting,
  valid,
  phase,
  onConnect,
  onSwitch,
}: {
  chainLabel: string;
  configured: boolean;
  connected: boolean;
  onChain: boolean;
  connecting: boolean;
  valid: boolean;
  phase: Phase;
  onConnect: () => void;
  onSwitch: () => void;
}) {
  const cls = `${btn.primary} w-full min-h-12 text-[15px]`;
  if (!configured)
    return (
      <button type="button" disabled className={cls}>
        Launchpad not configured
      </button>
    );
  if (!connected)
    return (
      <button type="button" onClick={onConnect} disabled={connecting} className={cls}>
        {connecting ? "Connecting…" : "Connect wallet to launch"}
      </button>
    );
  if (!onChain)
    return (
      <button type="button" onClick={onSwitch} disabled={connecting} className={`${btn.warm} w-full min-h-12 text-[15px]`}>
        {connecting ? "Switching…" : `Switch to ${chainLabel}`}
      </button>
    );
  const busyLabel: Partial<Record<Phase["k"], string>> = {
    saving: "Saving details…",
    simulating: "Checking the launch…",
    signing: "Confirm in your wallet…",
    sent: `Confirming on ${chainLabel}…`,
    indexing: "Almost there…",
    done: "Launched!",
  };
  const busy = busyLabel[phase.k];
  return (
    <button type="submit" disabled={!valid || Boolean(busy)} className={cls}>
      {busy ? (
        <>
          <Spinner size={14} /> {busy}
        </>
      ) : (
        "Launch — free, gas only"
      )}
    </button>
  );
}

function PhaseNote({ phase, chain }: { phase: Phase; chain: ChainKey }) {
  if (phase.k === "error")
    return (
      <p className="rounded-xl bg-down-soft border border-down/20 text-down-ink text-sm px-3 py-2" role="alert">
        {phase.message}
      </p>
    );
  if (phase.k === "sent" || phase.k === "indexing" || phase.k === "done")
    return (
      <p className="text-xs text-muted">
        Transaction{" "}
        <a href={explorerTx(chain, phase.hash)} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-2 hover:text-ink">
          {phase.hash.slice(0, 10)}…
        </a>
        {phase.k === "done" ? " confirmed. Taking you to your token." : " sent."}
      </p>
    );
  return null;
}
