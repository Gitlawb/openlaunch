import { test } from "node:test";
import assert from "node:assert/strict";
import { TOKEN_POSTS_DEFAULT_LIMIT, TOKEN_POSTS_MAX_LIMIT, nextPostsCursor, parseTokenPostsPaging, postsCursorKey } from "./posts-paging.ts";

test("parseTokenPostsPaging defaults, clamps and reads the cursor", () => {
  assert.deepEqual(parseTokenPostsPaging({}), { limit: TOKEN_POSTS_DEFAULT_LIMIT, beforeId: null });
  assert.deepEqual(parseTokenPostsPaging({ limit: null }), { limit: TOKEN_POSTS_DEFAULT_LIMIT, beforeId: null }, "absent query param (URLSearchParams.get → null) uses the default, not 1");
  assert.deepEqual(parseTokenPostsPaging({ limit: "" }), { limit: TOKEN_POSTS_DEFAULT_LIMIT, beforeId: null });
  assert.deepEqual(parseTokenPostsPaging({ limit: undefined }), { limit: TOKEN_POSTS_DEFAULT_LIMIT, beforeId: null });
  assert.deepEqual(parseTokenPostsPaging({ limit: "20", before: "42" }), { limit: 20, beforeId: 42 });
  assert.deepEqual(parseTokenPostsPaging({ limit: 0, before: 0 }), { limit: 1, beforeId: null });
  assert.deepEqual(parseTokenPostsPaging({ limit: 9999 }), { limit: TOKEN_POSTS_MAX_LIMIT, beforeId: null });
  assert.deepEqual(parseTokenPostsPaging({ limit: "abc", before: "xyz" }), { limit: TOKEN_POSTS_DEFAULT_LIMIT, beforeId: null });
  assert.deepEqual(parseTokenPostsPaging({ limit: 25.9 }), { limit: 25, beforeId: null }, "truncates");
  assert.deepEqual(parseTokenPostsPaging({ before: "" }), { limit: TOKEN_POSTS_DEFAULT_LIMIT, beforeId: null });
  assert.equal(TOKEN_POSTS_DEFAULT_LIMIT, 100, "default preserves the previous response (100 posts, not 50) so existing clients lose nothing");
  assert.equal(TOKEN_POSTS_MAX_LIMIT, 100);
});

test("cursor key namespaces chain/token/limit/cursor", () => {
  assert.equal(postsCursorKey("base", "0xABC", 50, null), "posts:base:0xabc:50:head");
  assert.equal(postsCursorKey("base", "0xabc", 20, 42), "posts:base:0xabc:20:42");
  assert.notEqual(postsCursorKey("base", "0xabc", 20, 42), postsCursorKey("base", "0xabc", 20, 43));
});

test("nextPostsCursor ends pagination on a short page", () => {
  assert.equal(nextPostsCursor([9, 8, 7], 3), 7, "full page → oldest id is the next cursor");
  assert.equal(nextPostsCursor([9, 8], 3), null, "short page → done");
  assert.equal(nextPostsCursor([], 3), null);
});

test("default page preserves existing discussions until the client follows cursors (PR #32)", () => {
  // Maintainer repro: 75 top-level comments must not truncate, and 1 parent +
  // 50 replies (51 rows) must arrive together so the UI never sees a
  // replies-only page with "No comments yet."
  assert.ok(TOKEN_POSTS_DEFAULT_LIMIT >= 75, "75 previously visible comments stay visible");
  assert.ok(TOKEN_POSTS_DEFAULT_LIMIT >= 51, "1 parent + 50 replies arrive on the first page");
  assert.equal(nextPostsCursor(Array.from({ length: 75 }, (_, i) => 75 - i), TOKEN_POSTS_DEFAULT_LIMIT), null);
});
