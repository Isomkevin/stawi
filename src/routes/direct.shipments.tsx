import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Loader2, Package, Search } from "lucide-react";
import { EmptyState } from "@/components/stawi/EmptyState";
import { StatusChip } from "@/components/stawi/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/features/shared/DashboardShell";
import { api, ApiError } from "@/lib/api";
import { accountShipmentsOptions, invoicesOptions } from "@/lib/queries";
import { SHIPMENT_STATUSES, shipmentStatusMeta, type ShipmentStatus } from "@/lib/shipments";
import { useAccountId } from "@/lib/session";
import { EXPORTER_ID } from "@/lib/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/direct/shipments")({
  head: () => ({
    meta: [
      { title: "Shipments — Stawi exporter" },
      { name: "description", content: "Track your own export shipments from draft to delivered and paid." },
      { property: "og:title", content: "Shipments — Stawi exporter" },
      { property: "og:description", content: "Track your own export shipments from draft to delivered and paid." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DirectShipments,
});

function DirectShipments() {
  const accountId = useAccountId(EXPORTER_ID);
  const qc = useQueryClient();
  const shipments = useQuery(accountShipmentsOptions(accountId));
  const invoices = useQuery(invoicesOptions({ account_id: accountId }));
  const [stage, setStage] = useState<ShipmentStatus | "all">("all");
  const [q, setQ] = useState("");

  const list = shipments.data ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of list) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [list]);
  const shown = list.filter(
    (s) =>
      (stage === "all" || s.status === stage) &&
      (!q || `${s.reference} ${s.buyer_name} ${s.product} ${s.destination}`.toLowerCase().includes(q.toLowerCase())),
  );

  const advance = useMutation({
    mutationFn: (id: string) => api.advanceShipment(id),
    onSuccess: (s) => {
      toast.success(`${s.reference} is now ${shipmentStatusMeta[s.status].label.toLowerCase()}`);
      void qc.invalidateQueries({ queryKey: ["account", accountId, "shipments"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't update shipment"),
  });

  return (
    <div>
      <PageHeader
        title="Shipments"
        description="Every invoice you send opens a shipment. Move it along as the goods travel."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", ...SHIPMENT_STATUSES] as const).map((st) => (
          <Button
            key={st}
            size="sm"
            variant={stage === st ? "default" : "outline"}
            onClick={() => setStage(st)}
          >
            {st === "all" ? "All" : shipmentStatusMeta[st].label}
            <span className="tabular opacity-70">{st === "all" ? list.length : counts[st] ?? 0}</span>
          </Button>
        ))}
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search buyer, product, reference" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {shipments.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : shipments.isError ? (
        <div className="rounded-lg border border-border p-4 text-sm">
          Couldn't load shipments. <Button variant="link" onClick={() => shipments.refetch()}>Try again</Button>
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Package}
          title={list.length ? "No shipments match" : "No shipments yet"}
          description={list.length ? "Try another stage or search." : "Create an invoice for a buyer and its shipment appears here."}
          action={!list.length ? <Button asChild><Link to="/direct/invoices">Go to invoices</Link></Button> : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((s) => {
            const meta = shipmentStatusMeta[s.status];
            const inv = invoices.data?.find((i) => i.id === s.invoice_id);
            const blocked = s.status === "delivered" && inv?.status !== "completed";
            return (
              <li key={s.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="tabular text-xs text-muted-foreground">{s.reference}</p>
                    <p className="font-medium">{s.buyer_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {s.product} · <span className="tabular">{s.quantity_kg.toLocaleString()} kg</span> · {s.destination}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusChip status={meta.tone as never} label={meta.label} />
                    <span className="tabular text-sm">{s.currency} {s.value.toLocaleString()}</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <span className={cn("text-xs", blocked ? "text-terracotta" : "text-muted-foreground")}>
                    {blocked
                      ? "Waiting for the buyer to pay before closing"
                      : inv
                        ? `Invoice ${inv.status}`
                        : "No invoice linked"}
                  </span>
                  <div className="flex gap-2">
                    {inv && (
                      <Button size="sm" variant="ghost" asChild>
                        <Link to="/direct/invoices/$id" params={{ id: inv.id }}>Invoice <ArrowRight className="size-3" /></Link>
                      </Button>
                    )}
                    {meta.next && (
                      <Button size="sm" disabled={blocked || advance.isPending} onClick={() => advance.mutate(s.id)}>
                        {advance.isPending && advance.variables === s.id && <Loader2 className="size-3 animate-spin" />}
                        {meta.next}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
