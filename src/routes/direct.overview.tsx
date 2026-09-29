import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { DemoDataControl } from "@/components/stawi/DemoDataControl";
import { KpiCard } from "@/components/stawi/KpiCard";
import { Skeleton } from "@/components/ui/skeleton";
import { InvoiceTable } from "@/features/shared/InvoiceTable";
import { NewInvoiceSheet } from "@/features/shared/NewInvoiceSheet";
import { PageHeader } from "@/features/shared/DashboardShell";
import { balanceOptions, invoicesOptions } from "@/lib/queries";
import { useAccountId } from "@/lib/session";
import { formatKesCompact } from "@/lib/format";
import { EXPORTER_ID } from "@/lib/mock";

export const Route = createFileRoute("/direct/overview")({
  head: () => ({
    meta: [
      { title: "Overview — Stawi exporter" },
      { name: "description", content: "Your balance, open invoices and quick invoicing." },
      { property: "og:title", content: "Overview — Stawi exporter" },
      { property: "og:description", content: "Your balance, open invoices and quick invoicing." },
    ],
  }),
  component: DirectOverview,
});

function DirectOverview() {
  const accountId = useAccountId(EXPORTER_ID);
  const balance = useQuery(balanceOptions(accountId));
  const invoices = useQuery(invoicesOptions({ account_id: accountId }));
  const list = invoices.data ?? [];
  const liveList = list.filter((i) => !i.is_demo);
  const sampleReceived = list.filter((i) => i.is_demo).reduce((s, i) => s + (i.kes_total_cents ?? 0), 0);
  const received = liveList.reduce((s, i) => s + (i.kes_total_cents ?? 0), 0);
  const open = liveList.filter((i) => i.status === "pending").length;

  return (
    <div>
      <PageHeader title="Karibu, Wanjiru" description="Here's where your money stands." />
      <div className="mb-6">
        <DemoDataControl accountId={accountId} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {balance.data ? (
          <>
            <KpiCard index={0} label="Available" value={formatKesCompact(balance.data.balance_kes_cents)} accent />
            <KpiCard index={1} label="Received this season" value={formatKesCompact(received)} />
            <KpiCard index={2} label="Open invoices" value={String(open)} hint="Waiting for buyers" />
          </>
        ) : (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
        )}
      </div>
      {balance.data && ((balance.data.demo_balance_kes_cents ?? 0) > 0 || sampleReceived > 0) && (
        <p className="mt-3 text-sm text-muted-foreground">
          Sample {formatKesCompact(balance.data.demo_balance_kes_cents ?? sampleReceived)} is labelled Demo and stays out of live payouts.
        </p>
      )}

      <section className="motif mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <h2 className="text-display text-xl">Quick invoice</h2>
          <p className="text-sm text-muted-foreground">Create a payment link in under a minute.</p>
        </div>
        <NewInvoiceSheet type="direct" accountId={accountId} trigger="Create invoice" />
      </section>

      <div className="mt-6 mb-3 flex items-center justify-between">
        <h2 className="font-medium">Recent invoices</h2>
        <Link to="/direct/invoices" className="inline-flex items-center gap-1 text-sm text-lime">View all <ArrowRight className="size-4" /></Link>
      </div>
      <InvoiceTable invoices={list.slice(0, 5)} loading={invoices.isLoading} detailTo="/direct/invoices/$id" compact />
    </div>
  );
}
