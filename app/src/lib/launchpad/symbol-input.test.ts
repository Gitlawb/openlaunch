import assert from "node:assert/strict";
import test from "node:test";
import { uppercaseInPlace } from "./symbol-input.ts";

function field(value: string, start: number | null = value.length, end: number | null = start) {
  const writes: string[] = [];
  const carets: [number, number][] = [];
  const el = {
    get value() { return value; },
    set value(next: string) { writes.push(next); value = next; },
    selectionStart: start,
    selectionEnd: end,
    setSelectionRange(a: number, b: number) { carets.push([a, b]); el.selectionStart = a; el.selectionEnd = b; },
  };
  return { el, writes, carets };
}

test("uppercaseInPlace writes the field before state and restores the caret and selection", () => {
  const typed = field("SxKY", 2);
  assert.equal(uppercaseInPlace(typed.el), "SXKY");
  assert.deepEqual(typed.writes, ["SXKY"]);
  assert.deepEqual(typed.carets, [[2, 2]]);

  const selection = field("sky", 1, 3);
  assert.equal(uppercaseInPlace(selection.el), "SKY");
  assert.deepEqual(selection.carets, [[1, 3]], "a selected range stays selected");
});

test("uppercaseInPlace leaves an already-uppercase field completely alone", () => {
  for (const value of ["", "SKY9", "中文", " AB "]) {
    const f = field(value, 1);
    assert.equal(uppercaseInPlace(f.el), value);
    assert.deepEqual(f.writes, [], "no DOM write, so no caret movement or extra input event");
    assert.deepEqual(f.carets, []);
  }
});

test("uppercaseInPlace skips caret offsets that a length change makes stale", () => {
  const sharp = field("ßa", 1);
  assert.equal(uppercaseInPlace(sharp.el), "SSA");
  assert.deepEqual(sharp.writes, ["SSA"]);
  assert.deepEqual(sharp.carets, []);

  const noSelection = field("sky", null);
  assert.equal(uppercaseInPlace(noSelection.el), "SKY");
  assert.deepEqual(noSelection.carets, [], "inputs without a selection API report null offsets");
});
