/**
 * Decimal amount field sanitizer (pure; unit-tested).
 *
 * Trade and launch amount inputs previously used
 * `value.replace(/[^0-9.]/g, "")`, which silently corrupts pasted values:
 * "1e-7" becomes "17" (the exponent letters are stripped and the digits
 * join), so parseUnits succeeds on a value ~1e8x the intended size with no
 * error shown. "1..2" collapses only downstream when parseUnits throws.
 *
 * This helper rejects scientific notation outright (returns "") instead of
 * corrupting it, strips grouping/currency/whitespace characters, and keeps at
 * most one decimal point. Callers stay controlled inputs; an empty result
 * disables the submit path (amount parses to null) instead of trading a
 * wrong size.
 */
export function sanitizeDecimalInput(raw: string): string {
  if (/[eE]/.test(raw)) return "";
  let out = "";
  let dot = false;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (ch === "." && !dot) {
      dot = true;
      out += ch;
    }
  }
  return out;
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
