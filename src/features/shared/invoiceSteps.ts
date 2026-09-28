import type { TimelineStep } from "@/components/stawi/Timeline";
import type { Invoice, Transaction } from "@/lib/types";
import { formatDateTime, formatKesCents } from "@/lib/format";

const order = ["pending", "paid", "converting", "settling", "completed"] as const;

/** Builds the payment timeline shown on invoice detail screens. */
export function invoiceSteps(invoice: Invoice, txns: Transaction[]): TimelineStep[] {
  const at = (type: Transaction["type"]) => {
    const t = txns.find((x) => x.type === type);
    return t ? formatDateTime(t.created_at) : undefined;
  };
  const idx = invoice.status === "failed" ? -1 : order.indexOf(invoice.status);
  const state = (n: number): TimelineStep["state"] =>
    invoice.status === "failed" && n === 1 ? "failed" : idx >= n ? (idx === n && n < 4 ? "active" : "done") : "todo";

  const steps: TimelineStep[] = [
    { label: "Invoice sent", at: formatDateTime(invoice.created_at), state: "done" },
    {
      label: invoice.status === "failed" ? "Payment failed" : "Buyer paid",
      detail: invoice.payaza_checkout_reference ?? undefined,
      at: at("collection"),
      state: idx >= 1 ? "done" : state(1),
    },
    {
      label: "Converted to KES",
      detail: invoice.fx_rate ? `1 ${invoice.currency} = ${invoice.fx_rate} KES` : undefined,
      at: at("conversion"),
      state: idx >= 2 ? "done" : idx === 1 ? "active" : "todo",
    },
  ];
  if (invoice.type === "coop") {
    steps.push({
      label: invoice.split_approved ? "Split approved" : "Waiting for split approval",
      state: invoice.split_approved ? "done" : idx >= 1 ? "active" : "todo",
    });
  }
  steps.push({
    label: "Paid out to M-Pesa",
    detail: invoice.kes_total_cents ? formatKesCents(invoice.kes_total_cents) : undefined,
    at: at("payout"),
    state: invoice.status === "completed" ? "done" : invoice.status === "settling" ? "active" : "todo",
  });
  return steps.map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as TimelineStep);
}
