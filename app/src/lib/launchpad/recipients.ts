import { getAddress, isAddress, type Address } from "viem";
import { BPS, DEAD, MAX_RECIPIENTS } from "./config";

/**
 * Beneficiary split editor logic, kept pure so the form stays thin and the rules are unit-tested.
 *
 * Creators type percentages; the locker stores basis points (uint16, 10_000 = 100%). Two decimals of a percent is
 * exactly one bp, so "33.33" ⇒ 3333 and anything finer is rejected rather than rounded: the on-chain split must be the
 * one the creator saw. The list must sum to exactly 100% (the locker reverts BadRecipients otherwise) with 1–7 rows.
 * A row whose address is 0x…dEaD is a burn share: the locker sends it to the dead address at collect time.
 */
export type RecipientRow = { payout: string; pct: string };
export type Recipient = { payout: Address; bps: number };

export type SplitResult = {
  recipients: Recipient[];
  /** Blocking messages in form-error style ("Beneficiary 2: …"). Empty ⇒ `recipients` is valid for the factory. */
  errors: string[];
  /** 10_000 minus the parsed shares (negative when over). Rows that fail to parse count as 0. */
  remainingBps: number;
};

const DEAD_LC = DEAD.toLowerCase();
const ZERO = "0x0000000000000000000000000000000000000000";

export const emptyRow = (): RecipientRow => ({ payout: "", pct: "" });

export function isBurnAddress(addr: string): boolean {
  return addr.trim().toLowerCase() === DEAD_LC;
}

/** "33.33" ⇒ 3333, "100" ⇒ 10000, "5." ⇒ 500. Null for blank, non-numeric, negative, >100 or more than 2 decimals. */
export function pctToBps(pct: string): number | null {
  const s = pct.trim();
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = (m[2] ?? "").padEnd(2, "0");
  const bps = whole * 100 + Number(frac);
  if (bps > BPS) return null;
  return bps;
}

/** 3333 ⇒ "33.33", 5000 ⇒ "50", 1050 ⇒ "10.5". */
export function bpsToPct(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** Parses the editor rows into factory recipients. Never throws; every problem is a message the form can list. */
export function buildRecipients(rows: RecipientRow[]): SplitResult {
  const errors: string[] = [];
  const recipients: Recipient[] = [];
  const seen = new Map<string, number>();
  let total = 0;

  if (rows.length === 0) errors.push("Beneficiaries: add at least one address, or choose Burn it.");
  if (rows.length > MAX_RECIPIENTS) errors.push(`Beneficiaries: at most ${MAX_RECIPIENTS} addresses.`);

  rows.forEach((row, i) => {
    const n = i + 1;
    const raw = row.payout.trim();
    let payout: Address | null = null;
    if (!isAddress(raw)) errors.push(`Beneficiary ${n}: enter a valid address.`);
    else if (raw.toLowerCase() === ZERO) errors.push(`Beneficiary ${n}: the zero address cannot receive fees. Use 0x…dEaD to burn a share.`);
    else {
      payout = getAddress(raw);
      const lc = payout.toLowerCase();
      const first = seen.get(lc);
      if (first !== undefined) errors.push(`Beneficiary ${n}: same address as beneficiary ${first}. Give it one row with the combined share.`);
      else seen.set(lc, n);
    }

    const bps = pctToBps(row.pct);
    if (bps === null) errors.push(`Beneficiary ${n}: share must be a percentage between 0.01 and 100, with at most two decimals.`);
    else if (bps === 0) errors.push(`Beneficiary ${n}: share must be at least 0.01%.`);
    else total += bps;

    if (payout && bps) recipients.push({ payout, bps });
  });

  const remainingBps = BPS - total;
  if (rows.length > 0 && remainingBps !== 0) {
    errors.push(remainingBps > 0 ? `Beneficiaries: shares add up to ${bpsToPct(total)}%. ${bpsToPct(remainingBps)}% left to assign.` : `Beneficiaries: shares add up to ${bpsToPct(total)}%. Remove ${bpsToPct(-remainingBps)}%.`);
  }

  return { recipients: errors.length === 0 ? recipients : [], errors, remainingBps };
}

/** Short human line for the summary: "60% to 0x12…34, 40% burned". */
export function describeShares(recipients: Recipient[], short: (a: string) => string): string {
  return recipients.map((r) => `${bpsToPct(r.bps)}% ${isBurnAddress(r.payout) ? "burned" : `to ${short(r.payout)}`}`).join(", ");
}
