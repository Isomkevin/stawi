import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DemoDataControl } from "@/components/stawi/DemoDataControl";
import { PageHeader } from "@/features/shared/DashboardShell";
import { accountOptions, coopOptions } from "@/lib/queries";
import { useAccountId, useCoopId } from "@/lib/session";
import { maskDestination } from "@/lib/format";

export const Route = createFileRoute("/coop/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Stawi co-op" },
      { name: "description", content: "Co-op details, treasurer account and notifications." },
      { property: "og:title", content: "Settings — Stawi co-op" },
      { property: "og:description", content: "Co-op details, treasurer account and notifications." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const accountId = useAccountId();
  const coop = useQuery(coopOptions(useCoopId()));
  const me = useQuery(accountOptions(accountId));
  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <DemoDataControl accountId={accountId} />
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="font-medium">Co-op</h2>
          <div className="space-y-1.5"><Label>Name</Label><Input defaultValue={coop.data?.name ?? ""} key={coop.data?.name} className="h-11" /></div>
          <div className="space-y-1.5"><Label>Treasurer</Label><Input value={me.data?.full_name ?? ""} readOnly className="h-11" /></div>
          <div className="space-y-1.5"><Label>Co-op bank account</Label><Input value={me.data?.payout_destinations[0] ? maskDestination(me.data.payout_destinations[0].details) : ""} readOnly className="h-11 tabular" /></div>
        </section>
        <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <h2 className="font-medium">Notifications</h2>
          {["Email me when a buyer pays", "SMS farmers when their share lands", "Alert me when a payout fails"].map((l) => (
            <label key={l} className="flex min-h-11 items-center justify-between text-sm">{l}<Switch defaultChecked /></label>
          ))}
        </section>
        <Button className="h-11" onClick={() => toast.success("Settings saved")}>Save changes</Button>
      </div>
    </div>
  );
}
