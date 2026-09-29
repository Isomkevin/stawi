import { createFileRoute } from "@tanstack/react-router";
import { PaymentProofsPanel } from "@/features/shared/PaymentProofsPanel";
import { useAccountId } from "@/lib/session";

export const Route = createFileRoute("/direct/payments")({
  head: () => ({
    meta: [
      { title: "Buyer payments — Stawi exporter" },
      { name: "description", content: "Check bank transfers your buyers reported and confirm them." },
      { property: "og:title", content: "Buyer payments — Stawi exporter" },
      { property: "og:description", content: "Confirm buyer bank transfers." },
    ],
  }),
  component: () => <PaymentProofsPanel accountId={useAccountId()} />,
});
