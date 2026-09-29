import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/coop/assistant")({
  head: () => ({
    meta: [
      { title: "Ask Stawi — co-op finance assistant" },
      { name: "description", content: "Ask plain-language questions about invoices, farmer balances and payouts." },
      { property: "og:title", content: "Ask Stawi — co-op finance assistant" },
      { property: "og:description", content: "Ask plain-language questions about invoices, farmer balances and payouts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/coop/overview" });
  },
});
