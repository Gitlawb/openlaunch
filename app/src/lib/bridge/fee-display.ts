/** Compact display only. Exact percentages remain in the warning disclosure. */
export function formatFeeWarningPercent(value: string): string {
  const absolute = value.replace(/^-/, "");
  const [whole, fraction = ""] = absolute.split(".");
  const rounded = Number(absolute).toLocaleString("en-US", { maximumFractionDigits: 2 });
  // Decimal-string comparison retains breaches too small for Number to represent.
  const aboveLimit = BigInt(whole) > 5n || (BigInt(whole) === 5n && /[1-9]/.test(fraction));
  return aboveLimit && rounded === "5" ? ">5" : rounded;
}
