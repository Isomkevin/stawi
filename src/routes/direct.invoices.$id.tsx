import { createFileRoute } from "@tanstack/react-router";
import { InvoiceDetailView } from "@/features/shared/InvoiceDetailView";

export const Route = createFileRoute("/direct/invoices/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Invoice ${params.id.toUpperCase()} — Stawi exporter` },
      { name: "description", content: "Payment timeline for this invoice." },
      { property: "og:title", content: `Invoice ${params.id.toUpperCase()} — Stawi exporter` },
      { property: "og:description", content: "Payment timeline for this invoice." },
    ],
  }),
  component: DirectInvoiceDetail,
});

function DirectInvoiceDetail() {
  const { id } = Route.useParams();
  return <InvoiceDetailView invoiceId={id} backTo="/direct/invoices" />;
}
