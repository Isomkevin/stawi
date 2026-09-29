import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { InvoiceTable } from "@/features/shared/InvoiceTable";
import { NewInvoiceSheet } from "@/features/shared/NewInvoiceSheet";
import { PageHeader } from "@/features/shared/DashboardShell";
import { invoicesOptions } from "@/lib/queries";
import { useAccountId } from "@/lib/session";
import { EXPORTER_ID } from "@/lib/mock";

export const Route = createFileRoute("/direct/invoices/")({
  head: () => ({
    meta: [
      { title: "Invoices — Stawi exporter" },
      { name: "description", content: "All your buyer invoices and their status." },
      { property: "og:title", content: "Invoices — Stawi exporter" },
      { property: "og:description", content: "All your buyer invoices and their status." },
    ],
  }),
  component: DirectInvoices,
});

function DirectInvoices() {
  const accountId = useAccountId(EXPORTER_ID);
  const qc = useQueryClient();
  const invoices = useQuery(invoicesOptions({ account_id: accountId }));
  return (
    <div>
      <PageHeader title="Invoices" action={<NewInvoiceSheet type="direct" accountId={accountId} />} />
      <InvoiceTable
        invoices={invoices.data}
        loading={invoices.isLoading}
        detailTo="/direct/invoices/$id"
        onDelete={async (inv) => {
          try {
            await api.deleteInvoice(inv.id);
            toast.success(`Invoice ${inv.reference} deleted`);
            await qc.invalidateQueries({ queryKey: ["invoices"] });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't delete the invoice.");
          }
        }}
      />
    </div>
  );
}
