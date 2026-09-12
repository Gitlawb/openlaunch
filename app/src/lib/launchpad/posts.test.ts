import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModMessage, buildPostMessage, buildReportMessage, canPostNow, holderTag, isReportReason, shouldAutoHide, tsFresh, validateBody } from "./posts.ts";

test("validateBody: trims, strips control chars, caps length, rejects HTML tags and empties", () => {
  assert.deepEqual(validateBody("  gm  frens  "), { ok: true, body: "gm  frens" });
  const v = validateBody("a\n\n\n\n\nb");
  assert.equal(v.ok && v.body, "a\n\nb");
  const c = validateBody("hi\u0007there\u0000");
  assert.equal(c.ok && c.body, "hithere");
  assert.equal(validateBody("").ok, false);
  assert.equal(validateBody("   ").ok, false);
  assert.equal(validateBody("x".repeat(501)).ok, false);
  assert.equal(validateBody("<script>alert(1)</script>").ok, false);
  assert.equal(validateBody("<a href=x>hi</a>").ok, false);
  assert.equal(validateBody("1 < 2 and 3 > 2").ok, true, "math is fine");
  assert.equal(validateBody(42).ok, false);
});

test("post message binds chain, token, wallet, reply, nonce, time and body", () => {
  const m = buildPostMessage({ chain: "base", token: "0xAB", wallet: "0xCD", nonce: "n", ts: 0, parentId: 7, body: "hello" });
  for (const s of ["Chain: base", "Token: 0xab", "Wallet: 0xcd", "Reply to: 7", "Nonce: n", "Time: 1970-01-01T00:00:00.000Z", "\nhello"]) assert.ok(m.includes(s), s);
  assert.ok(buildPostMessage({ chain: "base", token: "0xAB", wallet: "0xCD", nonce: "n", ts: 0, parentId: null, body: "x" }).includes("Reply to: -"));
  assert.ok(buildReportMessage({ postId: 3, wallet: "0xCD", nonce: "n", ts: 0, reason: "scam" }).includes("Post: 3"));
  assert.ok(buildModMessage({ action: "hide", target: "post:3", wallet: "0xCD", nonce: "n", ts: 0 }).includes("Action: hide"));
});

test("validateBody preserves every code unit except the intended controls and CR normalization", () => {
  for (let unit = 0; unit <= 0xffff; unit++) {
    const character = String.fromCharCode(unit);
    const stripped = unit <= 0x08 || unit === 0x0b || unit === 0x0c
      || (unit >= 0x0e && unit <= 0x1f) || unit === 0x7f;
    const expected = stripped ? "" : unit === 0x0d ? "\n" : character;
    // Sentinels keep whitespace inside the body, independent of edge trimming.
    assert.deepEqual(validateBody(`a${character}z`), { ok: true, body: `a${expected}z` }, `code unit ${unit.toString(16)}`);
  }
});

test("validateBody retains text whitespace and Unicode while normalizing line endings", () => {
  assert.deepEqual(validateBody(" \tfirst\tsecond\r\nthird\rfourth\n\n\nfifth\t "), {
    ok: true,
    body: "first\tsecond\nthird\nfourth\n\nfifth",
  });
  const unicode = "தமிழ் café e\u0301 👩‍💻 🚀 — \u200b\u0085\u009f";
  assert.deepEqual(validateBody(unicode), { ok: true, body: unicode });
  assert.deepEqual(validateBody("a\u0000b\u0007c\u0008d\u000be\u000cf\u000eg\u001fh\u007f"), {
    ok: true,
    body: "abcdefgh",
  });
  assert.deepEqual(validateBody("\u0000\u0008\u000b\u000c\u000e\u001f\u007f"), { ok: false, error: "empty post" });
  assert.deepEqual(validateBody("x".repeat(500) + "\u0000\u001f\u007f"), { ok: true, body: "x".repeat(500) });
});

test("normalized post bodies retain their byte-exact signed message", () => {
  const result = validateBody(" \tgm\u0000\tfrens\r\nதமிழ் 🚀 — open\u007f ");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(buildPostMessage({ chain: "base", token: "0xAB", wallet: "0xCD", nonce: "n", ts: 0, parentId: 7, body: result.body }), [
    "openlaunch.lol \u2014 sign to post. Free, no transaction.",
    "",
    "Chain: base",
    "Token: 0xab",
    "Wallet: 0xcd",
    "Reply to: 7",
    "Nonce: n",
    "Time: 1970-01-01T00:00:00.000Z",
    "",
    "gm\tfrens\nதமிழ் 🚀 — open",
  ].join("\n"));
});

test("copy cleanup preserves byte-exact wallet signature headers and user text", () => {
  const body = "hello \u2014 world";
  const message = buildPostMessage({ chain: "base", token: "0xAB", wallet: "0xCD", nonce: "n", ts: 0, parentId: null, body });
  assert.equal(message.split("\n")[0], "openlaunch.lol \u2014 sign to post. Free, no transaction.");
  assert.ok(message.endsWith(body));
  assert.equal(buildReportMessage({ postId: 3, wallet: "0xCD", nonce: "n", ts: 0, reason: "scam" }).split("\n")[0], "openlaunch.lol \u2014 sign to report a post.");
  assert.equal(buildModMessage({ action: "hide", target: "post:3", wallet: "0xCD", nonce: "n", ts: 0 }).split("\n")[0], "openlaunch.lol \u2014 sign a moderation action.");
});

test("tsFresh within ±5 minutes", () => {
  const now = 1_000_000_000_000;
  assert.equal(tsFresh(now - 4 * 60_000, now), true);
  assert.equal(tsFresh(now + 4 * 60_000, now), true);
  assert.equal(tsFresh(now - 6 * 60_000, now), false);
  assert.equal(tsFresh("nope", now), false);
});

test("holderTag: creator > whale (≥1%) > holder > none", () => {
  const supply = 10n ** 27n;
  assert.equal(holderTag(true, 0n, supply), "creator");
  assert.equal(holderTag(false, 10n ** 25n, supply), "whale");
  assert.equal(holderTag(false, 10n ** 24n, supply), "holder");
  assert.equal(holderTag(false, 0n, supply), null);
});

test("canPostNow enforces the gap and the daily cap", () => {
  const now = 1_000_000;
  assert.equal(canPostNow(null, 0, now).ok, true);
  assert.equal(canPostNow(now - 5_000, 0, now).ok, false);
  assert.equal(canPostNow(now - 25_000, 0, now).ok, true);
  assert.equal(canPostNow(now - 25_000, 60, now).ok, false);
});

test("auto-hide at 5 distinct reports; report reasons", () => {
  assert.equal(shouldAutoHide(4), false);
  assert.equal(shouldAutoHide(5), true);
  assert.equal(isReportReason("scam"), true);
  assert.equal(isReportReason("lol"), false);
});
