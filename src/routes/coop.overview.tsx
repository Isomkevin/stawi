import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { DemoBadge } from "@/components/stawi/DemoDataControl";
import { KpiCard } from "@/components/stawi/KpiCard";
import { StatusChip } from "@/components/stawi/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { NewInvoiceSheet } from "@/features/shared/NewInvoiceSheet";
import { PageHeader } from "@/features/shared/DashboardShell";
import { coopShipmentsOptions, coopMembersOptions, coopMetricsOptions, coopPayoutsOptions, invoicesOptions } from "@/lib/queries";
import { accountName } from "@/lib/mock";
import { SHIPMENT_STATUSES, shipmentStatusMeta } from "@/lib/shipments";
import { useCoopId } from "@/lib/session";
import { formatDate, formatKesCents, formatKesCompact, relativeTime } from "@/lib/format";

export const Route = createFileRoute("/coop/overview")({
  head: () => ({
    meta: [
      { title: "Overview — Stawi co-op" },
      { name: "description", content: "Collections, payouts and farmer shares at a glance." },
      { property: "og:title", content: "Overview — Stawi co-op" },
      { property: "og:description", content: "Collections, payouts and farmer shares at a glance." },
    ],
  }),
  component: Overview,
});

const pieColors = ["var(--lime)", "var(--sage)", "var(--amber)", "oklch(0.6 0.05 152)", "oklch(0.45 0.04 152)"];

function Overview() {
  const coopId = useCoopId();
  const metrics = useQuery(coopMetricsOptions(coopId));
  const invoices = useQuery(invoicesOptions({ coop_id: coopId }));
  const members = useQuery(coopMembersOptions(coopId));
  const payouts = useQuery(coopPayoutsOptions(coopId));
  const shipments = useQuery(coopShipmentsOptions(coopId));

  const settled = (invoices.data ?? []).filter((i) => i.kes_total_cents).sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  const area = settled.map((i) => ({
    d: formatDate(i.created_at),
    live: i.is_demo ? 0 : (i.kes_total_cents ?? 0) / 100,
    sample: i.is_demo ? (i.kes_total_cents ?? 0) / 100 : 0,
  }));
  const perFarmer = (members.data ?? []).map((m) => ({
    name: (m.full_name ?? accountName(m.account_id)).split(" ")[0],
    kes: (payouts.data ?? []).filter((p) => p.account_id === m.account_id && p.status !== "failed").reduce((s, p) => s + p.amount_kes_cents, 0) / 100,
  }));
  const needsApproval = (invoices.data ?? []).filter((i) => i.status === "paid" && !i.split_approved);
  const failed = (payouts.data ?? []).filter((p) => p.status === "failed");
  const missingDest = (members.data ?? []).length === 0;
  const m = metrics.data;
  const live = m?.live ?? m;
  const sample = m?.demo;
  const bankSpread = live ? Math.round(live.total_collected_kes_cents * 0.045) : 0;
  const spark = area.map((a) => a.live);

  return (
    <div>
      <PageHeader title="Overview" description="Everything moving through your co-op this season." action={<NewInvoiceSheet type="coop" coopId={coopId} />} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {m && live ? (
          <>
            <KpiCard index={0} label="Collected" value={formatKesCompact(live.total_collected_kes_cents)} spark={spark} accent />
            <KpiCard index={1} label="Paid to farmers" value={formatKesCompact(live.total_split_kes_cents)} spark={spark} />
            <KpiCard index={2} label="Invoices" value={String(live.invoices)} hint={`${needsApproval.filter((i) => !i.is_demo).length} waiting for you`} />
            <KpiCard index={3} label="Stawi fees" value={formatKesCompact(live.fee_taken_kes_cents)} hint="0.8% flat · live" />
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
        )}
      </div>
      {sample && sample.invoices > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Sample {formatKesCompact(sample.total_collected_kes_cents)} across {sample.invoices} demo invoice{sample.invoices === 1 ? "" : "s"}. Live totals above leave that out.
        </p>
      )}

      <Link to="/coop/shipments" className="mt-6 block rounded-2xl border border-border bg-card p-5 hover:border-lime/50">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Shipments</h2>
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">View all <ArrowRight className="size-4" /></span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {SHIPMENT_STATUSES.map((st) => (
            <div key={st} className="rounded-xl bg-secondary/60 p-3">
              <p className="text-xs text-muted-foreground">{shipmentStatusMeta[st].label}</p>
              <p className="text-display text-xl tabular">{(shipments.data ?? []).filter((x) => x.status === st).length}</p>
            </div>
          ))}
        </div>
      </Link>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
          <h2 className="mb-4 font-medium">Collections (KES)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={area}>
                <defs>
                  <linearGradient id="coll" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--lime)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--lime)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="d" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
                <Area type="monotone" dataKey="live" name="Live" stroke="var(--lime)" strokeWidth={2} fill="url(#coll)" />
                <Area type="monotone" dataKey="sample" name="Demo" stroke="var(--amber)" strokeWidth={2} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-4 font-medium">Needs your attention</h2>
          <ul className="space-y-3 text-sm">
            {needsApproval.map((i) => (
              <li key={i.id}>
                <Link to="/coop/invoices/$id" params={{ id: i.id }} className="flex min-h-11 items-center gap-3 rounded-xl border border-amber/40 bg-amber/10 p-3">
                  <AlertTriangle className="size-4 shrink-0 text-amber" />
                  <span className="flex-1">Approve split for {i.buyer_name}</span>
                  <ArrowRight className="size-4" />
                </Link>
              </li>
            ))}
            {failed.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-terracotta/40 bg-terracotta/10 p-3">
                <AlertTriangle className="size-4 shrink-0 text-terracotta" />
                <span className="flex-1">Payout to {accountName(p.account_id)} failed — M-Pesa not verified</span>
              </li>
            ))}
            {needsApproval.length === 0 && failed.length === 0 && !missingDest && (
              <li className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="size-4 text-lime" /> All clear.</li>
            )}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
          <h2 className="mb-4 font-medium">Paid per farmer this season</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perFarmer}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip cursor={{ fill: "var(--secondary)" }} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
                <Bar dataKey="kes" fill="var(--sage)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-4 font-medium">Shares</h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={members.data ?? []} dataKey="contribution_share" nameKey="account_id" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none">
                  {(members.data ?? []).map((mm, i) => <Cell key={mm.account_id} fill={pieColors[i % pieColors.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number, _n, p) => [`${v}%`, accountName((p.payload as { account_id: string }).account_id)]} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <p className="text-center text-xs text-muted-foreground">{members.data?.length ?? 0} farmers · shares total 100%</p>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
          <h2 className="mb-4 font-medium">Recent activity</h2>
          <ul className="space-y-3 text-sm">
            {(invoices.data ?? []).slice().sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 5).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3">
                <Link to="/coop/invoices/$id" params={{ id: i.id }} className="inline-flex items-center gap-2 hover:text-lime">
                  {i.buyer_name}
                  <DemoBadge demo={i.is_demo} />
                </Link>
                <span className="text-muted-foreground">{relativeTime(i.created_at)}</span>
                <StatusChip status={i.status} />
              </li>
            ))}
          </ul>
        </section>

        <section className="motif rounded-2xl border border-border bg-card p-5">
          <h2 className="font-medium">What you saved</h2>
          <p className="mt-1 text-xs text-muted-foreground">Stawi 0.8% vs a typical 4.5% bank wire + FX spread</p>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><span>Stawi fees</span><span className="tabular">{live ? formatKesCents(live.fee_taken_kes_cents) : "…"}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Bank would cost</span><span className="tabular">{live ? formatKesCents(bankSpread) : "…"}</span></div>
            <div className="flex justify-between border-t border-border pt-2 text-lime"><span>Kept by farmers</span><span className="text-display tabular">{live ? formatKesCents(bankSpread - live.fee_taken_kes_cents) : "…"}</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}
