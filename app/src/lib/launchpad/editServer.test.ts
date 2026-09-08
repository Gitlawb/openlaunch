import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import ts from "typescript";
import * as editAuth from "./editAuth.ts";

const source = readFileSync(new URL("./editServer.ts", import.meta.url), "utf8");
const editRoute = readFileSync(new URL("../../app/api/launch/edit/route.ts", import.meta.url), "utf8");
const nonceRoute = readFileSync(new URL("../../app/api/launch/edit/nonce/route.ts", import.meta.url), "utf8");

const CHAIN = "base";
const TOKEN = "0x" + "11".repeat(20);
const WALLET = "0x" + "ab".repeat(20);
const SIG = "0x" + "c".repeat(130);
const EXPIRES_AT = Date.now() + 300_000;

type NonceRow = { chain_id: number; token: string; wallet: string; expires_at: string; used_at: string | null };
type Call = { sql: string; values: unknown[]; inTx: boolean };

/**
 * Compile editServer.ts alone, replacing every import with a local fake. The fake
 * database answers the module's own SQL from an in-memory nonce table and rolls that
 * table back when a transaction callback throws, as postgres.js does.
 */
function isolated(opts: { rpc?: boolean | "throw"; failWrite?: boolean } = {}) {
  const state = {
    rpc: opts.rpc ?? true,
    failWrite: opts.failWrite ?? false,
    nonces: new Map<string, NonceRow>(),
    launchers: new Map<string, { launcher: string; name: string; symbol: string }>([[TOKEN, { launcher: WALLET, name: "Test", symbol: "TST" }]]),
    meta: null as unknown[] | null,
  };
  const calls: Call[] = [];
  const rpc: unknown[] = [];
  let inTx = false;
  const liveNonce = (values: unknown[]) => {
    const [nonce, chainId, token, wallet, expiry] = values as [string, number, string, string, string];
    const row = state.nonces.get(nonce);
    const ok = row && row.used_at === null && row.chain_id === chainId && row.token === token && row.wallet === wallet && row.expires_at === expiry && new Date(row.expires_at).getTime() > Date.now();
    return ok ? row : null;
  };
  const db = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join("?");
    calls.push({ sql, values, inTx });
    if (/FROM bb_launches/.test(sql)) {
      const row = state.launchers.get(String(values[1]));
      return row ? [row] : [];
    }
    if (/SELECT nonce FROM bb_edit_nonces/.test(sql)) return liveNonce(values) ? [{ nonce: values[0] }] : [];
    if (/UPDATE bb_edit_nonces SET used_at/.test(sql)) {
      const row = liveNonce(values);
      if (!row) return [];
      row.used_at = new Date().toISOString();
      return [{ nonce: values[0] }];
    }
    if (/INSERT INTO bb_launch_meta/.test(sql)) {
      if (state.failWrite) throw new Error("write failed");
      state.meta = values;
      return [];
    }
    if (/INSERT INTO bb_edit_nonces/.test(sql)) {
      const [nonce, chain_id, token, wallet, expires_at] = values as [string, number, string, string, string];
      state.nonces.set(nonce, { chain_id, token, wallet, expires_at, used_at: null });
      return [];
    }
    return [];
  };
  (db as unknown as { begin: unknown }).begin = async (fn: (tx: typeof db) => Promise<unknown>) => {
    const snapshot = new Map([...state.nonces].map(([k, v]) => [k, { ...v }]));
    inTx = true;
    try {
      return await fn(db);
    } catch (error) {
      state.nonces = snapshot;
      throw error;
    } finally {
      inTx = false;
    }
  };
  const imports: Record<string, unknown> = {
    "server-only": {},
    "node:crypto": { randomBytes },
    viem: { isAddress: (value: string) => /^0x[0-9a-f]{40}$/i.test(value) },
    "@/lib/chain": {
      publicClient: () => ({
        verifyMessage: async (args: unknown) => {
          rpc.push(args);
          if (state.rpc === "throw") throw new Error("rpc down");
          return state.rpc;
        },
      }),
    },
    "@/lib/chainPublic": { chainIdOf: () => 8453 },
    "@/lib/db": { maybeDb: () => db },
    "./editAuth": editAuth,
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported = {} as {
    applySignedEdit: (r: Record<string, unknown>) => Promise<{ ok: boolean; status?: number; error?: string }>;
    issueNonce: (chain: string, token: string, wallet: string) => Promise<{ nonce: string; expiresAt: number } | null>;
    rateLimited: (key: string, max?: number) => boolean;
  };
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(Object.hasOwn(imports, id), `unexpected production import: ${id}`);
    return imports[id];
  }, exported);
  const seed = (nonce = "a".repeat(32), used = false) => {
    state.nonces.set(nonce, { chain_id: 8453, token: TOKEN, wallet: WALLET, expires_at: new Date(EXPIRES_AT).toISOString(), used_at: used ? "2026-01-01T00:00:00.000Z" : null });
    return nonce;
  };
  const request = (overrides: Record<string, unknown> = {}) => ({ chain: CHAIN, token: TOKEN, wallet: WALLET, nonce: "a".repeat(32), expiresAt: EXPIRES_AT, signature: SIG, fields: { description: "hello" }, ...overrides });
  return { ...exported, state, calls, rpc, seed, request };
}

test("a bad signature leaves the nonce reusable and spends none of the creator's budget", async () => {
  const s = isolated({ rpc: false });
  s.seed();
  for (let i = 0; i < 10; i++) {
    const r = await s.applySignedEdit(s.request());
    assert.deepEqual(r, { ok: false, error: "signature does not match", status: 401 });
  }
  assert.equal(s.state.nonces.get("a".repeat(32))?.used_at, null);
  assert.equal(s.rpc.length, 10);
  s.state.rpc = true;
  assert.deepEqual(await s.applySignedEdit(s.request()), { ok: true }, "the creator's real edit must not be rate-limited by the failures");
  assert.notEqual(s.state.nonces.get("a".repeat(32))?.used_at, null);
});

test("an RPC failure returns 503 and keeps the nonce", async () => {
  const s = isolated({ rpc: "throw" });
  s.seed();
  const r = await s.applySignedEdit(s.request());
  assert.equal(r.status, 503);
  assert.equal(s.state.nonces.get("a".repeat(32))?.used_at, null);
  assert.equal(s.state.meta, null);
});

test("a valid edit consumes the nonce and writes metadata inside one transaction", async () => {
  const s = isolated();
  s.seed();
  assert.deepEqual(await s.applySignedEdit(s.request({ fields: { description: "hi", website: "https://example.com/" } })), { ok: true });
  const consume = s.calls.find((c) => /UPDATE bb_edit_nonces/.test(c.sql));
  const write = s.calls.find((c) => /INSERT INTO bb_launch_meta/.test(c.sql));
  assert.ok(consume?.inTx && write?.inTx, "consume and write must share the transaction");
  assert.ok(s.calls.indexOf(consume) < s.calls.indexOf(write));
  assert.deepEqual(consume.values, ["a".repeat(32), 8453, TOKEN, WALLET, new Date(EXPIRES_AT).toISOString()]);
  assert.deepEqual(write.values.slice(0, 9), [8453, TOKEN, WALLET, "Test", "TST", "hi", null, "https://example.com/", null]);
  assert.deepEqual(await s.applySignedEdit(s.request()), { ok: false, error: "nonce invalid or already used", status: 401 }, "single use");
});

test("a failed metadata write rolls the nonce back", async () => {
  const s = isolated({ failWrite: true });
  s.seed();
  await assert.rejects(s.applySignedEdit(s.request()), /write failed/);
  assert.equal(s.state.nonces.get("a".repeat(32))?.used_at, null);
});

test("a replayed or unknown nonce is refused before the RPC and before the wallet bucket", async () => {
  const s = isolated();
  s.seed("a".repeat(32), true);
  for (let i = 0; i < 10; i++) {
    const r = await s.applySignedEdit(s.request());
    assert.equal(r.status, 401);
  }
  assert.equal((await s.applySignedEdit(s.request({ nonce: "f".repeat(32) }))).status, 401);
  assert.equal(s.rpc.length, 0, "no signature verification without a live nonce");
  const fresh = s.seed("b".repeat(32));
  assert.deepEqual(await s.applySignedEdit(s.request({ nonce: fresh })), { ok: true }, "replays must not freeze the creator");
});

test("a live nonce must match the signed expiry, chain, token and wallet exactly", async () => {
  const s = isolated();
  s.seed();
  assert.equal((await s.applySignedEdit(s.request({ expiresAt: EXPIRES_AT + 1 }))).status, 401);
  s.state.nonces.get("a".repeat(32))!.wallet = "0x" + "99".repeat(20);
  assert.equal((await s.applySignedEdit(s.request())).status, 401);
  assert.equal(s.rpc.length, 0);
});

test("a non-creator is refused before the nonce table or the RPC is touched", async () => {
  const s = isolated();
  s.seed();
  const r = await s.applySignedEdit(s.request({ wallet: "0x" + "99".repeat(20) }));
  assert.deepEqual(r, { ok: false, error: "not the creator", status: 403 });
  assert.ok(s.calls.every((c) => !/bb_edit_nonces/.test(c.sql)));
  assert.equal(s.rpc.length, 0);
});

test("only a proven signer with a live nonce can hit the wallet limit", async () => {
  const s = isolated();
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(await s.applySignedEdit(s.request({ nonce: s.seed(i.toString(16).padStart(32, "0")) })), { ok: true });
  }
  const eleventh = s.seed("e".repeat(32));
  assert.equal((await s.applySignedEdit(s.request({ nonce: eleventh }))).status, 429);
  assert.equal(s.state.nonces.get(eleventh)?.used_at, null, "a rate-limited edit keeps its nonce for the retry");
});

test("nonces are issued to the creator without a wallet-keyed limit and never to anyone else", async () => {
  const s = isolated();
  for (let i = 0; i < 11; i++) {
    const n = await s.issueNonce(CHAIN, TOKEN, WALLET.toUpperCase().replace("0X", "0x"));
    assert.ok(n && editAuth.isNonce(n.nonce) && n.expiresAt > Date.now());
    assert.deepEqual(s.state.nonces.get(n.nonce), { chain_id: 8453, token: TOKEN, wallet: WALLET, expires_at: new Date(n.expiresAt).toISOString(), used_at: null });
  }
  assert.equal(await s.issueNonce(CHAIN, TOKEN, "0x" + "99".repeat(20)), null);
  assert.equal(await s.issueNonce(CHAIN, "0x" + "22".repeat(20), WALLET), null);
});

test("the routes keep their IP limits and no longer spend a bucket keyed on an unproven wallet", () => {
  for (const route of [editRoute, nonceRoute]) {
    assert.match(route, /rateLimited\(`(edit|nonce):ip:\$\{ip\}`, \d+\)/);
    assert.doesNotMatch(route, /:wallet:/);
  }
  const order = ["FROM bb_launches", "SELECT nonce FROM bb_edit_nonces", "verifyMessage(", "rateLimited(`edit:wallet:", "db.begin(", "UPDATE bb_edit_nonces SET used_at", "INSERT INTO bb_launch_meta"].map((needle) => source.indexOf(needle));
  assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), "creator check, live-nonce check, signature, wallet limit, then consume and write in one transaction");
});
