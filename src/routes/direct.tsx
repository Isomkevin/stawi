import { createFileRoute, Outlet } from "@tanstack/react-router";
import { FileText, Landmark, LayoutDashboard, Package, Settings } from "lucide-react";
import { RoleGate } from "@/components/stawi/RoleGate";
import { DashboardShell } from "@/features/shared/DashboardShell";
import { noindexMeta } from "@/lib/site";

export const Route = createFileRoute("/direct")({
  head: () => ({
    meta: [
      { title: "Exporter dashboard — Stawi" },
      { name: "description", content: "Invoice overseas buyers and get paid in KES the same day." },
      { property: "og:title", content: "Exporter dashboard — Stawi" },
      { property: "og:description", content: "Invoice overseas buyers and get paid in KES the same day." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      noindexMeta,
    ],
  }),
  component: DirectLayout,
});

function DirectLayout() {
  return (
    <RoleGate role="exporter">
      <DashboardShell
        title="Wanjiru Crafts"
        subtitle="Direct exporter"
        nav={[
          { to: "/direct/overview", label: "Overview", icon: LayoutDashboard },
          { to: "/direct/invoices", label: "Invoices", icon: FileText },
          { to: "/direct/shipments", label: "Shipments", icon: Package },
          { to: "/direct/payments", label: "Buyer payments", icon: Landmark },
          { to: "/direct/settings", label: "Settings", icon: Settings },
        ]}
      >
        <Outlet />
      </DashboardShell>
    </RoleGate>
  );
}
