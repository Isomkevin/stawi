import { createFileRoute, Outlet } from "@tanstack/react-router";
import { FileBarChart, FileText, Landmark, LayoutDashboard, MessageCircleQuestion, Settings, Ship, Users, Wallet } from "lucide-react";
import { RoleGate } from "@/components/stawi/RoleGate";
import { DashboardShell } from "@/features/shared/DashboardShell";

export const Route = createFileRoute("/coop")({
  head: () => ({
    meta: [
      { title: "Co-op dashboard — Stawi" },
      { name: "description", content: "Invoice buyers, approve splits and pay every farmer same day." },
      { property: "og:title", content: "Co-op dashboard — Stawi" },
      { property: "og:description", content: "Invoice buyers, approve splits and pay every farmer same day." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CoopLayout,
});

function CoopLayout() {
  return (
    <RoleGate role="treasurer">
      <DashboardShell
        title="Kiambu Highlands Coffee Co-op"
        subtitle="Treasurer"
        nav={[
          { to: "/coop/overview", label: "Overview", icon: LayoutDashboard },
          { to: "/coop/shipments", label: "Shipments", icon: Ship },
          { to: "/coop/invoices", label: "Invoices", icon: FileText },
          { to: "/coop/members", label: "Members", icon: Users },
          { to: "/coop/payments", label: "Buyer payments", icon: Landmark },
          { to: "/coop/payouts", label: "Payouts", icon: Wallet },
          { to: "/coop/reports", label: "Reports & tax", icon: FileBarChart },
          { to: "/coop/assistant", label: "Ask Stawi", icon: MessageCircleQuestion },
          { to: "/coop/settings", label: "Settings", icon: Settings },
        ]}
      >
        <Outlet />
      </DashboardShell>
    </RoleGate>
  );
}
