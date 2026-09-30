import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, ChevronRight, Copy, Loader2, MapPin, Package, Pencil, Plus, Search, Ship, X } from "lucide-react";
import { toast } from "sonner";
import { DemoBadge } from "@/components/stawi/DemoDataControl";
import { PinPad } from "@/components/stawi/PinPad";
import { StatusChip } from "@/components/stawi/StatusChip";
import { EmptyState } from "@/components/stawi/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/features/shared/DashboardShell";
import { attentionFor, assignedKilos, canClose, demandPercents, farmerSplit, type Attention } from "@/features/coop/shipmentLogic";
import { accountOptions, coopMembersOptions, coopPayoutsOptions, coopShipmentsOptions, invoicesOptions } from "@/lib/queries";
import { SHIPMENT_STATUSES, shipmentStatusMeta, type Shipment, type ShipmentStatus } from "@/lib/shipments";
import { api, ApiError } from "@/lib/api";
import { ConfirmDelete } from "@/components/stawi/ConfirmDelete";
import { accountName } from "@/lib/mock";
import { useAccountId, useCoopId } from "@/lib/session";
import { formatCurrency, formatDate, formatKesCents } from "@/lib/format";
import type { FarmerShareConfirmation, Invoice, Payout } from "@/lib/types";
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
  const members = useQuery(coopMembersOptions(coopId));
  const nameOf = useCallback(
    (accountId: string) => members.data?.find((member) => member.account_id === accountId)?.full_name ?? accountName(accountId),
    [members.data],
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("ship_date");
  const [farmer, setFarmer] = useState("all");
  const [dest, setDest] = useState("all");

  const farmerOptions = useMemo(() => {
    const ids = new Set<string>();
    (shipments.data ?? []).forEach((s) => s.farmers.forEach((x) => ids.add(x.account_id)));
    return [...ids].map((id) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [shipments.data, nameOf]);
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
        const farmers = r.s.farmers.map((x) => nameOf(x.account_id)).join(" ");
        return [r.s.reference, r.s.buyer_name, r.s.product, r.s.destination, farmers].join(" ").toLowerCase().includes(term);
      })
      .sort((a, b) => {
        if (sort === "value") return b.s.value - a.s.value;
        if (sort === "updated") return +new Date(b.s.updated_at) - +new Date(a.s.updated_at);
        // upcoming first, then most recent past
        return Math.abs(+new Date(a.s.ship_date) - Date.now()) - Math.abs(+new Date(b.s.ship_date) - Date.now());
      });
  }, [rows, filter, q, sort, farmer, dest, nameOf]);

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
      <PageHeader
        title="Shipments"
        description="Every shipment you're running — what's moving, what's next, and what needs you."
        action={<NewShipment onCreated={(sid) => select(sid)} />}
      />

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
            <ShipmentDetail s={selected.s} inv={selected.inv} att={selected.att} payouts={payouts.data ?? []} nameOf={nameOf} onClose={() => select()} />
          </aside>
        )}
      </div>

      <Sheet open={!!selected && !desktop} onOpenChange={(o) => !o && select()}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl p-0">
          <SheetTitle className="sr-only">Shipment details</SheetTitle>
          {selected && <ShipmentDetail s={selected.s} inv={selected.inv} att={selected.att} payouts={payouts.data ?? []} nameOf={nameOf} />}
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

function NewShipment({ onCreated }: { onCreated: (id: string) => void }) {
  const coopId = useCoopId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const blank = { buyer_name: "", product: "", quantity_kg: "", destination: "", value: "", currency: "USD" as "USD" | "EUR" | "GBP", ship_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10) };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const qty = Number(f.quantity_kg);
  const valid = f.buyer_name.trim() && f.product.trim() && Number.isInteger(qty) && qty > 0;
  const create = useMutation({
    mutationFn: () =>
      api.createShipment(coopId, {
        buyer_name: f.buyer_name.trim(),
        product: f.product.trim(),
        quantity_kg: qty,
        destination: f.destination.trim() || "TBD",
        value: Number(f.value) || 0,
        currency: f.currency,
        ship_date: f.ship_date,
      }),
    onSuccess: async (s) => {
      await qc.invalidateQueries({ queryKey: coopShipmentsOptions(coopId).queryKey });
      toast.success(`Draft ${s.reference} created — now add farmers`);
      setOpen(false);
      setF(blank);
      onCreated(s.id);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't create the shipment"),
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New shipment
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetTitle>New draft shipment</SheetTitle>
          <p className="mt-1 text-sm text-muted-foreground">Start the shipment now. You'll add farmers and their kilos next.</p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) create.mutate();
            }}
          >
            <Field label="Buyer"><Input required value={f.buyer_name} onChange={set("buyer_name")} placeholder="Hansen Kaffee GmbH" /></Field>
            <Field label="Product"><Input required value={f.product} onChange={set("product")} placeholder="Washed AA green coffee" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity (kg)"><Input required inputMode="numeric" value={f.quantity_kg} onChange={set("quantity_kg")} placeholder="1000" /></Field>
              <Field label="Ship date"><Input type="date" value={f.ship_date} onChange={set("ship_date")} /></Field>
            </div>
            <Field label="Destination"><Input value={f.destination} onChange={set("destination")} placeholder="Hamburg, DE" /></Field>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field label="Value"><Input inputMode="decimal" value={f.value} onChange={set("value")} placeholder="0" /></Field>
              <Field label="Currency">
                <Select value={f.currency} onValueChange={(v) => setF((p) => ({ ...p, currency: v as typeof p.currency }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["USD", "EUR", "GBP"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Button type="submit" className="w-full" disabled={!valid || create.isPending}>
              {create.isPending ? "Creating…" : "Create draft"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

function EditShipment({ s }: { s: Shipment }) {
  const coopId = useCoopId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const assigned = s.farmers.reduce((sum, farmer) => sum + farmer.kilos, 0);
  const fromShipment = () => ({
    buyer_name: s.buyer_name,
    product: s.product,
    quantity_kg: String(s.quantity_kg),
    destination: s.destination === "TBD" ? "" : s.destination,
    value: s.value ? String(s.value) : "",
    currency: (s.currency === "EUR" || s.currency === "GBP" ? s.currency : "USD") as "USD" | "EUR" | "GBP",
    ship_date: s.ship_date.slice(0, 10),
  });
  const [f, setF] = useState(fromShipment);
  const set = (k: keyof ReturnType<typeof fromShipment>) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const qty = Number(f.quantity_kg);
  const valid = Boolean(f.buyer_name.trim() && f.product.trim() && Number.isInteger(qty) && qty >= Math.max(assigned, 1));
  const save = useMutation({
    mutationFn: () =>
      api.updateShipment(s.id, {
        buyer_name: f.buyer_name.trim(),
        product: f.product.trim(),
        quantity_kg: qty,
        destination: f.destination.trim() || "TBD",
        value: Number(f.value) || 0,
        currency: f.currency,
        ship_date: f.ship_date,
      }),
    onSuccess: async (next) => {
      await qc.invalidateQueries({ queryKey: ["coop", coopId, "shipments"] });
      toast.success(`${next.reference} updated`);
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't update the shipment"),
  });
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setF(fromShipment());
          setOpen(true);
        }}
      >
        <Pencil className="size-3.5" /> Edit
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetTitle>Edit {s.reference}</SheetTitle>
          <p className="mt-1 text-sm text-muted-foreground">You can change these details until an invoice is created.</p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) save.mutate();
            }}
          >
            <Field label="Buyer"><Input required value={f.buyer_name} onChange={set("buyer_name")} /></Field>
            <Field label="Product"><Input required value={f.product} onChange={set("product")} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity (kg)"><Input required inputMode="numeric" value={f.quantity_kg} onChange={set("quantity_kg")} /></Field>
              <Field label="Ship date"><Input type="date" value={f.ship_date} onChange={set("ship_date")} /></Field>
            </div>
            <Field label="Destination"><Input value={f.destination} onChange={set("destination")} placeholder="Hamburg, DE" /></Field>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field label="Value"><Input inputMode="decimal" value={f.value} onChange={set("value")} /></Field>
              <Field label="Currency">
                <Select value={f.currency} onValueChange={(v) => setF((p) => ({ ...p, currency: v as typeof p.currency }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["USD", "EUR", "GBP"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {assigned > 0 && (
              <p className="text-xs text-muted-foreground">Farmers already have {assigned.toLocaleString()} kg on this shipment, so quantity stays at least that.</p>
            )}
            <Button type="submit" className="w-full" disabled={!valid || save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function DeleteShipment({ s, inv, onDeleted }: { s: Shipment; inv: Invoice | undefined; onDeleted?: (() => void) | undefined }) {
  const coopId = useCoopId();
  const qc = useQueryClient();
  const blocked = inv && inv.status !== "pending" ? "Shipments with a paid invoice can't be deleted" : undefined;
  return (
    <ConfirmDelete
      label={`Delete shipment ${s.reference}`}
      title={`Delete shipment ${s.reference}?`}
      description={`${s.buyer_name} · ${s.product}. This removes it from your shipments list and can't be undone.`}
      disabledReason={blocked}
      onConfirm={async () => {
        try {
          await api.deleteShipment(s.id);
          toast.success(`Shipment ${s.reference} deleted`);
          onDeleted?.();
          await qc.invalidateQueries({ queryKey: ["coop", coopId, "shipments"] });
        } catch (e) {
          toast.error(e instanceof ApiError && e.status === 404 ? "The server can't delete shipments yet." : "Couldn't delete the shipment.");
        }
      }}
    />
  );
}
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message && !/^HTTP|fetch/i.test(e.message) ? e.message : fallback);

function confirmCopy(confirmation: FarmerShareConfirmation): string {
  const share = confirmation.share != null ? `${confirmation.share}% confirmed` : "Share confirmed";
  const amount = confirmation.net_kes_cents != null ? ` · ${formatKesCents(confirmation.net_kes_cents)}` : "";
  if (confirmation.payout === "mpesa_on_approval") {
    return `${share}${amount}. Payaza sends it to ${confirmation.mpesa} when you approve the split.`;
  }
  if (confirmation.payout === "sample_balance") {
    return `${share}${amount}. This is sample money, so it stays in the sample balance. A live invoice pays ${confirmation.mpesa ?? "M-Pesa"} through Payaza.`;
  }
  if (confirmation.payout === "balance") {
    return `${share}${amount}. Add an M-Pesa number, or this share stays in their Stawi balance.`;
  }
  return `${share}${amount}. It goes to ${confirmation.mpesa ?? "their M-Pesa"} after the buyer pays and you approve.`;
}

function AddFarmer({ s }: { s: Shipment }) {
  const coopId = useCoopId();
  const qc = useQueryClient();
  const members = useQuery(coopMembersOptions(coopId));
  const [accountId, setAccountId] = useState("");
  const [kilos, setKilos] = useState("");
  const [mpesa, setMpesa] = useState("");
  const selected = useQuery({ ...accountOptions(accountId), enabled: accountId.length > 0 });
  const savedMobile = selected.data?.payout_destinations.find(
    (dest) => dest.is_verified && (dest.type === "mpesa" || dest.type === "momo"),
  );
  const used = s.farmers.reduce((a, x) => a + x.kilos, 0);
  const existing = s.farmers.find((x) => x.account_id === accountId);
  const left = s.quantity_kg - used + (existing?.kilos ?? 0);
  const add = useMutation({
    mutationFn: () => api.addShipmentFarmer(s.id, accountId, Number(kilos), savedMobile ? undefined : mpesa),
    onSuccess: (shipment) => {
      toast.success(shipment.confirmation ? confirmCopy(shipment.confirmation) : existing ? "Farmer kilos updated" : "Share confirmed");
      setAccountId("");
      setKilos("");
      setMpesa("");
      void qc.invalidateQueries({ queryKey: ["coop", coopId, "shipments"] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      if (accountId) void qc.invalidateQueries({ queryKey: ["account", accountId] });
    },
    onError: (e) => toast.error(errText(e, "Couldn't add the farmer.")),
  });
  const n = Number(kilos);
  const needsMpesa = Boolean(accountId) && selected.isSuccess && !savedMobile;
  const valid = accountId && Number.isInteger(n) && n > 0 && n <= left && (!needsMpesa || mpesa.replace(/\D/g, "").length >= 9) && !selected.isLoading;
  return (
    <form
      className="mt-3 grid grid-cols-1 gap-2 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) add.mutate();
      }}
    >
      <Select value={accountId} onValueChange={(v) => { setAccountId(v); setMpesa(""); const ex = s.farmers.find((x) => x.account_id === v); setKilos(ex ? String(ex.kilos) : ""); }}>
        <SelectTrigger aria-label="Choose a farmer"><SelectValue placeholder={members.isLoading ? "Loading farmers…" : "Choose a co-op farmer"} /></SelectTrigger>
        <SelectContent>
          {(members.data ?? []).map((m) => (
            <SelectItem key={m.account_id} value={m.account_id}>
              {m.full_name ?? accountName(m.account_id)}{s.farmers.some((x) => x.account_id === m.account_id) ? " (on shipment)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input type="number" inputMode="numeric" min={1} max={left} step={1} placeholder="Kilos" aria-label="Kilos" value={kilos} onChange={(e) => setKilos(e.target.value)} />
      <Button type="submit" disabled={!valid || add.isPending}>{add.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}{existing ? "Update" : "Confirm share"}</Button>
      {needsMpesa && (
        <Input className="sm:col-span-3" value={mpesa} onChange={(e) => setMpesa(e.target.value)} placeholder="M-Pesa number, 07… or +254…" aria-label="M-Pesa number" />
      )}
      {savedMobile && <p className="text-xs text-muted-foreground sm:col-span-3">Pays {savedMobile.details} through Payaza when the split is approved.</p>}
      <p className="text-xs text-muted-foreground sm:col-span-3">{Math.max(left, 0).toLocaleString()} kg left to assign. Kilos must add up to {s.quantity_kg.toLocaleString()} kg before the draft can move on.</p>
    </form>
  );
}

function RemoveFarmer({ s, accountId, name }: { s: Shipment; accountId: string; name: string }) {
  const coopId = useCoopId();
  const qc = useQueryClient();
  return (
    <ConfirmDelete
      label={`Remove ${name} from shipment`}
      title={`Remove ${name} from ${s.reference}?`}
      description="They won't be paid from this shipment. You can add them back until the split is approved."
      onConfirm={async () => {
        try {
          await api.removeShipmentFarmer(s.id, accountId);
          toast.success(`${name} removed from ${s.reference}`);
          await qc.invalidateQueries({ queryKey: ["coop", coopId, "shipments"] });
        } catch (e) {
          toast.error(errText(e, "Couldn't remove the farmer."));
        }
      }}
    />
  );
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
  const shortfall = s.status === "draft" ? s.quantity_kg - assignedKilos(s) : 0;
  const blocked = (s.status === "delivered" && !canClose(inv)) || shortfall !== 0;
  const title = shortfall > 0 ? `${shortfall.toLocaleString()} kg still to assign` : shortfall < 0 ? "Farmer kilos are over this shipment" : blocked ? "Close once farmers are paid out" : undefined;
  return (
    <Button
      size={size}
      variant="outline"
      disabled={blocked || advance.isPending}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        advance.mutate(s.id);
      }}
    >
      {shortfall > 0 ? `${shortfall.toLocaleString()} kg left` : next}
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
              <DemoBadge demo={s.is_demo} />
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

function ShipmentDetail({ s, inv, att, payouts, nameOf, onClose }: { s: Shipment; inv: Invoice | undefined; att: Attention[]; payouts: Payout[]; nameOf: (accountId: string) => string; onClose?: () => void }) {
  const split = farmerSplit(s, inv);
  const stage = SHIPMENT_STATUSES.indexOf(s.status);
  const payLink = inv ? `${typeof window !== "undefined" ? window.location.origin : ""}/pay/${inv.id}` : null;
  const totalKg = assignedKilos(s);
  const percents = demandPercents(s.farmers, s.quantity_kg);
  const fill = s.quantity_kg > 0 ? Math.min(100, Math.round((totalKg / s.quantity_kg) * 100)) : 0;
  const fillLabel = s.quantity_kg > 0 ? Math.round((totalKg / s.quantity_kg) * 1000) / 10 : 0;
  const locked = s.status === "completed" || !!inv?.split_approved || inv?.status === "completed";
  return (
    <div className="p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground tabular">{s.reference}</p>
          <h2 className="text-display truncate text-2xl">{s.buyer_name}</h2>
          <p className="text-sm text-muted-foreground">{s.product}</p>
        </div>
        <div className="flex items-center gap-1">
          {!s.invoice_id && <EditShipment s={s} />}
          <DeleteShipment s={s} inv={inv} onDeleted={onClose} />
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details"><X className="size-4" /></Button>
          )}
        </div>
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
          <span className={cn("text-xs tabular", totalKg === s.quantity_kg ? "text-lime" : "text-muted-foreground")}>{totalKg.toLocaleString()} / {s.quantity_kg.toLocaleString()} kg · {fillLabel}% of this shipment</span>
        </div>
        <Progress value={fill} className="mb-3" />
        {s.farmers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No farmers added yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {s.farmers.map((fm) => {
              const p = inv ? payouts.find((x) => x.invoice_id === inv.id && x.account_id === fm.account_id && x.kind === "withdrawal") ?? payouts.find((x) => x.invoice_id === inv.id && x.account_id === fm.account_id) : undefined;
              return (
                <li key={fm.account_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{nameOf(fm.account_id)}</p>
                    <p className="text-xs text-muted-foreground">{fm.kilos} kg · {percents.get(fm.account_id) ?? 0}% of this shipment</p>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <span className="tabular">{formatKesCents(split.get(fm.account_id) ?? 0)}</span>
                    {p ? <StatusChip status={p.status} className="text-[10px]" /> : inv?.status === "completed" ? <Check className="size-4 text-lime" /> : null}
                    {!locked && <RemoveFarmer s={s} accountId={fm.account_id} name={nameOf(fm.account_id)} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {locked ? (
          <p className="mt-2 text-xs text-muted-foreground">Farmers are locked once the split is approved.</p>
        ) : (
          <AddFarmer s={s} />
        )}
        {inv && inv.status === "settling" && !inv.split_approved && s.farmers.length > 0 && <PayFarmerShares inv={inv} count={s.farmers.length} />}
      </section>
    </div>
  );
}

function PayFarmerShares({ inv, count }: { inv: Invoice; count: number }) {
  const qc = useQueryClient();
  const treasurerId = useAccountId();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: (nextPin: string) => api.approveSplit(inv.id, treasurerId, nextPin),
    onSuccess: async () => {
      setOpen(false);
      setPin("");
      toast.success(inv.is_demo ? "Sample split approved" : "Payaza is sending each share to M-Pesa");
      await qc.invalidateQueries();
    },
    onError: (err) => {
      setPin("");
      setPinErr(err instanceof ApiError && err.code === "wrong" ? "Wrong PIN. Try again." : "Couldn't send the payout. Try again.");
    },
  });
  return (
    <div className="mt-3">
      <Button size="sm" onClick={() => { setPin(""); setPinErr(null); setOpen(true); }}>
        {inv.is_demo ? "Approve sample split" : "Send shares to M-Pesa"}
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        {inv.is_demo
          ? "Sample money stays in Stawi. A live invoice sends each confirmed share to M-Pesa through Payaza."
          : "Approving pays every farmer on this shipment. Payaza sends each share to their M-Pesa number."}
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm with your PIN</DialogTitle>
            <DialogDescription>
              {inv.is_demo
                ? "Approves the sample split. Payaza is not called for sample money."
                : `Sends ${inv.kes_total_cents ? formatKesCents(inv.kes_total_cents) : "the confirmed shares"} to ${count} M-Pesa ${count === 1 ? "number" : "numbers"} through Payaza.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <PinPad
              value={pin}
              error={pinErr}
              onChange={(next) => {
                setPinErr(null);
                setPin(next);
                if (next.length === 4) approve.mutate(next);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
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
