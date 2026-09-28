import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/coop/")({
  beforeLoad: () => {
    throw redirect({ to: "/coop/overview" });
  },
});
