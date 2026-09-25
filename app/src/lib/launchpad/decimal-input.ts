/**
 * Decimal amount field sanitizer (pure; unit-tested).
 *
 * Trade and launch amount inputs previously used
 * `value.replace(/[^0-9.]/g, "")`, which silently corrupts pasted values:
 * "1e-7" becomes "17" (the exponent letters are stripped and the digits
 * join), so parseUnits succeeds on a value ~1e8x the intended size with no
 * error shown.
 *
 * The rule: never guess. Anything whose meaning is ambiguous returns "" (the
 * caller then rejects it) instead of being rewritten into a different, valid
 * amount:
 *   - scientific notation: an "e" after a digit or dot that does not start a
 *     word, spaces and grouping ignored ("1e-7", "2.5E3", "1.e5", "1 e-7",
 *     "1e"); a unit ("0.5 ETH", "1.5eth") is not one;
 *   - more than one dot ("1.000.000" is a million in de-DE, 1 if the extra
 *     dots were dropped: a $1 launch cap);
 *   - a comma that is not a thousands separator, i.e. not followed by exactly
 *     three digits ("0,05" is 0.05 in many locales, 5 if the comma were
 *     stripped: 100x). "12,000" and "1,234.5" still read as grouping.
 * Otherwise grouping commas, currency and whitespace are stripped. Callers
 * stay controlled inputs; an empty result disables the submit path (amount
 * parses to null) instead of trading a wrong size.
 */
export function sanitizeDecimalInput(raw: string): string {
  if (/[\d.][eE](?![a-zA-Z])/.test(raw.replace(/[\s,_]/g, ""))) return "";
  if ((raw.match(/\./g) ?? []).length > 1) return "";
  if (/,(?!\d{3}(?!\d))/.test(raw)) return "";
  return raw.replace(/[^0-9.]/g, "");
}

/**
 * Custom market-cap field state transition (pure; unit-tested).
 *
 * The launch form falls back to the selected preset whenever the custom field
 * is empty (`customMcap.trim() ? Number(customMcap) : pickedPreset`). Without
 * this, typing a value that sanitizes to empty (e.g. "1e-7" with a preset
 * active) leaves the old preset selected: the field shows empty while the
 * launch proceeds at the preset cap. Returns the sanitized value plus whether
 * the caller must clear the preset pick.
 */
export function resolveCustomMcapInput(raw: string): { value: string; clearPick: boolean } {
  const value = sanitizeDecimalInput(raw);
  return { value, clearPick: raw.trim() !== "" && value === "" };
}

/**
 * First-buy field state transition (pure; unit-tested). A rejected entry
 * (e.g. "1e-7") is ignored, so the field keeps the amount it showed and the
 * launch buys exactly that; it must never read as "no first buy", which would
 * launch with no buy at all. Only clearing the field declines.
 */
export function resolveFirstBuyInput(raw: string): { kind: "choose"; value: string } | { kind: "decline" } | { kind: "ignore" } {
  const value = sanitizeDecimalInput(raw);
  if (value) return { kind: "choose", value };
  return raw.trim() === "" ? { kind: "decline" } : { kind: "ignore" };
}
