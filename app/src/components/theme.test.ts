import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const colors = (source: string) => Object.fromEntries(Array.from(source.matchAll(/--color-([\w-]+):\s*(#[\da-f]{6});/gi), ([, name, hex]) => [name, hex]));
const light = colors(css.split("@media (prefers-color-scheme: dark)")[0]);
const dark = { ...light, ...colors(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]+)\}/)?.[1] ?? "") };

function luminance(hex: string) {
  assert.match(hex, /^#[\da-f]{6}$/i, "Every tested role needs an opaque color");
  const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

test("system dark preference supplies a distinct dark surface and inverse controls", () => {
  assert.notEqual(dark.paper, light.paper);
  assert.ok(luminance(dark.paper) < 0.01);
  assert.ok(luminance(dark["brand-fg"]) < luminance(dark.brand));
  assert.ok(luminance(light["brand-fg"]) > luminance(light.brand));
});

for (const [theme, palette] of Object.entries({ light, dark })) {
  test(`${theme} theme maintains AA contrast for text, status labels, and filled controls`, () => {
    const pairs = [
      ...["paper", "card", "subtle"].flatMap((surface) => ["ink", "body", "muted", "faint", "up", "down-ink", "warm-ink"].map((text) => [text, surface])),
      ["brand-fg", "brand"], ["brand-fg", "brand-strong"], ["brand", "brand-soft"],
      ["up", "up-soft"], ["down-ink", "down-soft"], ["warm-ink", "warm-soft"],
      ["status-fg", "up"], ["status-fg", "down"], ["status-fg", "warm"],
    ];
    for (const [foreground, background] of pairs) {
      const a = luminance(palette[foreground]);
      const b = luminance(palette[background]);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(ratio >= 4.5, `${theme}: ${foreground} on ${background} has ${ratio.toFixed(2)}:1 contrast`);
    }
  });
}
