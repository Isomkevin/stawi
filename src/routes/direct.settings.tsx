import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/features/shared/DashboardShell";
import { api } from "@/lib/api";
import { EXPORTER_ID } from "@/lib/mock";
import { accountSmsLogsOptions } from "@/lib/queries";
import { useAccountId } from "@/lib/session";
import { DEFAULT_EXPORTER_SMS_SETTINGS, type Account, type SmsLogEntry, type SmsPurpose } from "@/lib/types";

export const Route = createFileRoute("/direct/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Stawi exporter" },
      { name: "description", content: "Turn the exporter payment text on or off, and review SMS usage." },
      { property: "og:title", content: "Settings — Stawi exporter" },
      { property: "og:description", content: "The payment-received text belongs to the exporter." },
    ],
  }),
  component: ExporterSettings,
});

const PURPOSE_LABEL: Record<SmsPurpose, string> = {
  otp: "Login code",
  invite: "Invite link",
  invite_summary: "Invite summary",
  share_landed: "Share in balance",
  payout_sent: "Payout sent",
  payout_failed: "Payout failed",
  payment_received: "Payment received",
};

function ExporterSettings() {
  const accountId = useAccountId(EXPORTER_ID);
  const me = useQuery({ queryKey: ["account", accountId], queryFn: () => api.getAccount(accountId) });
  const logs = useQuery(accountSmsLogsOptions(accountId));
  const settings = { ...DEFAULT_EXPORTER_SMS_SETTINGS, ...me.data?.sms_settings };
  const queryClient = useQueryClient();
  const saveSms = useMutation({
    mutationFn: (paymentReceived: boolean) => api.updateExporterSmsSettings(accountId, { payment_received: paymentReceived }),
    onSuccess: (next) => {
      queryClient.setQueryData<Account>(["account", accountId], (current) => (current ? { ...current, sms_settings: next } : current));
      toast.success("SMS setting saved");
    },
    onError: () => toast.error("Could not save that SMS setting"),
  });

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-medium">SMS</h2>
          <p className="mt-1 text-sm text-muted-foreground">This text is for the exporter. Login codes always send.</p>
          <div className="mt-4 flex items-start justify-between gap-4 border-b border-border py-3">
            <div>
              <p className="text-sm font-medium">Login codes</p>
              <p className="text-sm text-muted-foreground">Always sent so you can sign in. This cannot be turned off.</p>
            </div>
            <Switch checked disabled aria-label="Login codes always send" />
          </div>
          <div className="flex items-start justify-between gap-4 py-3">
            <div>
              <p className="text-sm font-medium">Payment received</p>
              <p className="text-sm text-muted-foreground">Text you when a buyer payment lands in your Stawi balance.</p>
            </div>
            <Switch
              checked={settings.payment_received}
              disabled={me.isLoading || saveSms.isPending}
              aria-label="Payment received"
              onCheckedChange={(checked) => saveSms.mutate(checked)}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-medium">SMS usage</h2>
          <p className="mt-1 text-sm text-muted-foreground">Texts for this exporter. Login codes are stored without the code.</p>
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
    return <p className="mt-4 text-sm text-muted-foreground">No texts yet. Payment notices show up here.</p>;
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
