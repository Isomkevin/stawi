import { FEE_RATE, fxFor } from "@/lib/mock";
import type { Shipment } from "@/lib/shipments";
import type { Invoice, Payout } from "@/lib/types";

export type Attention = { text: string; tone: "pending" | "danger"; kind: "approve" | "invoice" | "late" | "payout" | "draft" | "awaiting" };

export function attentionFor(s: Shipment, inv: Invoice | undefined, payouts: Payout[]): Attention[] {
  const out: Attention[] = [];
  if (inv && inv.status === "paid" && !inv.split_approved) out.push({ text: "Buyer paid — approve farmer split", tone: "pending", kind: "approve" });
  if (inv && payouts.some((p) => p.invoice_id === inv.id && p.status === "failed")) out.push({ text: "A farmer payout failed", tone: "danger", kind: "payout" });
  if (s.status === "draft" && s.farmers.length === 0) out.push({ text: "Add farmers to this draft", tone: "pending", kind: "draft" });
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
