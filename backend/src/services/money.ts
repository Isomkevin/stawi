import { SplitLine } from "../types";

/**
 * Currencies Payaza documents for hosted checkout or collections.
 * USD, NGN, GHS: checkout and payment-page examples.
 * KES, UGX, TZS, ZAR, XOF, ZMW, LRD, CDF, XAF: mobile-money and local rails.
 * EUR and GBP: Stawi invoices are already charged in these.
 * Rates are KES per 1 unit. Payaza publishes no FX endpoint.
 * This table is the fallback when the Frankfurter cache has no quote for a code.
 */
export const PAY_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "NGN",
  "GHS",
  "KES",
  "UGX",
  "TZS",
  "ZAR",
  "XOF",
  "ZMW",
  "LRD",
  "CDF",
  "XAF",
] as const;

const WHOLE_UNIT = new Set(["KES", "UGX", "TZS", "XOF", "XAF", "CDF", "LRD"]);

const KES_PER_UNIT: Record<string, number> = {
  USD: 129,
  EUR: 142,
  GBP: 168,
  KES: 1,
  NGN: 0.083,
  GHS: 8.3,
  UGX: 0.035,
  TZS: 0.049,
  ZAR: 7.2,
  XOF: 0.215,
  XAF: 0.215,
  ZMW: 4.8,
  LRD: 0.68,
  CDF: 0.045,
};

export function isPayCurrency(code: string): boolean {
  return (PAY_CURRENCIES as readonly string[]).includes(code.toUpperCase());
}

/** Illustrative KES per 1 unit. Unknown codes use the USD rate, same as before. */
export function kesPerUnit(currency: string): number {
  return KES_PER_UNIT[currency.toUpperCase()] ?? 129;
}

type RateFn = (currency: string) => number;
let rateSource: RateFn = kesPerUnit;

/** Checkout and settlement read this. The FX service points it at the live cache. */
export function setKesRateSource(fn: RateFn): void {
  rateSource = fn;
}

/** Live KES per 1 unit when a quote is cached, otherwise the illustrative table. */
export function activeKesPerUnit(currency: string): number {
  return rateSource(currency);
}

/** Invoice amount restated in the currency the buyer chose, so Payaza charges the same shilling value. */
export function checkoutAmount(invoiceAmount: number, fromCurrency: string, toCurrency: string): number {
  const to = toCurrency.toUpperCase();
  const raw = (invoiceAmount * activeKesPerUnit(fromCurrency)) / activeKesPerUnit(to);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (WHOLE_UNIT.has(to)) return Math.round(raw);
  return Math.round(raw * 100) / 100;
}

/** Formats integer KES cents as `1,234.50`. The same text is used in SMS and USSD. */
export function formatKes(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/**
 * Converts a foreign or local currency amount into integer KES cents.
 * Rule: Money is always integer KES cents. Never floats.
 */
export function toKesCents(amount: number, currency: string, fxRate: number): number {
  if (currency.toUpperCase() === "KES") {
    return Math.round(amount * 100);
  }
  return Math.round(amount * fxRate * 100);
}

/**
 * Calculates Stawi's transparent platform fee in integer KES cents.
 * Default is 0.8% (0.008).
 */
export function feeCents(grossKesCents: number, feePercent: number = 0.8): number {
  return Math.round(grossKesCents * (feePercent / 100));
}

/**
 * Largest-remainder method (Hare-Niemeyer / Hamilton) to allocate an integer amount
 * across fractional shares so that the allocated amounts sum EXACTLY to totalMinor.
 */
export function allocate<T extends { share: number }>(
  totalMinor: number,
  items: T[]
): (T & { amt: number })[] {
  if (items.length === 0) return [];
  if (totalMinor === 0) {
    return items.map((item) => ({ ...item, amt: 0 }));
  }

  const totalShare = items.reduce((acc, curr) => acc + curr.share, 0);
  if (totalShare <= 0) {
    throw new Error("Total share must be greater than zero");
  }

  const rows = items.map((item, index) => {
    const normalizedShare = item.share / totalShare;
    const exact = totalMinor * normalizedShare;
    const amt = Math.floor(exact);
    return {
      item,
      index,
      exact,
      amt,
      remainder: exact - amt,
    };
  });

  const allocatedSum = rows.reduce((sum, r) => sum + r.amt, 0);
  let remainderToDistribute = totalMinor - allocatedSum;

  // Sort descending by remainder, breaking ties deterministically by index
  const sorted = [...rows].sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder - a.remainder;
    }
    return a.index - b.index;
  });

  for (let i = 0; i < remainderToDistribute; i++) {
    sorted[i % sorted.length].amt += 1;
  }

  // Restore original order
  rows.sort((a, b) => a.index - b.index);

  return rows.map((r) => ({
    ...r.item,
    amt: r.amt,
  }));
}

/**
 * Integer percents of `quantity` for each part.
 * Unassigned quantity keeps its own percent, so a half-filled lot does not look like 100%.
 * When the parts sum to `quantity`, the returned percents sum to 100.
 */
export function percentsOfQuantity(parts: number[], quantity: number): number[] {
  if (parts.length === 0 || quantity <= 0) return parts.map(() => 0);
  const safe = parts.map((n) => (Number.isFinite(n) && n > 0 ? n : 0));
  const assigned = safe.reduce((sum, n) => sum + n, 0);
  const open = Math.max(0, quantity - assigned);
  if (assigned + open <= 0) return parts.map(() => 0);
  const items = safe.map((share, index) => ({ index, share }));
  if (open > 0) items.push({ index: -1, share: open });
  const allocated = allocate(100, items);
  const byIndex = new Map(allocated.map((row) => [row.index, row.amt]));
  return parts.map((_, index) => byIndex.get(index) ?? 0);
}

/**
 * Splits gross and net KES cents among co-op members using largest-remainder.
 * Guarantees that:
 * 1. sum(line.gross_kes_cents) === grossKesCents
 * 2. sum(line.net_kes_cents) === netKesCents
 * 3. line.fee_kes_cents === line.gross_kes_cents - line.net_kes_cents
 * 4. sum(line.fee_kes_cents) === grossKesCents - netKesCents
 */
export function splitByShares(
  grossKesCents: number,
  feeKesCents: number,
  members: { account_id: string; contribution_share: number }[]
): SplitLine[] {
  if (members.length === 0) return [];

  const netKesCents = grossKesCents - feeKesCents;

  const grossAllocations = allocate(
    grossKesCents,
    members.map((m) => ({ account_id: m.account_id, share: m.contribution_share }))
  );

  const netAllocations = allocate(
    netKesCents,
    members.map((m) => ({ account_id: m.account_id, share: m.contribution_share }))
  );

  return members.map((m, idx) => {
    const gross = grossAllocations[idx].amt;
    const net = netAllocations[idx].amt;
    const fee = gross - net;

    return {
      account_id: m.account_id,
      share: m.contribution_share,
      gross_kes_cents: gross,
      fee_kes_cents: fee,
      net_kes_cents: net,
    };
  });
}

/**
 * Splits a co-op invoice across the farmers on its shipment.
 * Kilos are the weights. `share` is those kilos as an integer percent, and the percents sum to 100.
 */
export function splitByKilos(
  grossKesCents: number,
  feeKesCents: number,
  farmers: { account_id: string; kilos: number }[]
): SplitLine[] {
  const weighed = farmers.filter((farmer) => farmer.kilos > 0);
  if (weighed.length === 0) return [];

  const lines = splitByShares(
    grossKesCents,
    feeKesCents,
    weighed.map((farmer) => ({ account_id: farmer.account_id, contribution_share: farmer.kilos }))
  );
  const percents = allocate(
    100,
    weighed.map((farmer) => ({ account_id: farmer.account_id, share: farmer.kilos }))
  );

  return lines.map((line, index) => ({
    ...line,
    share: percents[index].amt,
  }));
}
