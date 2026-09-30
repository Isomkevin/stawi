import { FEE_RATE, fxFor } from "@/lib/mock";
import type { Shipment } from "@/lib/shipments";
import type { Invoice, Payout } from "@/lib/types";

export type Attention = { text: string; tone: "pending" | "danger"; kind: "approve" | "invoice" | "late" | "payout" | "draft" | "awaiting" };

export function assignedKilos(s: { farmers: Array<{ kilos: number }> }) {
  return s.farmers.reduce((sum, farmer) => sum + farmer.kilos, 0);
}

/**
 * Integer percents of the shipment quantity. Unassigned kilos keep the rest,
 * so a half-filled lot does not display as 100%. A full lot sums to 100.
 * Same largest-remainder method as backend percentsOfQuantity.
 */
export function demandPercents(farmers: Array<{ account_id: string; kilos: number }>, quantityKg: number): Map<string, number> {
  const parts = farmers.map((farmer) => farmer.kilos);
  const percents = percentsOfQuantity(parts, quantityKg);
  return new Map(farmers.map((farmer, index) => [farmer.account_id, percents[index] ?? 0]));
}

function percentsOfQuantity(parts: number[], quantity: number): number[] {
  if (parts.length === 0 || quantity <= 0) return parts.map(() => 0);
  const safe = parts.map((n) => (Number.isFinite(n) && n > 0 ? n : 0));
  const assigned = safe.reduce((sum, n) => sum + n, 0);
  const open = Math.max(0, quantity - assigned);
  if (assigned + open <= 0) return parts.map(() => 0);
  const items = safe.map((share, index) => ({ index, share }));
  if (open > 0) items.push({ index: -1, share: open });
  const totalShare = items.reduce((sum, item) => sum + item.share, 0);
  const rows = items.map((item) => {
    const exact = (100 * item.share) / totalShare;
    const amt = Math.floor(exact);
    return { ...item, amt, remainder: exact - amt };
  });
  let left = 100 - rows.reduce((sum, row) => sum + row.amt, 0);
  [...rows]
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, Math.max(0, left))
    .forEach((row) => {
      row.amt += 1;
    });
  const byIndex = new Map(rows.map((row) => [row.index, row.amt]));
  return parts.map((_, index) => byIndex.get(index) ?? 0);
}

export function attentionFor(s: Shipment, inv: Invoice | undefined, payouts: Payout[]): Attention[] {
  const out: Attention[] = [];
  if (inv && inv.status === "paid" && !inv.split_approved) out.push({ text: "Buyer paid — approve farmer split", tone: "pending", kind: "approve" });
  if (inv && payouts.some((p) => p.invoice_id === inv.id && p.status === "failed")) out.push({ text: "A farmer payout failed", tone: "danger", kind: "payout" });
  if (s.status === "draft") {
    const assigned = assignedKilos(s);
    const left = s.quantity_kg - assigned;
    if (left > 0) out.push({ text: `Assign the remaining ${left.toLocaleString()} kg so this shipment is 100%`, tone: "pending", kind: "draft" });
    else if (left < 0) out.push({ text: "Farmer kilos are over this shipment", tone: "danger", kind: "draft" });
  }
  if (!inv && ["preparing", "ready", "in_transit"].includes(s.status)) out.push({ text: "No buyer invoice yet", tone: "pending", kind: "invoice" });
  if (["draft", "preparing", "ready"].includes(s.status) && new Date(s.ship_date).getTime() < Date.now())
    out.push({ text: "Ship date has passed", tone: "danger", kind: "late" });
  if (inv && inv.status === "pending" && s.status === "delivered") out.push({ text: "Delivered, buyer hasn't paid", tone: "pending", kind: "awaiting" });
  return out;
}

/** Estimated net KES cents per farmer, split by kilos with largest remainder so it sums exactly. */
export function farmerSplit(s: Shipment, inv: Invoice | undefined): Map<string, number> {
  const total = inv?.kes_total_cents ?? Math.round(s.value * fxFor(s.currency) * (1 - FEE_RATE) * 100);
  const kg = s.farmers.reduce((a, x) => a + x.kilos, 0);
  const res = new Map<string, number>();
  if (!kg) return res;
  const raw = s.farmers.map((x) => ({ id: x.account_id, exact: (total * x.kilos) / kg }));
  let left = total;
  raw.forEach((r) => {
    const v = Math.floor(r.exact);
    res.set(r.id, v);
    left -= v;
  });
  [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1)).slice(0, left).forEach((r) => res.set(r.id, (res.get(r.id) ?? 0) + 1));
  return res;
}

export function canClose(inv: Invoice | undefined) {
  return inv?.status === "completed";
}
