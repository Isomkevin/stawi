import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ListOrdered, Search } from "lucide-react";
import { DemoBadge } from "@/components/stawi/DemoDataControl";
import { EmptyState } from "@/components/stawi/EmptyState";
import { StatusChip } from "@/components/stawi/StatusChip";
import { Timeline } from "@/components/stawi/Timeline";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { PayoutRow, payoutTitle } from "@/features/farmer/PayoutRow";
import { accountTxnsOptions } from "@/lib/queries";
import { useAccountId } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { dayLabel, formatDateTime, formatKesCents } from "@/lib/format";
import type { Payout } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/activity")({
  head: () => ({
    meta: [
      { title: "Activity — Stawi" },
      { name: "description", content: "Every payment in and out of your Stawi account." },
      { property: "og:title", content: "Activity — Stawi" },
      { property: "og:description", content: "Every payment in and out of your Stawi account." },
    ],
  }),
  component: ActivityTab,
});

type Filter = "all" | "paid" | "pending" | "failed";

function ActivityTab() {
  const { t } = useI18n();
  const accountId = useAccountId();
  const txns = useQuery(accountTxnsOptions(accountId));
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Payout | null>(null);

  const groups = useMemo(() => {
    const list = (txns.data ?? []).filter((p) => {
      if (filter === "paid" && p.status !== "confirmed") return false;
      if (filter === "pending" && !["pending", "sent"].includes(p.status)) return false;
      if (filter === "failed" && p.status !== "failed") return false;
      return !q || payoutTitle(p).toLowerCase().includes(q.toLowerCase()) || p.invoice_id.includes(q);
    });
    const map = new Map<string, Payout[]>();
    list.forEach((p) => {
      const k = dayLabel(p.created_at);
      map.set(k, [...(map.get(k) ?? []), p]);
    });
    return [...map.entries()];
  }, [txns.data, filter, q]);

  return (
    <div className="space-y-5">
      <h1 className="text-display text-2xl">{t("activity.title")}</h1>
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("activity.search")} className="h-11 pl-9" />
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {(["all", "paid", "pending", "failed"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "min-h-10 rounded-full border px-4 text-sm",
              filter === f ? "border-lime bg-lime/15 text-lime" : "border-border text-muted-foreground",
            )}
          >
            {t(`activity.${f}`)}
          </button>
        ))}
      </div>

      {txns.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={ListOrdered} title={t("activity.empty")} description="Try another filter." />
      ) : (
        groups.map(([day, items]) => (
          <section key={day}>
            <h2 className="mb-2 text-xs tracking-wide text-muted-foreground uppercase">{day}</h2>
            <div className="space-y-2">
              {items.map((p) => (
                <PayoutRow key={p.id} payout={p} onClick={() => setSelected(p)} />
              ))}
            </div>
          </section>
        ))
      )}

      <Drawer open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DrawerContent>
          {selected && (
            <div className="mx-auto w-full max-w-lg px-5 pb-8">
              <DrawerHeader className="px-0">
                <DrawerTitle className="text-display text-xl">{payoutTitle(selected)}</DrawerTitle>
              </DrawerHeader>
              <p className="text-display text-3xl text-lime tabular">{formatKesCents(selected.amount_kes_cents)}</p>
              <div className="mt-2 flex items-center gap-2">
                <DemoBadge demo={selected.is_demo} />
                <StatusChip status={selected.status} />
              </div>
              <dl className="mt-5 space-y-2 text-sm">
                <Row k="Reference" v={selected.id.toUpperCase()} />
                <Row k="Invoice" v={selected.invoice_id.toUpperCase()} />
                <Row k="Date" v={formatDateTime(selected.created_at)} />
                <Row k="Fees" v={selected.kind === "credit" ? "0.8% taken before your share" : "No fee"} />
              </dl>
              <Timeline
                className="mt-6"
                steps={
                  selected.kind === "credit"
                    ? [
                        { label: "Buyer paid", state: "done" },
                        { label: "Converted to KES", state: "done" },
                        {
                          label: "Credited to your balance",
                          state: selected.status === "failed" ? "failed" : selected.status === "confirmed" ? "done" : "active",
                        },
                      ]
                    : [
                        { label: "Withdrawal requested", state: "done" },
                        {
                          label: "Sent to M-Pesa",
                          state: selected.status === "failed" ? "failed" : selected.status === "confirmed" ? "done" : "active",
                        },
                      ]
                }
              />
              {selected.status === "failed" && (
                <p className="mt-4 rounded-xl border border-terracotta/40 bg-terracotta/10 p-3 text-sm text-terracotta">
                  This payment could not reach your M-Pesa. Your co-op treasurer has been told and will retry.
                </p>
              )}
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border pb-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right tabular">{v}</dd>
    </div>
  );
}
