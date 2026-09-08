import "server-only";
import { randomBytes } from "node:crypto";
import { isAddress, type Address, type Hex } from "viem";
import { publicClient } from "@/lib/chain";
import { chainIdOf, type ChainKey } from "@/lib/chainPublic";
import { maybeDb } from "@/lib/db";
import { EDIT_TTL_MS, buildEditMessage, isNonce, validateEdit, type EditFields } from "./editAuth";

/**
 * Server half of signed edits. The signature is verified with viem against the
 * token's chain (handles EOAs, ERC-1271 smart wallets and ERC-6492 pre-deploy
 * wallets), the nonce is single-use with a 5-minute TTL, and the signer must
 * be the launcher recorded from the on-chain Launched event.
 */
const buckets = new Map<string, { n: number; at: number }>();
/** Sliding limit: `max` hits per `windowMs` per key (wallet or ip). */
export function rateLimited(key: string, max = 10, windowMs = 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.at > windowMs) {
    buckets.set(key, { n: 1, at: now });
    if (buckets.size > 20_000) buckets.clear();
    return false;
  }
  b.n += 1;
  return b.n > max;
}

export async function issueNonce(chain: ChainKey, token: string, wallet: string): Promise<{ nonce: string; expiresAt: number } | null> {
  const db = maybeDb();
  if (!db) return null;
  const launcher = await db<{ launcher: string }[]>`SELECT launcher FROM bb_launches WHERE chain_id = ${chainIdOf(chain)} AND token = ${token.toLowerCase()}`;
  if (!launcher[0] || launcher[0].launcher !== wallet.toLowerCase()) return null; // only the creator gets a nonce
  // No wallet-keyed limit here: this endpoint is unauthenticated, so the wallet
  // is public knowledge and a wallet bucket would only let strangers freeze
  // the creator. The route's IP limit is the only limit on nonce issuance.
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = Date.now() + EDIT_TTL_MS;
  await db`INSERT INTO bb_edit_nonces (nonce, chain_id, token, wallet, expires_at) VALUES (${nonce}, ${chainIdOf(chain)}, ${token.toLowerCase()}, ${wallet.toLowerCase()}, ${new Date(expiresAt).toISOString()})`;
  void db`DELETE FROM bb_edit_nonces WHERE expires_at < now() - interval '1 hour'`.catch(() => {});
  return { nonce, expiresAt };
}

export type EditRequest = { chain: ChainKey; token: string; wallet: string; nonce: unknown; expiresAt: unknown; signature: unknown; fields: Partial<Record<keyof EditFields, unknown>> };

export async function applySignedEdit(r: EditRequest): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const db = maybeDb();
  if (!db) return { ok: false, error: "db unconfigured", status: 503 };
  if (!isAddress(r.wallet) || !isAddress(r.token)) return { ok: false, error: "bad address", status: 400 };
  if (!isNonce(r.nonce)) return { ok: false, error: "bad nonce", status: 400 };
  const nonce = r.nonce; // narrowed here; closures below cannot see the type guard
  const expiresAt = Number(r.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return { ok: false, error: "expired", status: 400 };
  if (typeof r.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(r.signature)) return { ok: false, error: "bad signature", status: 400 };
  const v = validateEdit(r.fields);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const cid = chainIdOf(r.chain);
  const token = r.token.toLowerCase();
  const wallet = r.wallet.toLowerCase();

  // signer must be the on-chain launcher: a non-creator never touches the nonce or the RPC
  const row = await db<{ launcher: string; name: string; symbol: string }[]>`SELECT launcher, name, symbol FROM bb_launches WHERE chain_id = ${cid} AND token = ${token}`;
  if (!row[0] || row[0].launcher !== wallet) return { ok: false, error: "not the creator", status: 403 };

  // The nonce must be live before anything costly happens: a replayed or made-up
  // nonce gets no RPC call and spends no rate-limit budget. It is consumed only
  // below, once the signature is proven, so a bad signature or an RPC blip
  // leaves it reusable.
  const signedExpiry = new Date(expiresAt).toISOString();
  const live = await db<{ nonce: string }[]>`
    SELECT nonce FROM bb_edit_nonces
     WHERE nonce = ${nonce} AND chain_id = ${cid} AND token = ${token} AND wallet = ${wallet} AND used_at IS NULL AND expires_at > now()
       AND expires_at = ${signedExpiry}`;
  if (live.length === 0) return { ok: false, error: "nonce invalid or already used", status: 401 };

  const message = buildEditMessage({ chain: r.chain, token, wallet, nonce, expiresAt, fields: v.value });
  let valid = false;
  try {
    valid = await publicClient(r.chain).verifyMessage({ address: wallet as Address, message, signature: r.signature as Hex });
  } catch {
    return { ok: false, error: "signature verification unavailable, try again", status: 503 };
  }
  if (!valid) return { ok: false, error: "signature does not match", status: 401 };

  // Only a proven signer holding a live nonce reaches the wallet bucket, so
  // nobody can spend a creator's budget for them.
  if (rateLimited(`edit:wallet:${wallet}`, 10)) return { ok: false, error: "slow down", status: 429 };

  // Consume and write together. The UPDATE is the atomic single-use check (a
  // concurrent duplicate loses here) and a failed write rolls the nonce back.
  return db.begin(async (tx) => {
    const consumed = await tx<{ nonce: string }[]>`
      UPDATE bb_edit_nonces SET used_at = now()
       WHERE nonce = ${nonce} AND chain_id = ${cid} AND token = ${token} AND wallet = ${wallet} AND used_at IS NULL AND expires_at > now()
         AND expires_at = ${signedExpiry}
       RETURNING nonce`;
    if (consumed.length === 0) return { ok: false as const, error: "nonce invalid or already used", status: 401 };
    await tx`
      INSERT INTO bb_launch_meta (chain_id, token, launcher, name, symbol, description, image_url, website, x_handle, updated_at)
      VALUES (${cid}, ${token}, ${wallet}, ${row[0].name}, ${row[0].symbol}, ${v.value.description || null}, ${v.value.image_url || null}, ${v.value.website || null}, ${v.value.x_handle || null}, now())
      ON CONFLICT (chain_id, token) DO UPDATE SET description = EXCLUDED.description, image_url = EXCLUDED.image_url, website = EXCLUDED.website, x_handle = EXCLUDED.x_handle, updated_at = now()`;
    return { ok: true as const };
  });
}
