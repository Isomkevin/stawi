import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatKesCents } from "@/lib/format";
import type { PaymentReceipt } from "@/lib/types";
import { Button } from "@/components/ui/button";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printPaymentReceipt(receipt: PaymentReceipt) {
  const rows = [
    ["Receipt", receipt.receipt_number],
    ["Paid", formatDate(receipt.paid_at)],
    ["From", `${receipt.buyer_name} (${receipt.buyer_email})`],
    ["To", receipt.payee_name],
    ["For", receipt.description],
    ["Amount", formatCurrency(receipt.amount, receipt.currency)],
    ["Rate", receipt.fx_rate != null ? `1 ${receipt.currency} = KES ${receipt.fx_rate.toFixed(2)}` : "—"],
    ["Gross in shillings", receipt.gross_kes_cents != null ? formatKesCents(receipt.gross_kes_cents) : "—"],
    ["Stawi fee (0.8%)", receipt.fee_kes_cents != null ? formatKesCents(receipt.fee_kes_cents) : "—"],
    ["To the seller", receipt.net_kes_cents != null ? formatKesCents(receipt.net_kes_cents) : "—"],
    ["Payment reference", receipt.payaza_reference || receipt.invoice_reference],
  ];
  const body = rows
    .map(([label, value]) => `<tr><td>${escapeHtml(label ?? "")}</td><td>${escapeHtml(value ?? "")}</td></tr>`)
    .join("");
  const page = window.open("", "_blank", "noopener,noreferrer");
  if (!page) return;
  page.document.write(`<!doctype html><html><head><title>${escapeHtml(receipt.receipt_number)}</title>
    <style>body{font-family:Georgia,serif;padding:32px;color:#14221c}h1{font-size:22px}table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #ddd;vertical-align:top}td:first-child{color:#555;width:40%}</style>
    </head><body><h1>Stawi payment receipt</h1><table>${body}</table></body></html>`);
  page.document.close();
  page.focus();
  page.print();
}

export function PaymentReceiptCard({ invoiceId }: { invoiceId: string }) {
  const receipt = useQuery({
    queryKey: ["invoice-receipt", invoiceId],
    queryFn: () => api.getPaymentReceipt(invoiceId),
    retry: false,
  });
  if (!receipt.data) return null;
  const data = receipt.data;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Receipt</p>
          <h3 className="text-display text-lg">{data.receipt_number}</h3>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => printPaymentReceipt(data)}>
          <Printer className="size-4" strokeWidth={2} />
          Save
        </Button>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <Row label="Paid" value={formatDate(data.paid_at)} />
        <Row label="From" value={data.buyer_name} />
        <Row label="To" value={data.payee_name} />
        <Row label="Amount" value={formatCurrency(data.amount, data.currency)} />
        {data.fx_rate != null && (
          <Row label="Rate" value={`1 ${data.currency} = KES ${data.fx_rate.toFixed(2)}`} />
        )}
        {data.fee_kes_cents != null && <Row label="Fee (0.8%)" value={formatKesCents(data.fee_kes_cents)} />}
        {data.net_kes_cents != null && <Row label="To the seller" value={formatKesCents(data.net_kes_cents)} />}
        <Row label="Reference" value={data.payaza_reference || data.invoice_reference} />
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular">{value}</dd>
    </div>
  );
}
