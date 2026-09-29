import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { InvoiceTable } from "@/features/shared/InvoiceTable";
import { NewInvoiceSheet } from "@/features/shared/NewInvoiceSheet";
import { PageHeader } from "@/features/shared/DashboardShell";
import { api, ApiError } from "@/lib/api";
import { invoicesOptions } from "@/lib/queries";
import { useCoopId } from "@/lib/session";

export const Route = createFileRoute("/coop/invoices/")({
  head: () => ({
    meta: [
      { title: "Invoices — Stawi co-op" },
      { name: "description", content: "Every buyer invoice, its status and payment link." },
      { property: "og:title", content: "Invoices — Stawi co-op" },
      { property: "og:description", content: "Every buyer invoice, its status and payment link." },
    ],
  }),
  component: CoopInvoices,
});

function CoopInvoices() {
  const coopId = useCoopId();
  const qc = useQueryClient();
  const invoices = useQuery(invoicesOptions({ coop_id: coopId }));
  return (
    <div>
      <PageHeader title="Invoices" description="Send buyers a link. Money is split the moment they pay." action={<NewInvoiceSheet type="coop" coopId={coopId} />} />
      <InvoiceTable
        invoices={invoices.data}
        loading={invoices.isLoading}
        detailTo="/coop/invoices/$id"
        onDelete={async (inv) => {
          try {
            await api.deleteInvoice(inv.id);
            toast.success(`Invoice ${inv.reference} deleted`);
            await qc.invalidateQueries({ queryKey: ["invoices"] });
            void qc.invalidateQueries({ queryKey: ["coop", coopId] });
          } catch (e) {
            toast.error(e instanceof ApiError && e.status === 404 ? "The server can't delete invoices yet." : e instanceof Error ? e.message : "Couldn't delete the invoice.");
          }
        }}
      />
    </div>
  );
}
