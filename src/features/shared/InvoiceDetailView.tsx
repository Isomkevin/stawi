import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Download, ShieldCheck } from "lucide-react";
import { CopyLink } from "@/components/stawi/CopyLink";
import { DemoBadge } from "@/components/stawi/DemoDataControl";
import { PinPad } from "@/components/stawi/PinPad";
import { QrCode } from "@/components/stawi/QrCode";
import { StatusChip } from "@/components/stawi/StatusChip";
import { Timeline } from "@/components/stawi/Timeline";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditInvoiceSheet } from "./NewInvoiceSheet";
import { invoiceSteps } from "./invoiceSteps";
import { PaymentReceiptCard } from "./PaymentReceiptCard";
import { api, ApiError } from "@/lib/api";
import { downloadPayoutAdviceCsv, downloadPayoutAdvicePdf, type PayoutAdviceLine } from "@/lib/documents";
import { coopMembersOptions, coopPayoutsOptions, invoiceOptions } from "@/lib/queries";
import { accountName } from "@/lib/mock";
import { useAccountId } from "@/lib/session";
import { formatCurrency, formatDateTime, formatKesCents } from "@/lib/format";
import { cn } from "@/lib/utils";

export function InvoiceDetailView({ invoiceId, backTo }: { invoiceId: string; backTo: "/coop/invoices" | "/direct/invoices" }) {
  const qc = useQueryClient();
  const treasurerId = useAccountId();
  const detail = useQuery(invoiceOptions(invoiceId));
  const coopId = detail.data?.invoice.coop_id ?? "";
  const splitApproved = detail.data?.invoice.type === "coop" && detail.data.invoice.split_approved === true;
  const members = useQuery({ ...coopMembersOptions(coopId || "none"), enabled: Boolean(coopId) });
  const payouts = useQuery({ ...coopPayoutsOptions(coopId || "none"), enabled: Boolean(coopId) && splitApproved });
  const nameOf = (accountId: string) =>
    members.data?.find((member) => member.account_id === accountId)?.full_name ?? accountName(accountId);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);

  const approve = useMutation({
    mutationFn: (p: string) => api.approveSplit(invoiceId, treasurerId, p),
    onSuccess: () => {
      setPinOpen(false);
      toast.success("Split approved — farmers are being paid now");
      void qc.invalidateQueries();
    },
    onError: (e) => {
      setPin("");
      setPinErr(e instanceof ApiError && e.code === "wrong" ? "Wrong PIN. Try again." : "Couldn't approve. Try again.");
    },
  });

  if (detail.isLoading) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (!detail.data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-display text-xl">Invoice not found</p>
        <Link to={backTo} className="mt-4 inline-block text-sm text-lime">Back to invoices</Link>
      </div>
    );
  }

  const { invoice, transactions, split_preview } = detail.data;
  const advice: PayoutAdviceLine[] = (payouts.data ?? [])
    .filter((payout) => payout.invoice_id === invoice.id && payout.kind === "credit")
    .map((payout) => {
      const line = split_preview?.find((entry) => entry.account_id === payout.account_id);
      return {
        farmer: nameOf(payout.account_id),
        share: line?.share ?? 0,
        grossKesCents: line?.gross_kes_cents ?? payout.amount_kes_cents,
        feeKesCents: line?.fee_kes_cents ?? 0,
        netKesCents: line?.net_kes_cents ?? payout.amount_kes_cents,
        status: payout.status,
        date: payout.created_at.slice(0, 10),
      };
    });
  const total = (split_preview ?? []).reduce((s, l) => s + l.share, 0);
  const canApprove = invoice.type === "coop" && !invoice.split_approved && ["paid", "converting"].includes(invoice.status);
  const url = typeof window !== "undefined" ? `${window.location.origin}/pay/${invoice.id}` : `/pay/${invoice.id}`;

  return (
    <div className="space-y-6">
      <Link to={backTo} className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All invoices
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground tabular">
            {invoice.reference}
            <DemoBadge demo={invoice.is_demo} />
          </p>
          <h1 className="text-display text-3xl">{invoice.buyer_name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{invoice.description}</p>
        </div>
        <div className="flex items-start gap-3">
          <EditInvoiceSheet invoice={invoice} />
          <div className="text-right">
          <p className="text-display text-3xl tabular">{formatCurrency(invoice.amount, invoice.currency)}</p>
          {invoice.kes_total_cents != null && (
            <p className="text-sm text-lime tabular">{formatKesCents(invoice.kes_total_cents)} after fee</p>
          )}
          <StatusChip status={invoice.status} className="mt-2" />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {invoice.type === "coop" && split_preview && (
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-medium">Split between farmers</h2>
                <span className={cn("text-xs tabular", total === 100 ? "text-lime" : "text-terracotta")}>
                  Shares total {total}%
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-2 font-normal">Farmer</th>
                      <th className="py-2 text-right font-normal">Share</th>
                      <th className="py-2 text-right font-normal">Fee</th>
                      <th className="py-2 text-right font-normal">Receives</th>
                    </tr>
                  </thead>
                  <tbody>
                    {split_preview.map((l) => (
                      <tr key={l.account_id} className="border-b border-border last:border-0">
                        <td className="py-2">{nameOf(l.account_id)}</td>
                        <td className="py-2 text-right tabular">{l.share}%</td>
                        <td className="py-2 text-right text-muted-foreground tabular">{formatKesCents(l.fee_kes_cents)}</td>
                        <td className="py-2 text-right tabular">{formatKesCents(l.net_kes_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {total !== 100 && (
                <p className="mt-3 flex items-center gap-2 text-sm text-terracotta">
                  <AlertTriangle className="size-4" /> Shares must add up to 100% before you can approve.
                </p>
              )}
              {canApprove && (
                <Button className="mt-4 h-12 w-full" disabled={total !== 100} onClick={() => setPinOpen(true)}>
                  <ShieldCheck className="size-4" /> Approve & release to farmers
                </Button>
              )}
              {invoice.split_approved && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-lime">Approved — payouts released.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={advice.length === 0}
                      onClick={() => downloadPayoutAdviceCsv(invoice.reference, advice)}
                    >
                      <Download className="size-4" /> Download CSV
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={advice.length === 0}
                      onClick={() => void downloadPayoutAdvicePdf({ reference: invoice.reference, buyerName: invoice.buyer_name, lines: advice })}
                    >
                      <Download className="size-4" /> Download PDF
                    </Button>
                  </div>
                </div>
              )}
              {invoice.status === "pending" && (
                <p className="mt-4 text-sm text-muted-foreground">You can approve once the buyer has paid.</p>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-3 font-medium">Money movements</h2>
            {transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet — waiting for the buyer.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {transactions.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
                    <span className="capitalize">{t.type}</span>
                    <span className="text-muted-foreground tabular">{formatDateTime(t.created_at)}</span>
                    <span className="tabular">{formatCurrency(t.amount, t.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-4 font-medium">Payment timeline</h2>
            <Timeline steps={invoiceSteps(invoice, transactions)} />
          </section>
          {invoice.status === "pending" && (
            <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
              <h2 className="font-medium">Payment link</h2>
              <div className="flex justify-center"><QrCode value={url} /></div>
              <CopyLink url={url} subject={`Invoice ${invoice.reference}`} />
            </section>
          )}
          {invoice.status !== "pending" && invoice.status !== "failed" && (
            <PaymentReceiptCard invoiceId={invoice.id} />
          )}
        </aside>
      </div>

      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm with your PIN</DialogTitle>
            <DialogDescription>
              Releases {invoice.kes_total_cents ? formatKesCents(invoice.kes_total_cents) : ""} to {split_preview?.length ?? 0} farmers. Demo PIN: 1234
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <PinPad
              value={pin}
              error={pinErr}
              onChange={(v) => {
                setPinErr(null);
                setPin(v);
                if (v.length === 4) approve.mutate(v);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
