import { test } from "node:test";
import assert from "node:assert/strict";
import { FEED_DUST_USD, FEED_SWAP_PAGES, collectNonDust, isDustSwap } from "./feed-dust.ts";

const swap = (over: Partial<{ usd: number | null; quote_wei: string; quote_decimals: number }> = {}) => ({ kind: "swap" as const, usd: null, quote_wei: "0", quote_decimals: 18, ...over });

test("priced swaps: dust is anything under FEED_DUST_USD", () => {
  assert.equal(FEED_DUST_USD, 0.01);
  assert.equal(isDustSwap(swap({ usd: 0.0099, quote_wei: "4000000000000000", quote_decimals: 18 })), true, "a $0.0099 buy is dust however many wei it is");
  assert.equal(isDustSwap(swap({ usd: 0.01, quote_wei: "1", quote_decimals: 18 })), false, "exactly one cent stays");
  assert.equal(isDustSwap(swap({ usd: 15.65, quote_wei: "6525170685363478", quote_decimals: 18 })), false);
  assert.equal(isDustSwap(swap({ usd: 0, quote_wei: "0", quote_decimals: 6 })), true, "nothing moved: dust");
});

test("a price that reads 0 is treated as no price: a real trade in that quote stays in the feed", () => {
  // e.g. a GITLAWB price read of 0 during a pool hiccup: $0 × 2.79M GITLAWB must not drop the trade
  assert.equal(isDustSwap(swap({ usd: 0, quote_wei: "125573071944892711331197", quote_decimals: 18 })), false);
  assert.equal(isDustSwap(swap({ usd: -1, quote_wei: "18924421", quote_decimals: 6 })), false, "a negative price is nonsense, not a verdict");
  assert.equal(isDustSwap(swap({ usd: 0, quote_wei: "4999", quote_decimals: 6 })), true, "the display floor still applies without a price");
});

test("unpriced swaps fall back to the display floor: whatever would print as 0 is dust", () => {
  // USDG (6 dec): 4,999 raw = 0.004999 → "0" before the floor → dust; 5,000 raw → "0.01" → stays
  assert.equal(isDustSwap(swap({ usd: null, quote_wei: "4999", quote_decimals: 6 })), true);
  assert.equal(isDustSwap(swap({ usd: null, quote_wei: "5000", quote_decimals: 6 })), false);
  // 18-dec quotes (ETH, GITLAWB, Robinhood stocks): under 5 gwei is dust
  assert.equal(isDustSwap(swap({ usd: null, quote_wei: "4999999999", quote_decimals: 18 })), true);
  assert.equal(isDustSwap(swap({ usd: null, quote_wei: "5000000000", quote_decimals: 18 })), false);
  assert.equal(isDustSwap(swap({ usd: null, quote_wei: "1703", quote_decimals: 8 })), false, "0.00001703 MSTRc prints, so it stays");
  assert.equal(isDustSwap(swap({ usd: NaN, quote_wei: "1", quote_decimals: 18 })), true, "a broken price counts as no price");
});

type Row = { id: number; usd: number | null; quote_wei: string; quote_decimals: number };
const row = (id: number, usd: number): Row => ({ id, usd, quote_wei: "1", quote_decimals: 18 });
/** A live newest-first table; `fetchPage(after, size)` serves the rows older than `after` (keyset), counting the reads. */
function source(rows: Row[]) {
  const reads: [number | null, number][] = [];
  const fetchPage = async (after: Row | null, size: number) => {
    reads.push([after?.id ?? null, size]);
    const from = after === null ? 0 : rows.findIndex((r) => r.id === after.id) + 1;
    return rows.slice(from, from + size);
  };
  return { rows, fetchPage, reads };
}
const ids = (rows: Row[]) => rows.map((r) => r.id);
const keyOf = (r: Row) => String(r.id);

test("collectNonDust fills from the newest page and reads nothing more when it can", () => {
  const rows = Array.from({ length: 100 }, (_, i) => row(i, 5));
  const s = source(rows);
  return collectNonDust(s.fetchPage, 24, keyOf).then((out) => {
    assert.deepEqual(ids(out), ids(rows.slice(0, 24)), "newest first, in source order");
    assert.deepEqual(s.reads, [[null, 48]], "one page of 2×limit, from the top");
  });
});

test("regression: 30 dust swaps ahead of 24 real ones still yield 24 rows — the older real swaps are paged in", () => {
  const rows = [...Array.from({ length: 30 }, (_, i) => row(i, 0.0001)), ...Array.from({ length: 24 }, (_, i) => row(100 + i, 3))];
  const s = source(rows);
  return collectNonDust(s.fetchPage, 24, keyOf).then((out) => {
    assert.equal(out.length, 24);
    assert.deepEqual(ids(out), ids(rows.slice(30)), "every real swap, none of the dust, oldest real one included");
    assert.deepEqual(s.reads, [[null, 48], [117, 48]], "a second page was needed, read once, from the last row seen");
  });
});

test("collectNonDust stops at a short page: the source ran dry", () => {
  const rows = [row(1, 0.001), row(2, 9), row(3, 0.001)];
  const s = source(rows);
  return collectNonDust(s.fetchPage, 24, keyOf).then((out) => {
    assert.deepEqual(ids(out), [2]);
    assert.deepEqual(s.reads, [[null, 48]], "a page smaller than requested is the end");
  });
});

test("collectNonDust is a bounded read under a dust flood: FEED_SWAP_PAGES pages, then it gives up", () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => row(i, 0.0001));
  const s = source(rows);
  return collectNonDust(s.fetchPage, 24, keyOf).then((out) => {
    assert.deepEqual(out, []);
    assert.equal(s.reads.length, FEED_SWAP_PAGES);
    assert.equal(FEED_SWAP_PAGES, 4);
    assert.deepEqual(s.reads.at(-1), [3 * 48 - 1, 48], "each page continues from the last row of the one before");
  });
});

test("a swap indexed between two page reads is neither skipped nor served twice", () => {
  // 47 dust rows then one real: the first page ends with `real`; before the second read a new swap lands at the top
  const rows = [...Array.from({ length: 47 }, (_, i) => row(i, 0.0001)), row(500, 7), row(600, 8), row(700, 9)];
  const s = source(rows);
  const fetchPage = async (after: Row | null, size: number) => {
    const page = await s.fetchPage(after, size);
    if (after === null) s.rows.unshift(row(999, 11)); // the live table grows at the head after page 1
    return page;
  };
  return collectNonDust(fetchPage, 24, keyOf).then((out) => {
    assert.deepEqual(ids(out), [500, 600, 700], "keyset paging: page 2 starts right after 500, unaffected by the head insert");
    assert.deepEqual(s.reads, [[null, 48], [500, 48]]);
  });
});

test("collectNonDust still dedupes by key if a source ever repeats a row", () => {
  let reads = 0;
  const fetchPage = async () => (reads++ === 0 ? [...Array.from({ length: 47 }, (_, i) => row(i, 0.0001)), row(500, 7)] : [row(500, 7), row(600, 8)]);
  return collectNonDust(fetchPage, 24, keyOf).then((out) => assert.deepEqual(ids(out), [500, 600]));
});
