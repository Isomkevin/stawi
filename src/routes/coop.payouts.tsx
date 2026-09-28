import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Wallet } from "lucide-react";
import { EmptyState } from "@/components/stawi/EmptyState";
import { StatusChip } from "@/components/stawi/StatusChip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/features/shared/DashboardShell";
import { downloadCsv } from "@/lib/csv";
import { accountName } from "@/lib/mock";
import { coopPayoutsOptions } from "@/lib/queries";
import { useCoopId } from "@/lib/session";
import { formatDateTime, formatKesCents } from "@/lib/format";

export const Route = createFileRoute("/coop/payouts")({
  head: () => ({
    meta: [
      { title: "Payouts — Stawi co-op" },
      { name: "description", content: "Every payout to every farmer, exportable to CSV." },
      { property: "og:title", content: "Payouts — Stawi co-op" },
      { property: "og:description", content: "Every payout to every farmer, exportable to CSV." },
    ],
  }),
  component: Payouts,
});

function Payouts() {
  const coopId = useCoopId();
  const payouts = useQuery(coopPayoutsOptions(coopId));
  const exportCsv = () =>
    downloadCsv("stawi-payouts.csv", [
      ["id", "farmer", "invoice", "amount_kes", "status", "date"],
      ...(payouts.data ?? []).map((p) => [p.id, accountName(p.account_id), p.invoice_id, (p.amount_kes_cents / 100).toFixed(2), p.status, p.created_at]),
    ]);

  return (
    <div>
      <PageHeader
        title="Payouts"
        description="Money sent from each invoice to each farmer."
        action={<Button variant="outline" className="h-11" onClick={exportCsv} disabled={!payouts.data?.length}><Download className="size-4" /> Export CSV</Button>}
      />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        {payouts.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !payouts.data?.length ? (
          <EmptyState icon={Wallet} title="No payouts yet" description="Approve a split to pay your farmers." className="border-0" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-normal">Farmer</th>
                <th className="hidden px-4 py-3 font-normal sm:table-cell">Invoice</th>
                <th className="px-4 py-3 text-right font-normal">Amount</th>
                <th className="px-4 py-3 font-normal">Status</th>
                <th className="hidden px-4 py-3 font-normal md:table-cell">Date</th>
              </tr>
            </thead>
            <tbody>
              {payouts.data.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">{accountName(p.account_id)}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground tabular sm:table-cell">{p.invoice_id.toUpperCase()}</td>
                  <td className="px-4 py-3 text-right tabular">{formatKesCents(p.amount_kes_cents)}</td>
                  <td className="px-4 py-3"><StatusChip status={p.status} /></td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{formatDateTime(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
