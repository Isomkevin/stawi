import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import { downloadPaymentReceiptPdf } from "@/lib/documents";
import { formatCurrency, formatDate, formatKesCents } from "@/lib/format";
import { Button } from "@/components/ui/button";

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
        <Button type="button" variant="outline" size="sm" onClick={() => void downloadPaymentReceiptPdf(data)}>
          <Download className="size-4" strokeWidth={2} />
          Download PDF
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
