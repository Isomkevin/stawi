import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/direct/")({
  beforeLoad: () => {
    throw redirect({ to: "/direct/overview" });
  },
});
