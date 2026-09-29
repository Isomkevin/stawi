import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, ChevronRight, Copy, MapPin, Package, Search, Ship, X } from "lucide-react";
import { toast } from "sonner";
import { StatusChip } from "@/components/stawi/StatusChip";
import { EmptyState } from "@/components/stawi/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/features/shared/DashboardShell";
import { attentionFor, canClose, farmerSplit, type Attention } from "@/features/coop/shipmentLogic";
import { coopPayoutsOptions, coopShipmentsOptions, invoicesOptions } from "@/lib/queries";
import { SHIPMENT_STATUSES, shipmentStatusMeta, type Shipment, type ShipmentStatus } from "@/lib/shipments";
import { api } from "@/lib/api";
import { accountName } from "@/lib/mock";
import { useCoopId } from "@/lib/session";
import { formatCurrency, formatDate, formatKesCents } from "@/lib/format";
import type { Invoice, Payout } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/coop/shipments")({
  validateSearch: (s: Record<string, unknown>): { id?: string } => (typeof s['id'] === "string" ? { id: s['id'] } : {}),
  head: () => ({
    meta: [
      { title: "Shipments — Stawi co-op" },
      { name: "description", content: "Every active, upcoming and completed shipment, its farmers and what needs attention." },
      { property: "og:title", content: "Shipments — Stawi co-op" },
      { property: "og:description", content: "Every active, upcoming and completed shipment, its farmers and what needs attention." },
    ],
  }),
  component: ShipmentsPage,
});

type Filter = "all" | "attention" | "active" | ShipmentStatus;
type Sort = "ship_date" | "updated" | "value";

function useDesktop() {
  const [v, setV] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const on = () => setV(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return v;
}

function ShipmentChip({ status }: { status: ShipmentStatus }) {
  const m = shipmentStatusMeta[status];
  return <StatusChip status={m.tone} label={m.label} />;
}

function ShipmentsPage() {
  const coopId = useCoopId();
  const { id } = Route.useSearch();
  const navigate = useNavigate({ from: "/coop/shipments" });
  const desktop = useDesktop();
  const shipments = useQuery(coopShipmentsOptions(coopId));
  const invoices = useQuery(invoicesOptions({ coop_id: coopId }));
  const payouts = useQuery(coopPayoutsOptions(coopId));
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("ship_date");
  const [farmer, setFarmer] = useState("all");
  const [dest, setDest] = useState("all");

  const farmerOptions = useMemo(() => {
    const ids = new Set<string>();
    (shipments.data ?? []).forEach((s) => s.farmers.forEach((x) => ids.add(x.account_id)));
    return [...ids].map((id) => ({ id, name: accountName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [shipments.data]);
  const destOptions = useMemo(() => [...new Set((shipments.data ?? []).map((s) => s.destination))].sort(), [shipments.data]);
  const extraFilters = farmer !== "all" || dest !== "all" || filter !== "all" || q !== "";
  const clearFilters = () => {
    setFarmer("all");
    setDest("all");
    setFilter("all");
    setQ("");
  };

  const invById = useMemo(() => new Map((invoices.data ?? []).map((i) => [i.id, i])), [invoices.data]);
  const rows = useMemo(
    () =>
      (shipments.data ?? []).map((s) => {
        const inv = s.invoice_id ? invById.get(s.invoice_id) : undefined;
        return { s, inv, att: attentionFor(s, inv, payouts.data ?? []) };
      }),
    [shipments.data, invById, payouts.data],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, attention: 0, active: 0 };
    rows.forEach((r) => {
      c[r.s.status] = (c[r.s.status] ?? 0) + 1;
      if (r.att.length) c['attention']!++;
      if (r.s.status !== "completed") c['active']!++;
    });
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows
      .filter((r) =>
        filter === "all" ? true : filter === "attention" ? r.att.length > 0 : filter === "active" ? r.s.status !== "completed" : r.s.status === filter,
      )
      .filter((r) => farmer === "all" || r.s.farmers.some((x) => x.account_id === farmer))
      .filter((r) => dest === "all" || r.s.destination === dest)
      .filter((r) => {
        if (!term) return true;
        const farmers = r.s.farmers.map((x) => accountName(x.account_id)).join(" ");
        return [r.s.reference, r.s.buyer_name, r.s.product, r.s.destination, farmers].join(" ").toLowerCase().includes(term);
      })
      .sort((a, b) => {
        if (sort === "value") return b.s.value - a.s.value;
        if (sort === "updated") return +new Date(b.s.updated_at) - +new Date(a.s.updated_at);
        // upcoming first, then most recent past
        return Math.abs(+new Date(a.s.ship_date) - Date.now()) - Math.abs(+new Date(b.s.ship_date) - Date.now());
      });
  }, [rows, filter, q, sort, farmer, dest]);

  const selected = rows.find((r) => r.s.id === id);
  const select = (sid?: string) => void navigate({ search: sid ? { id: sid } : {}, replace: true, resetScroll: false });

  const filters: Array<{ key: Filter; label: string }> = [
    { key: "all", label: "All" },
    { key: "attention", label: "Needs attention" },
    { key: "active", label: "Active" },
    ...SHIPMENT_STATUSES.map((s) => ({ key: s as Filter, label: shipmentStatusMeta[s].label })),
  ];

  const attentionRows = rows.filter((r) => r.att.length > 0);

  return (
    <div>
      <PageHeader title="Shipments" description="Every shipment you're running — what's moving, what's next, and what needs you." />

      {/* Pipeline summary: click a stage to filter */}
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {SHIPMENT_STATUSES.map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setFilter(filter === st ? "all" : st)}
            className={cn(
              "rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-lime/50",
              filter === st && "border-lime bg-secondary",
            )}
          >
            <p className="text-xs text-muted-foreground">{shipmentStatusMeta[st].label}</p>
            <p className="text-display text-2xl tabular">{counts[st] ?? 0}</p>
          </button>
        ))}
      </div>

      {attentionRows.length > 0 && !extraFilters && (
        <section className="mb-4 rounded-2xl border border-amber/40 bg-amber/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4 text-amber" /> {attentionRows.length} shipments need your attention
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {attentionRows.slice(0, 4).map((r) => (
              <li key={r.s.id}>
                <button type="button" onClick={() => select(r.s.id)} className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-card px-3 py-2 text-left text-sm hover:bg-secondary">
                  <span className="shrink-0 font-medium tabular">{r.s.reference}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.att[0]!.text}</span>
                  <ChevronRight className="size-4 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reference, buyer, crop, destination or farmer" className="pl-9" />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ship_date">Nearest ship date</SelectItem>
            <SelectItem value="updated">Recently updated</SelectItem>
            <SelectItem value="value">Highest value</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            {filters.map((fl) => (
              <SelectItem key={fl.key} value={fl.key}>{fl.key === "all" ? "All statuses" : fl.label} ({counts[fl.key] ?? 0})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={farmer} onValueChange={setFarmer}>
          <SelectTrigger aria-label="Filter by farmer"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All farmers</SelectItem>
            {farmerOptions.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={dest} onValueChange={setDest}>
          <SelectTrigger aria-label="Filter by destination"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All destinations</SelectItem>
            {destOptions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" onClick={clearFilters} disabled={!extraFilters}>Clear</Button>
      </div>
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {filters.map((fl) => (
          <button
            key={fl.key}
            type="button"
            onClick={() => setFilter(fl.key)}
            className={cn(
              "flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs",
              filter === fl.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {fl.label} <span className="tabular opacity-70">{counts[fl.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className={cn("grid gap-4", selected && desktop && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]")}>
        <div className="min-w-0">
          {shipments.isLoading ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
          ) : shipments.isError ? (
            <div role="alert" className="rounded-2xl border border-terracotta/40 bg-terracotta/10 p-4 text-sm">
              Couldn't load shipments. <Button variant="link" className="h-auto p-0" onClick={() => void shipments.refetch()}>Try again</Button>
            </div>
          ) : visible.length === 0 ? (
            <EmptyState icon={Package} title="No shipments match" description="Try a different filter or search." />
          ) : (
            <ul className="space-y-2">
              {visible.map((r) => (
                <ShipmentRow key={r.s.id} s={r.s} inv={r.inv} att={r.att} active={r.s.id === id} compact={!!selected && desktop} onOpen={() => select(r.s.id)} />
              ))}
            </ul>
          )}
        </div>

        {selected && desktop && (
          <aside className="sticky top-4 max-h-[calc(100vh-2rem)] self-start overflow-y-auto rounded-2xl border border-border bg-card">
            <ShipmentDetail s={selected.s} inv={selected.inv} att={selected.att} payouts={payouts.data ?? []} onClose={() => select()} />
          </aside>
        )}
      </div>

      <Sheet open={!!selected && !desktop} onOpenChange={(o) => !o && select()}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl p-0">
          <SheetTitle className="sr-only">Shipment details</SheetTitle>
          {selected && <ShipmentDetail s={selected.s} inv={selected.inv} att={selected.att} payouts={payouts.data ?? []} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function useAdvance(coopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sid: string) => api.advanceShipment(sid),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ["coop", coopId, "shipments"] });
      toast.success(`${s.reference} is now ${shipmentStatusMeta[s.status].label.toLowerCase()}`);
    },
    onError: () => toast.error("Couldn't update the shipment. Please try again."),
  });
}

/** The single most useful next step for a shipment, usable straight from the list. */
function QuickAction({ s, inv, att, size = "sm" }: { s: Shipment; inv: Invoice | undefined; att: Attention[]; size?: "sm" | "default" }) {
  const coopId = useCoopId();
  const advance = useAdvance(coopId);
  if (att.some((a) => a.kind === "approve") && inv)
    return (
      <Button asChild size={size} onClick={(e) => e.stopPropagation()}>
        <Link to="/coop/invoices/$id" params={{ id: inv.id }}>Approve split</Link>
      </Button>
    );
  if (att.some((a) => a.kind === "invoice"))
    return (
      <Button asChild size={size} variant="outline" onClick={(e) => e.stopPropagation()}>
        <Link to="/coop/invoices">Create invoice</Link>
      </Button>
    );
  const next = shipmentStatusMeta[s.status].next;
  if (!next) return null;
  const blocked = s.status === "delivered" && !canClose(inv);
  return (
    <Button
      size={size}
      variant="outline"
      disabled={blocked || advance.isPending}
      title={blocked ? "Close once farmers are paid out" : undefined}
      onClick={(e) => {
        e.stopPropagation();
        advance.mutate(s.id);
      }}
    >
      {next}
    </Button>
  );
}

function ShipmentRow({ s, inv, att, active, compact, onOpen }: { s: Shipment; inv: Invoice | undefined; att: Attention[]; active: boolean; compact: boolean; onOpen: () => void }) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
        className={cn(
          "cursor-pointer rounded-2xl border border-border bg-card p-4 transition-colors hover:border-lime/50",
          active && "border-lime ring-1 ring-lime/40",
        )}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium tabular">{s.reference}</span>
              <ShipmentChip status={s.status} />
              {att.length > 0 && (
                <span className={cn("inline-flex items-center gap-1 text-xs", att[0]!.tone === "danger" ? "text-terracotta" : "text-amber")}>
                  <AlertTriangle className="size-3.5" /> {att.length > 1 ? `${att.length} issues` : att[0]!.text}
                </span>
              )}
            </div>
            <p className="mt-1 truncate font-medium">{s.buyer_name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {s.product} · {s.quantity_kg.toLocaleString()} kg
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm tabular">{formatCurrency(s.value, s.currency)}</p>
            {inv && <p className="mt-1"><StatusChip status={inv.status} className="text-[10px]" /></p>}
          </div>
        </div>
        <div className={cn("mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground", compact && "gap-x-3")}>
          <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{s.destination}</span>
          <span className="inline-flex items-center gap-1"><Ship className="size-3.5" />{s.shipped_at ? "Shipped" : "Ships"} {formatDate(s.shipped_at ?? s.ship_date)}</span>
          <span>{s.farmers.length} farmers</span>
          <span className="ml-auto"><QuickAction s={s} inv={inv} att={att} /></span>
        </div>
      </div>
    </li>
  );
}

function ShipmentDetail({ s, inv, att, payouts, onClose }: { s: Shipment; inv: Invoice | undefined; att: Attention[]; payouts: Payout[]; onClose?: () => void }) {
  const split = farmerSplit(s, inv);
  const stage = SHIPMENT_STATUSES.indexOf(s.status);
  const payLink = inv ? `${typeof window !== "undefined" ? window.location.origin : ""}/pay/${inv.id}` : null;
  const totalKg = s.farmers.reduce((a, x) => a + x.kilos, 0);
  return (
    <div className="p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground tabular">{s.reference}</p>
          <h2 className="text-display truncate text-2xl">{s.buyer_name}</h2>
          <p className="text-sm text-muted-foreground">{s.product}</p>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details"><X className="size-4" /></Button>
        )}
      </div>

      {/* Stage tracker */}
      <ol className="mt-4 grid grid-cols-6 gap-1">
        {SHIPMENT_STATUSES.map((st, i) => (
          <li key={st} className="min-w-0">
            <div className={cn("h-1.5 rounded-full", i <= stage ? "bg-lime" : "bg-secondary")} />
            <p className={cn("mt-1 truncate text-[10px]", i === stage ? "text-foreground" : "text-muted-foreground")}>{shipmentStatusMeta[st].label}</p>
          </li>
        ))}
      </ol>

      {att.length > 0 && (
        <ul className="mt-4 space-y-2">
          {att.map((a) => (
            <li key={a.text} className={cn("flex items-center gap-2 rounded-xl border p-3 text-sm", a.tone === "danger" ? "border-terracotta/40 bg-terracotta/10" : "border-amber/40 bg-amber/10")}>
              <AlertTriangle className={cn("size-4 shrink-0", a.tone === "danger" ? "text-terracotta" : "text-amber")} /> {a.text}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <QuickAction s={s} inv={inv} att={att} size="default" />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Fact label="Quantity" value={`${s.quantity_kg.toLocaleString()} kg`} />
        <Fact label="Destination" value={s.destination} />
        <Fact label={s.shipped_at ? "Shipped" : "Expected ship date"} value={formatDate(s.shipped_at ?? s.ship_date)} />
        <Fact label="Value" value={formatCurrency(s.value, s.currency)} />
      </dl>

      <section className="mt-5 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Buyer invoice</h3>
          {inv && <StatusChip status={inv.status} />}
        </div>
        {inv ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/coop/invoices/$id" params={{ id: inv.id }}>Open invoice <ArrowRight className="size-3.5" /></Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (payLink) void navigator.clipboard?.writeText(payLink);
                toast.success("Payment link copied");
              }}
            >
              <Copy className="size-3.5" /> Copy payment link
            </Button>
            {inv.kes_total_cents != null && <p className="w-full text-xs text-muted-foreground">Net to farmers: {formatKesCents(inv.kes_total_cents)}</p>}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No invoice yet. Send the buyer one before the goods ship.</p>
        )}
      </section>

      <section className="mt-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Farmers in this shipment</h3>
          <span className="text-xs text-muted-foreground">{totalKg.toLocaleString()} kg · {inv?.kes_total_cents ? "payout" : "est. payout"}</span>
        </div>
        {s.farmers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No farmers added yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {s.farmers.map((fm) => {
              const p = inv ? payouts.find((x) => x.invoice_id === inv.id && x.account_id === fm.account_id) : undefined;
              return (
                <li key={fm.account_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{accountName(fm.account_id)}</p>
                    <p className="text-xs text-muted-foreground">{fm.kilos} kg · {Math.round((fm.kilos / totalKg) * 100)}%</p>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <span className="tabular">{formatKesCents(split.get(fm.account_id) ?? 0)}</span>
                    {p ? <StatusChip status={p.status} className="text-[10px]" /> : inv?.status === "completed" ? <Check className="size-4 text-lime" /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/60 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate">{value}</dd>
    </div>
  );
}
