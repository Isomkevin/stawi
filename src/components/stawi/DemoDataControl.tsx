import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { demoSettingsOptions } from "@/lib/queries";
import { api } from "@/lib/api";

export function DemoBadge({ demo }: { demo?: boolean }) {
  if (!demo) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-amber/40 bg-amber/15 px-2 py-0.5 text-[11px] font-medium tracking-wide text-amber uppercase">
      Demo
    </span>
  );
}

export function DemoDataControl({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const settings = useQuery(demoSettingsOptions(accountId));
  const save = useMutation({
    mutationFn: (enabled: boolean) => api.updateDemoSettings(accountId, enabled),
    onSuccess: async (next) => {
      await qc.invalidateQueries();
      toast.success(next.demo_data_visible ? "Demo data is on" : "Demo data is off");
    },
    onError: () => toast.error("Couldn't save demo data. Try again."),
  });

  const visible = settings.data?.demo_data_visible ?? false;
  const effect =
    settings.data?.effect ??
    "Shows sample records, labelled Demo, alongside live transactions. It does not switch Payaza mode, block live payments, or mark new invoices as sample. Turning it off hides sample records and keeps them stored.";

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">Demo data</h2>
          <p className="mt-1 text-sm font-medium">{settings.isLoading ? "…" : visible ? "ON" : "OFF"}</p>
        </div>
        <Switch
          checked={visible}
          disabled={settings.isLoading || save.isPending || settings.isError}
          onCheckedChange={(checked) => save.mutate(checked)}
          aria-label="Demo data"
        />
      </div>
      <p className="text-sm text-muted-foreground">{effect}</p>
      {settings.isError && (
        <p className="text-sm text-terracotta">Demo data settings are not available from this server yet.</p>
      )}
    </section>
  );
}
