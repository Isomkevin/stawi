import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, Landmark, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/stawi/EmptyState";
import { PageHeader } from "@/features/shared/DashboardShell";
import { buyerPortal, buyerPortalShareText } from "@/lib/buyerPortal";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { accountShipmentsOptions, coopShipmentsOptions } from "@/lib/queries";

const tone: Record<string, string> = {
  submitted: "bg-secondary text-foreground",
  confirmed: "bg-sage/20 text-sage",
  rejected: "bg-destructive/15 text-destructive",
};

/** Buyer bank-transfer proofs for a co-op (coopId) or a direct exporter (accountId). */
export function PaymentProofsPanel({ coopId, accountId }: { coopId?: string; accountId?: string }) {
  const qc = useQueryClient();
  const links = useQuery(coopId ? coopShipmentsOptions(coopId) : accountShipmentsOptions(accountId!));
  const key = ["payment-proofs", coopId ?? accountId];
  const proofs = useQuery({
    queryKey: key,
    queryFn: () => (coopId ? buyerPortal.listCoop(coopId) : buyerPortal.listAccount(accountId!)),
    refetchInterval: 10000,
  });
  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "confirm" | "reject" }) => buyerPortal.review(id, action),
    onSuccess: (_d, v) => {
      toast.success(v.action === "confirm" ? "Payment confirmed. The invoice is now paid." : "Transfer marked as not received.");
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["coop"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const openReceipt = async (id: string) => {
    try {
      const r = await buyerPortal.receipt(id);
      if (!r.receipt_data) {
        toast.error("No receipt attached");
        return;
      }
      const w = window.open();
      if (w) w.document.write(`<title>${(r.receipt_name ?? "Receipt").replace(/[<>&"]/g, "")}</title><iframe src="${r.receipt_data}" style="border:0;width:100%;height:100vh"></iframe>`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const portalLinks = (links.data ?? []).filter((s) => s.buyer_code);

  return (
    <div>
      <PageHeader
        title="Buyer payments"
        description="Bank transfers buyers reported in the buyer portal. Confirm once the money is in your account; the invoice then becomes paid and the split can be approved."
      />
      <section className="mb-6 rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">Portal links</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each shipment has its own link. Opening it shows that shipment in the buyer portal.
          </p>
        </div>
        {links.isLoading ? (
          <Skeleton className="m-4 h-16 rounded-xl" />
        ) : links.isError ? (
          <p className="p-4 text-sm text-destructive">Couldn't load portal links. {(links.error as Error).message}</p>
        ) : portalLinks.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Create a shipment to get a buyer portal link.</p>
        ) : (
          <ul className="divide-y divide-border">
            {portalLinks.map((s) => {
              const share = buyerPortalShareText(s.buyer_code!);
              const url = share.replace(/^Pay or report a transfer: /, "");
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{s.reference} · {s.buyer_name}</p>
                    <p className="truncate text-sm text-muted-foreground">{url}</p>
                    {!s.invoice_id && <p className="text-xs text-muted-foreground">Add an invoice before the buyer can pay from this link.</p>}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10"
                    onClick={() => {
                      void navigator.clipboard.writeText(share);
                      toast.success("Buyer portal link copied");
                    }}
                  >
                    <Copy className="size-4" /> Copy portal link
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {proofs.isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : proofs.isError ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-sm text-destructive">Couldn't load buyer payments. {(proofs.error as Error).message}</p>
      ) : !proofs.data?.length ? (
        <EmptyState icon={Landmark} title="No transfers reported yet" description="Share the buyer portal link and code with your buyers." />
      ) : (
        <ul className="space-y-3">
          {proofs.data.map((p) => (
            <li key={p.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{p.payer_name} · {formatCurrency(p.amount, p.currency)}</p>
                  <p className="text-sm text-muted-foreground">
                    Shipment {p.shipment_reference} · Bank ref {p.bank_reference} · Sent {formatDate(p.paid_at)}
                  </p>
                  {p.note && <p className="mt-1 text-sm">"{p.note}"</p>}
                  <p className="mt-1 text-xs text-muted-foreground">Reported {formatDateTime(p.created_at)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${tone[p.status]}`}>{p.status === "submitted" ? "To check" : p.status}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {p.has_receipt && (
                  <Button size="sm" variant="outline" onClick={() => void openReceipt(p.id)}><Eye className="size-4" /> Receipt</Button>
                )}
                {p.status === "submitted" && (
                  <>
                    <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: p.id, action: "confirm" })}>
                      <Check className="size-4" /> Money received
                    </Button>
                    <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ id: p.id, action: "reject" })}>
                      <X className="size-4" /> Not received
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
