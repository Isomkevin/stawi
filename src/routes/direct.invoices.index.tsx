import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
  const invoices = useQuery(invoicesOptions({ account_id: accountId }));
  return (
    <div>
      <PageHeader title="Invoices" action={<NewInvoiceSheet type="direct" accountId={accountId} />} />
      <InvoiceTable invoices={invoices.data} loading={invoices.isLoading} detailTo="/direct/invoices/$id" />
    </div>
  );
}
