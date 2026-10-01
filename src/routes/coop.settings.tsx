import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DemoDataControl } from "@/components/stawi/DemoDataControl";
import { FxSourceCard } from "@/components/stawi/FxSourceCard";
import { InstallAppButton } from "@/components/stawi/InstallAppButton";
import { PageHeader } from "@/features/shared/DashboardShell";
import { api } from "@/lib/api";
import { maskDestination } from "@/lib/format";
import { accountOptions, coopOptions, smsLogsOptions } from "@/lib/queries";
import { useAccountId, useCoopId } from "@/lib/session";
import { DEFAULT_SMS_SETTINGS, type Coop, type CoopSmsSettings, type SmsLogEntry, type SmsPurpose, type SmsToggleKey } from "@/lib/types";

export const Route = createFileRoute("/coop/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Stawi co-op" },
      { name: "description", content: "Co-op details, SMS switches, and SMS usage." },
      { property: "og:title", content: "Settings — Stawi co-op" },
      { property: "og:description", content: "Turn each co-op text on or off, and review what was sent." },
    ],
  }),
  component: Settings,
});

const SMS_ROWS: { key: SmsToggleKey; label: string; detail: string }[] = [
  { key: "invite", label: "Farmer invite links", detail: "Text a farmer their join link when you import the roster." },
  { key: "invite_summary", label: "Invite blast summary", detail: "One text after a blast, with how many invite links went out." },
  { key: "share_landed", label: "Share in Stawi balance", detail: "Tell a farmer their share is in their Stawi balance." },
  { key: "payout_sent", label: "Payout sent", detail: "Tell them money reached M-Pesa, Airtel Money, or their bank." },
  { key: "payout_failed", label: "Payout failed", detail: "Tell them a payout did not go through and the money stayed in Stawi." },
];

const PURPOSE_LABEL: Record<SmsPurpose, string> = {
  otp: "Login code",
  invite: "Invite link",
  invite_summary: "Invite summary",
  share_landed: "Share in balance",
  payout_sent: "Payout sent",
  payout_failed: "Payout failed",
  payment_received: "Payment received",
};

function Settings() {
  const accountId = useAccountId();
  const coopId = useCoopId();
  const coop = useQuery(coopOptions(coopId));
  const logs = useQuery(smsLogsOptions(coopId));
  const me = useQuery(accountOptions(accountId));
  const settings = { ...DEFAULT_SMS_SETTINGS, ...coop.data?.sms_settings };
  const queryClient = useQueryClient();
  const saveSms = useMutation({
    mutationFn: (patch: Partial<CoopSmsSettings>) => api.updateSmsSettings(coopId, patch),
    onSuccess: (next) => {
      queryClient.setQueryData<Coop>(["coop", coopId], (current) => (current ? { ...current, sms_settings: next } : current));
      toast.success("SMS setting saved");
    },
    onError: () => toast.error("Could not save that SMS setting"),
  });

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <DemoDataControl accountId={accountId} />
        <FxSourceCard />
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-medium">App</h2>
          <p className="mt-1 text-sm text-muted-foreground">Add the Stawi shortcut to this phone&apos;s home screen.</p>
          <InstallAppButton className="mt-4" />
        </section>
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="font-medium">Co-op</h2>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input defaultValue={coop.data?.name ?? ""} key={coop.data?.name} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label>Treasurer</Label>
            <Input value={me.data?.full_name ?? ""} readOnly className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label>Co-op bank account</Label>
            <Input value={me.data?.payout_destinations[0] ? maskDestination(me.data.payout_destinations[0].details) : ""} readOnly className="h-11 tabular" />
          </div>
          <Button className="h-11" onClick={() => toast.success("Settings saved")}>Save changes</Button>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-medium">SMS</h2>
          <p className="mt-1 text-sm text-muted-foreground">Each kind of text has its own switch. Login codes always send.</p>
          <div className="mt-4 flex items-start justify-between gap-4 border-b border-border py-3">
            <div>
              <p className="text-sm font-medium">Login codes</p>
              <p className="text-sm text-muted-foreground">Always sent so people can sign in. This cannot be turned off.</p>
            </div>
            <Switch checked disabled aria-label="Login codes always send" />
          </div>
          {SMS_ROWS.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-0">
              <div>
                <p className="text-sm font-medium">{row.label}</p>
                <p className="text-sm text-muted-foreground">{row.detail}</p>
              </div>
              <Switch
                checked={settings[row.key]}
                disabled={coop.isLoading || saveSms.isPending}
                aria-label={row.label}
                onCheckedChange={(checked) => saveSms.mutate({ [row.key]: checked })}
              />
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-medium">SMS usage</h2>
          <p className="mt-1 text-sm text-muted-foreground">Recent texts for this co-op. Login codes are stored without the code. A dry run means Africa&apos;s Talking was not called.</p>
          <SmsLogTable logs={logs.data} loading={logs.isLoading} error={logs.isError} />
        </section>
      </div>
    </div>
  );
}

function SmsLogTable({ logs, loading, error }: { logs: SmsLogEntry[] | undefined; loading: boolean; error: boolean }) {
  if (loading) return <p className="mt-4 text-sm text-muted-foreground">Loading texts…</p>;
  if (error) return <p className="mt-4 text-sm text-destructive">Could not load SMS usage.</p>;
  if (!logs || logs.length === 0) {
    return <p className="mt-4 text-sm text-muted-foreground">No texts yet. Invite links, share notices, and payout texts show up here.</p>;
  }
  return (
    <Table className="mt-4">
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Purpose</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Message</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">{formatWhen(row.created_at)}</TableCell>
            <TableCell>{PURPOSE_LABEL[row.purpose]}</TableCell>
            <TableCell className="tabular whitespace-nowrap">{row.phone_number}</TableCell>
            <TableCell>{statusLabel(row)}</TableCell>
            <TableCell className="max-w-xs truncate" title={row.message}>{row.message}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function statusLabel(row: SmsLogEntry): string {
  if (row.status === "skipped") return "Skipped";
  if (row.status === "failed") return "Failed";
  return row.dry_run ? "Dry run" : "Sent";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
