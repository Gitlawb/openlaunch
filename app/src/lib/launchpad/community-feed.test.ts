import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { communityFingerprint, filterCommunityPosts, reconcileCommunityWindow } from "./community-feed.ts";

const posts = [
  { id: 1, chain: "base", token: "0xAbC", wallet: "0xWallet", symbol: "SKY", name: "Clear Sky", body: "A real conversation", tag: "creator", created_at: "2026-09-07T00:00:00Z" },
  { id: 2, chain: "robinhood", token: "0xAbC", wallet: "0xAnother", symbol: "MOON", name: "Moon", body: "Something different", tag: null, created_at: "2026-09-07T00:00:01Z" },
];
test("community filters stay chain-scoped and search loaded content without mutating posts", () => {
  assert.deepEqual(filterCommunityPosts(posts, "base", "  sky "), [posts[0]]);
  assert.deepEqual(filterCommunityPosts(posts, null, "0xabc"), posts);
  assert.deepEqual(filterCommunityPosts(posts, "robinhood", "conversation"), []);
  assert.deepEqual(filterCommunityPosts(posts, null, "wallet"), [posts[0]]);
  assert.deepEqual(filterCommunityPosts(posts, null, " "), posts);
  assert.equal(posts.length, 2);
});
test("community refresh compares the shared 30-post window while retaining full server results", () => {
  const rows = Array.from({ length: 100 }, (_, id) => ({ ...posts[0], id }));
  assert.equal(communityFingerprint(rows), communityFingerprint(rows.slice(0, 30)));
  assert.notEqual(communityFingerprint(posts), communityFingerprint(posts.slice(1)));
  assert.notEqual(communityFingerprint(posts), communityFingerprint([{ ...posts[0], body: "Changed" }, posts[1]]));
  assert.notEqual(communityFingerprint(posts), communityFingerprint([{ ...posts[0], name: "Renamed token" }, posts[1]]));
});
test("feed additions wait while reading, while authoritative edits and removals apply immediately", () => {
  const added = { ...posts[0], id: 3, body: "A new post" };
  const edited = { ...posts[0], body: "Edited by the server" };
  const result = reconcileCommunityWindow({ visible: posts, pending: [] }, [added, edited], true);
  assert.deepEqual(result.visible, [edited]);
  assert.deepEqual(result.pending, [added]);
  assert.equal(posts[0].body, "A real conversation", "previous rows are not mutated");
});
test("the queue reflects the latest server window, not stale additions", () => {
  const first = { ...posts[0], id: 3, body: "Pending" };
  const next = { ...posts[0], id: 4, body: "More recent" };
  const queued = reconcileCommunityWindow({ visible: posts, pending: [] }, [first, ...posts], true);
  const updated = reconcileCommunityWindow(queued, [next, { ...first, body: "Pending, edited" }, ...posts], true);
  assert.deepEqual(updated.pending.map((post) => post.body), ["More recent", "Pending, edited"]);
  const moderated = reconcileCommunityWindow(updated, [next, ...posts], true);
  assert.deepEqual(moderated.pending, [next], "moderated queued posts disappear without being revealed");
  const revealed = reconcileCommunityWindow(moderated, [next, ...posts], false);
  assert.deepEqual(revealed, { visible: [next, ...posts], pending: [] });
});
test("buffered and visible rows together preserve the authoritative 100-row window", () => {
  const initial = Array.from({ length: 100 }, (_, index) => ({ ...posts[0], id: 100 - index }));
  const latest = [{ ...posts[0], id: 101 }, ...initial.slice(0, 99)];
  const buffered = reconcileCommunityWindow({ visible: initial, pending: [] }, latest, true);
  assert.equal(buffered.visible.length, 99);
  assert.equal(buffered.pending.length, 1);
  assert.equal(buffered.visible.at(-1)?.id, 2, "rows outside the server window are not kept indefinitely");
  assert.ok(buffered.visible.some((post) => post.id === 25), "older rows outside the 30-row live signal stay loaded");
  const repeated = reconcileCommunityWindow(buffered, latest, true);
  assert.deepEqual(repeated, buffered, "identical polls do not accumulate duplicates");
  assert.equal(reconcileCommunityWindow(repeated, [...latest, initial[99]], false).visible.length, 100);
});
test("hidden rows and duplicated IDs never enter either feed window", () => {
  const hidden = { ...posts[0], id: 3, hidden: true };
  const result = reconcileCommunityWindow({ visible: posts, pending: [] }, [hidden, posts[0], posts[0]], true);
  assert.deepEqual(result, { visible: [posts[0]], pending: [] });
  assert.deepEqual(reconcileCommunityWindow(result, [], true), { visible: [], pending: [] });
});
test("visible and queued counts use the same chain and search filters", () => {
  const next = { ...posts[1], id: 3 };
  const buffered = reconcileCommunityWindow({ visible: posts, pending: [] }, [next, ...posts], true);
  assert.equal(filterCommunityPosts(buffered.pending, "base", "").length, 0);
  assert.equal(filterCommunityPosts(buffered.pending, "robinhood", " moon ").length, 1);
  assert.equal(filterCommunityPosts(buffered.visible, "robinhood", " moon ").length, 1);
});
test("reader-at-top updates publish the current server rows without a queue", () => {
  const next = { ...posts[1], id: 3 };
  const result = reconcileCommunityWindow({ visible: posts, pending: [] }, [next, ...posts], false);
  assert.deepEqual(result, { visible: [next, ...posts], pending: [] });
});
test("community remains read-only with token-thread links and shared refresh signals", () => {
  const source = readFileSync(new URL("../../components/sections/CommunityFeed.tsx", import.meta.url), "utf8");
  assert.match(source, /subscribe\(\(snap\)/);
  assert.match(source, /router\.refresh\(\)/);
  assert.match(source, /nowMs\(\) - fullWindowRefresh\.current < 60_000/);
  assert.match(source, /#comments/);
  assert.match(source, /Search covers only the recent posts loaded here/);
  assert.match(source, /aria-label="Search recent posts"/);
  assert.doesNotMatch(source, /signMessage|writeContract|dangerouslySetInnerHTML|setInterval/);
});
test("new-post UI anchors server updates, preserves filters, and animates only explicit reveals", () => {
  const source = readFileSync(new URL("../../components/sections/CommunityFeed.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../components/sections/CommunityFeed.module.css", import.meta.url), "utf8");
  assert.match(source, /if \(!loadError && initial !== feed\.source\)/, "load errors are not authoritative removals");
  assert.match(source, /readingDown \|\| feed\.pending\.length > 0/, "a queued batch waits for consent even if the reader scrolls up");
  assert.match(source, /getSnapshotBeforeUpdate/);
  assert.match(source, /!this\.props\.preservePosition/, "the page does not scroll on an automatic update while still at the top");
  assert.match(source, /previous\.filterKey !== this\.props\.filterKey/, "manual filters do not trigger scroll restoration");
  assert.match(source, /row\.getBoundingClientRect\(\)\.top - anchor\.top/);
  assert.match(source, /behavior: "instant"/, "scroll correction must not animate");
  assert.match(source, /setTimeout\(\(\) => setEntering\(\[\]\), 250\)/, "entry state expires even with reduced motion");
  assert.match(css, /\.newPostsSlot[^}]*height: 0/, "the notification reserves no extra document height");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.postEntering \{ animation: none;/);
  const subscription = source.slice(source.indexOf("subscribe((snap)"), source.indexOf("const shown ="));
  assert.doesNotMatch(subscription, /reconcileCommunityWindow|setEntering/, "the short poll is only a refresh signal and cannot replay entry motion");
});
