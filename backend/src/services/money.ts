import type { SplitLine } from "../types.js";

/** Convert a buyer-currency amount to KES cents at the given rate. */
export function toKesCents(amount: number, fxRate: number): number {
  return Math.round(amount * fxRate * 100);
}

export function feeCents(grossKesCents: number, rate: number): number {
  return Math.round(grossKesCents * rate);
}

/**
 * Split `netCents` across members by share (percent). Largest-remainder method so the
 * lines sum EXACTLY to netCents. Shares must sum to 100 (tolerance 0.001).
 */
export function splitByShares(
  netCents: number,
  members: { account_id: string; share: number }[],
  grossCents = netCents,
  totalFeeCents = 0,
): SplitLine[] {
  const total = members.reduce((s, m) => s + m.share, 0);
  if (Math.abs(total - 100) > 0.001) throw new Error(`Shares sum to ${total}, expected 100`);

  const alloc = (amount: number) => {
    const raw = members.map((m) => (amount * m.share) / 100);
    const floors = raw.map(Math.floor);
    let remainder = amount - floors.reduce((a, b) => a + b, 0);
    const order = raw.map((r, i) => ({ i, frac: r - floors[i] })).sort((a, b) => b.frac - a.frac);
    for (const { i } of order) { if (remainder <= 0) break; floors[i] += 1; remainder -= 1; }
    return floors;
  };

  const gross = alloc(grossCents);
  const fees = alloc(totalFeeCents);
  const net = alloc(netCents);
  return members.map((m, i) => ({
    account_id: m.account_id, share: m.share,
    gross_kes_cents: gross[i], fee_kes_cents: fees[i], net_kes_cents: net[i],
  }));
}
