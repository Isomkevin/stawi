import { Invoice, Transaction } from "../types";

/** Issued only after a collection has completed. Pending and failed invoices have no receipt. */
export type PaymentReceipt = {
  receipt_number: string;
  invoice_id: string;
  invoice_reference: string;
  paid_at: string;
  payee_name: string;
  buyer_name: string;
  buyer_email: string;
  description: string;
  amount: number;
  currency: string;
  fx_rate: number | null;
  gross_kes_cents: number | null;
  fee_kes_cents: number | null;
  net_kes_cents: number | null;
  payaza_reference: string | null;
  status: Invoice["status"];
};

export function paymentReceipt(
  invoice: Invoice,
  transactions: Transaction[],
  payeeName: string
): PaymentReceipt | null {
  if (invoice.status === "pending" || invoice.status === "failed") return null;
  const collection = transactions.find((tx) => tx.type === "collection" && tx.status === "completed");
  if (!collection) return null;

  const fee = invoice.fee_kes_cents;
  const net = invoice.kes_total_cents;
  const gross = fee != null && net != null ? fee + net : null;

  return {
    receipt_number: `RCP-${invoice.reference}`,
    invoice_id: invoice.id,
    invoice_reference: invoice.reference,
    paid_at: collection.created_at,
    payee_name: payeeName,
    buyer_name: invoice.buyer_name,
    buyer_email: invoice.buyer_email,
    description: invoice.description,
    amount: collection.amount,
    currency: collection.currency,
    fx_rate: invoice.fx_rate,
    gross_kes_cents: gross,
    fee_kes_cents: fee,
    net_kes_cents: net,
    payaza_reference: collection.payaza_reference,
    status: invoice.status,
  };
}
