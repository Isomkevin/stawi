import { createFileRoute } from "@tanstack/react-router";
import { InvoiceDetailView } from "@/features/shared/InvoiceDetailView";

export const Route = createFileRoute("/coop/invoices/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Invoice ${params.id.toUpperCase()} — Stawi co-op` },
      { name: "description", content: "Payment timeline and farmer split for this invoice." },
      { property: "og:title", content: `Invoice ${params.id.toUpperCase()} — Stawi co-op` },
      { property: "og:description", content: "Payment timeline and farmer split for this invoice." },
    ],
  }),
  component: () => <InvoiceDetailView invoiceId={Route.useParams().id} backTo="/coop/invoices" />,
});
