import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMENTS_PAGE, clearDraft, draftKey, groupReplies, loadCommentDraft, loadDraft, resolveReplyTarget, saveDraft, visibleTopIds } from "./post-threads.ts";
import type { PostRow } from "./postsServer.ts";

const post = (id: number, parent_id: number | null): PostRow => ({ id, chain: "base", token: "0xtoken", wallet: "0xwallet", parent_id, body: `body ${id}`, tag: null, created_at: "2026-01-01T00:00:00.000Z", reports: 0, hidden: false });

test("groupReplies splits top-level from one-level replies, newest reply last", () => {
  const posts = [post(3, null), post(2, 3), post(1, 3), post(4, null)];
  const { top, repliesById } = groupReplies(posts);
  assert.deepEqual(top.map((p) => p.id), [3, 4]);
  assert.deepEqual(repliesById.get(3)!.map((p) => p.id), [1, 2], "server order (newest first) reverses to oldest-first under the comment");
  assert.equal(repliesById.get(4), undefined);
});

test("groupReplies on empty / replies-only input", () => {
  assert.deepEqual(groupReplies([]).top, []);
  const { top, repliesById } = groupReplies([post(9, 7)]);
  assert.deepEqual(top, []);
  assert.deepEqual(repliesById.get(7)!.map((p) => p.id), [9]);
});

test("visibleTopIds paginates the top level", () => {
  const top = [post(1, null), post(2, null), post(3, null)];
  assert.deepEqual(visibleTopIds(top, 2).map((p) => p.id), [1, 2]);
  assert.deepEqual(visibleTopIds(top, 99).map((p) => p.id), [1, 2, 3]);
  assert.deepEqual(visibleTopIds(top, 0), []);
  assert.equal(COMMENTS_PAGE, 20);
});

test("draft key is per token and lowercase; node loads empty and saves are no-ops", () => {
  assert.equal(draftKey("base", "0xABC"), "ol:comment-draft:base:0xabc");
  assert.notEqual(draftKey("base", "0xabc"), draftKey("robinhood", "0xabc"));
  assert.equal(loadDraft("base", "0xabc"), "");
  saveDraft("base", "0xabc", "hello");
  clearDraft("base", "0xabc");
  assert.equal(loadDraft("base", "0xabc"), "", "no localStorage in node: always empty, never throws");
});

function withMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

function withoutStorage(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.localStorage;
}

test("draft restores both a top-level draft and a reply draft (PR #31)", () => {
  const store = withMemoryStorage();
  try {
    saveDraft("base", "0xabc", "top-level hello");
    assert.deepEqual(loadCommentDraft("base", "0xabc"), { body: "top-level hello", parentId: null });
    assert.equal(loadDraft("base", "0xabc"), "top-level hello");

    saveDraft("base", "0xabc", "reply hello", 42);
    assert.deepEqual(loadCommentDraft("base", "0xabc"), { body: "reply hello", parentId: 42 });

    clearDraft("base", "0xabc");
    assert.deepEqual(loadCommentDraft("base", "0xabc"), { body: "", parentId: null });
    assert.equal(store.size, 0);
  } finally {
    withoutStorage();
  }
});

test("draft understands legacy plain-text drafts and rejects bad parent ids", () => {
  const store = withMemoryStorage();
  try {
    store.set(draftKey("base", "0xabc"), "legacy hello");
    assert.deepEqual(loadCommentDraft("base", "0xabc"), { body: "legacy hello", parentId: null });

    store.set(draftKey("base", "0xabc"), JSON.stringify({ body: "x", parentId: -7 }));
    assert.deepEqual(loadCommentDraft("base", "0xabc"), { body: "x", parentId: null });

    store.set(draftKey("base", "0xabc"), JSON.stringify({ body: "x", parentId: "42" }));
    assert.deepEqual(loadCommentDraft("base", "0xabc"), { body: "x", parentId: null });
  } finally {
    withoutStorage();
  }
});

test("resolveReplyTarget blocks before first load and falls back on empty/missing parents (PR #31)", () => {
  assert.deepEqual(resolveReplyTarget(null, [], false), { target: null, pending: false, missing: false }, "top-level never blocks");
  assert.deepEqual(resolveReplyTarget(null, [], true), { target: null, pending: false, missing: false });
  assert.deepEqual(resolveReplyTarget(42, [], false), { target: 42, pending: true, missing: false }, "restored reply is pending before validation, never signed");
  assert.deepEqual(resolveReplyTarget(42, [], true), { target: null, pending: false, missing: true }, "empty loaded list means the parent is gone → top-level");
  assert.deepEqual(resolveReplyTarget(42, [{ id: 42 }], true), { target: 42, pending: false, missing: false }, "present parent stays a reply");
  assert.deepEqual(resolveReplyTarget(42, [{ id: 7 }], true), { target: null, pending: false, missing: true }, "hidden/deleted parent falls back instead of 404ing");
});
