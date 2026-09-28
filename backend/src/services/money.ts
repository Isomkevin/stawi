import { SplitLine } from "../types";

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
