import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Download, FileText, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { DemoBadge } from "@/components/stawi/DemoDataControl";
import { EmptyState } from "@/components/stawi/EmptyState";
import { StatusChip } from "@/components/stawi/StatusChip";
import { ConfirmDelete } from "@/components/stawi/ConfirmDelete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { downloadPaidInvoicesCsv, downloadPaymentReceiptPdf, isPaidInvoice } from "@/lib/documents";
import { formatCurrency, formatDate, formatKesCents } from "@/lib/format";
import type { Invoice } from "@/lib/types";
import { cn } from "@/lib/utils";

const filters = ["all", "pending", "paid", "settling", "completed", "failed"] as const;

export function InvoiceTable({
  invoices,
  loading,
  detailTo,
  compact,
  onDelete,
}: {
  invoices: Invoice[] | undefined;
  loading: boolean;
  detailTo: "/coop/invoices/$id" | "/direct/invoices/$id";
  compact?: boolean;
  onDelete?: (invoice: Invoice) => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const [f, setF] = useState<(typeof filters)[number]>("all");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const paid = useMemo(() => (invoices ?? []).filter((i) => isPaidInvoice(i.status)), [invoices]);
  const rows = useMemo(
    () =>
      (invoices ?? [])
        .filter((i) => f === "all" || i.status === f || (f === "paid" && i.status === "converting"))
        .filter((i) => !q || `${i.buyer_name} ${i.reference}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [invoices, f, q],
  );

  const downloadReceipt = async (invoice: Invoice) => {
    setDownloadingId(invoice.id);
    try {
      const receipt = await api.getPaymentReceipt(invoice.id);
      await downloadPaymentReceiptPdf(receipt);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't download that receipt");
    } finally {
      setDownloadingId(null);
    }
  };

  const exportPaid = async () => {
    setExporting(true);
    try {
      const settled = await Promise.allSettled(paid.map((invoice) => api.getPaymentReceipt(invoice.id)));
      const receipts = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      if (!receipts.length) {
        toast.error("Couldn't load those receipts");
        return;
      }
      downloadPaidInvoicesCsv(receipts);
      const missed = settled.length - receipts.length;
      if (missed > 0) toast.error(`${missed} paid invoice${missed === 1 ? "" : "s"} had no receipt and were left out`);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't export paid invoices");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search buyer or reference" className="h-10 pl-9" />
          </div>
          <div className="flex flex-wrap gap-1">
            {filters.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setF(x)}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-xs capitalize",
                  f === x ? "border-lime bg-lime/15 text-lime" : "border-border text-muted-foreground",
                )}
              >
                {x}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={paid.length === 0 || exporting}
            onClick={() => void exportPaid()}
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Export paid invoices
          </Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={FileText} title="No invoices here" description="Create an invoice to send your buyer a payment link." className="border-0" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-normal">Reference</th>
                <th className="px-4 py-3 font-normal">Buyer</th>
                <th className="px-4 py-3 text-right font-normal">Amount</th>
                <th className="hidden px-4 py-3 text-right font-normal sm:table-cell">KES</th>
                <th className="px-4 py-3 font-normal">Status</th>
                <th className="hidden px-4 py-3 font-normal md:table-cell">Created</th>
                <th className="w-12 px-2 py-3"><span className="sr-only">Receipt</span></th>
                {onDelete && <th className="w-12 px-2 py-3"><span className="sr-only">Delete</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr
                  key={i.id}
                  tabIndex={0}
                  onClick={() => void navigate({ to: detailTo, params: { id: i.id } })}
                  onKeyDown={(e) => e.key === "Enter" && void navigate({ to: detailTo, params: { id: i.id } })}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/50 focus:bg-secondary/50 focus:outline-none"
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 tabular">
                      {i.reference}
                      <DemoBadge demo={i.is_demo} />
                    </span>
                  </td>
                  <td className="px-4 py-3">{i.buyer_name}</td>
                  <td className="px-4 py-3 text-right tabular">{formatCurrency(i.amount, i.currency)}</td>
                  <td className="hidden px-4 py-3 text-right text-muted-foreground tabular sm:table-cell">
                    {i.kes_total_cents ? formatKesCents(i.kes_total_cents) : "—"}
                  </td>
                  <td className="px-4 py-3"><StatusChip status={i.status} /></td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{formatDate(i.created_at)}</td>
                  <td className="px-2 py-2 text-right">
                    {isPaidInvoice(i.status) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Download receipt RCP-${i.reference}`}
                        disabled={downloadingId === i.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void downloadReceipt(i);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {downloadingId === i.id ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                      </Button>
                    )}
                  </td>
                  {onDelete && (
                    <td className="px-2 py-2 text-right">
                      <ConfirmDelete
                        label={`Delete invoice ${i.reference}`}
                        title={`Delete invoice ${i.reference}?`}
                        description={`The payment link for ${i.buyer_name} will stop working. This can't be undone.`}
                        disabledReason={i.status === "pending" ? undefined : "Paid invoices can't be deleted"}
                        onConfirm={() => onDelete(i)}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
