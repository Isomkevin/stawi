import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { InvoiceTable } from "@/features/shared/InvoiceTable";
import { NewInvoiceSheet } from "@/features/shared/NewInvoiceSheet";
import { PageHeader } from "@/features/shared/DashboardShell";
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
  const invoices = useQuery(invoicesOptions({ coop_id: coopId }));
  return (
    <div>
      <PageHeader title="Invoices" description="Send buyers a link. Money is split the moment they pay." action={<NewInvoiceSheet type="coop" coopId={coopId} />} />
      <InvoiceTable invoices={invoices.data} loading={invoices.isLoading} detailTo="/coop/invoices/$id" />
    </div>
  );
}
