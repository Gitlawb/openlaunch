/**
 * Which wallets the connect picker offers, in what order, and what a failed connect should say.
 * Pure module (no wagmi or "@/" imports) so node --test loads it directly.
 *
 * wagmi registers three kinds of connector in this app:
 *  - wallets announced by the browser through EIP-6963 (type "injected", id = the wallet's rdns),
 *    added by wagmi's provider discovery on the client;
 *  - the generic `injected()` connector (id "injected"), which talks to whatever `window.ethereum`
 *    is and rejects with ProviderNotFoundError when there is none;
 *  - the Coinbase connector (type "coinbaseWallet"), which needs no extension: Smart Wallet signs
 *    with a passkey in a popup, and the same popup pairs the Coinbase Wallet app.
 */
import { chainList } from "./chainKeys.ts";

export type ConnectorInfo = { id: string; name: string; type: string; icon?: string };

export type WalletChoice = {
  id: string;
  name: string;
  /** One line under the name. */
  hint: string;
  icon?: string;
  kind: "detected" | "browser" | "coinbase";
};

export const COINBASE_CONNECTOR_TYPE = "coinbaseWallet";
export const INJECTED_CONNECTOR_TYPE = "injected";
/** wagmi's generic injected connector: `window.ethereum`, whichever wallet that is. */
export const GENERIC_INJECTED_ID = "injected";

export const NO_WALLET_NOTE = "No wallet extension found in this browser. Coinbase Smart Wallet needs none, or open this page inside your wallet app.";

/**
 * Wallets to offer: every wallet the browser announced, then the generic browser wallet when
 * something is injected but nothing announced itself, then Coinbase (always, it needs no extension).
 */
export function walletChoices(connectors: readonly ConnectorInfo[], { hasInjectedProvider }: { hasInjectedProvider: boolean }): WalletChoice[] {
  const detected = connectors
    .filter((c) => c.type === INJECTED_CONNECTOR_TYPE && c.id !== GENERIC_INJECTED_ID)
    .map<WalletChoice>((c) => ({ id: c.id, name: c.name, hint: "Detected in this browser", icon: c.icon, kind: "detected" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const out: WalletChoice[] = [...detected];
  if (detected.length === 0 && hasInjectedProvider) {
    const generic = connectors.find((c) => c.id === GENERIC_INJECTED_ID);
    if (generic) out.push({ id: generic.id, name: "Browser wallet", hint: "The wallet extension or app in this browser", icon: generic.icon, kind: "browser" });
  }
  const coinbase = connectors.find((c) => c.type === COINBASE_CONNECTOR_TYPE);
  if (coinbase) out.push({ id: coinbase.id, name: coinbase.name, hint: "Smart Wallet with a passkey, or the Coinbase Wallet app", icon: coinbase.icon, kind: "coinbase" });
  return out;
}

type ErrorLike = { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };

/** Walks `err` and its `cause` chain (viem and wagmi wrap the wallet's error) and returns the first match. */
function findCause(err: unknown, test: (e: ErrorLike) => boolean): ErrorLike | null {
  let cur: unknown = err;
  for (let depth = 0; depth < 8 && cur && typeof cur === "object"; depth++) {
    const e = cur as ErrorLike;
    if (test(e)) return e;
    cur = e.cause;
  }
  return null;
}

type Match = { name?: RegExp; message?: RegExp; code?: number | string };
const has = (e: ErrorLike, m: Match) =>
  (m.name !== undefined && m.name.test(String(e.name ?? ""))) ||
  (m.message !== undefined && m.message.test(String(e.message ?? ""))) ||
  (m.code !== undefined && e.code === m.code);

/** User-facing text for a failed wallet connection. Never echoes raw error text. */
export function connectErrorMessage(err: unknown): string {
  const found = (m: Match) => findCause(err, (e) => has(e, m)) !== null;
  if (found({ name: /^ProviderNotFoundError$/, message: /provider not found/i })) return NO_WALLET_NOTE;
  if (found({ name: /^UserRejectedRequestError$/, message: /user rejected|user denied|user closed modal|request rejected|cancelled|canceled/i, code: 4001 }))
    return "The connection was cancelled in the wallet.";
  if (found({ name: /^ConnectorAlreadyConnectedError$/, message: /already connected/i })) return "This wallet is already connected.";
  if (found({ name: /^ResourceUnavailableRpcError$/, message: /already pending|already processing/i, code: -32002 }))
    return "The wallet already has a connection request open. Finish it there, then try again.";
  if (found({ name: /^(ChainNotConfiguredError|SwitchChainError)$/, message: /chain not configured|unrecognized chain/i }))
    return `Connected, but the wallet is on a network this site does not support. Switch to ${chainList("or")} in the wallet.`;
  if (found({ message: /pop-?up|window\.open|blocked/i })) return "The wallet window was blocked. Allow pop-ups for this site and try again.";
  if (found({ message: /cannot find module|failed to fetch dynamically imported module|loading chunk/i, code: "MODULE_NOT_FOUND" }))
    return "That wallet option failed to load. Reload the page and try again.";
  return "Couldn’t connect. Try again, or pick another wallet.";
}
