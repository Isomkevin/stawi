import { createFileRoute } from "@tanstack/react-router";
import { PaymentProofsPanel } from "@/features/shared/PaymentProofsPanel";
import { useCoopId } from "@/lib/session";

export const Route = createFileRoute("/coop/payments")({
  head: () => ({
    meta: [
      { title: "Buyer payments — Stawi co-op" },
      { name: "description", content: "Check bank transfers buyers reported and confirm them before approving splits." },
      { property: "og:title", content: "Buyer payments — Stawi co-op" },
      { property: "og:description", content: "Confirm buyer bank transfers before approving splits." },
    ],
  }),
  component: () => <PaymentProofsPanel coopId={useCoopId()} />,
});
