import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowUpRight, Inbox, Phone } from "lucide-react";
import { MoneyText } from "@/components/stawi/MoneyText";
import { Timeline } from "@/components/stawi/Timeline";
import { EmptyState } from "@/components/stawi/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { PayoutRow } from "@/features/farmer/PayoutRow";
import { accountOptions, accountTxnsOptions, balanceOptions } from "@/lib/queries";
import { useAccountId } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { formatDateTime, formatKesCents } from "@/lib/format";

export const Route = createFileRoute("/app/home")({
  head: () => ({
    meta: [
      { title: "Home — Stawi" },
      { name: "description", content: "Your Stawi balance and the latest payments on the way to you." },
      { property: "og:title", content: "Home — Stawi" },
      { property: "og:description", content: "Your Stawi balance and the latest payments on the way to you." },
    ],
  }),
  component: HomeTab,
});

function HomeTab() {
  const { t } = useI18n();
  const accountId = useAccountId();
  const account = useQuery(accountOptions(accountId));
  const balance = useQuery(balanceOptions(accountId));
  const txns = useQuery(accountTxnsOptions(accountId));

  const latest = txns.data?.find((p) => p.kind === "credit");
  const incoming = txns.data?.filter((p) => p.status === "pending" || p.status === "sent") ?? [];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Habari, {account.data?.full_name.split(" ")[0] ?? "…"}
      </p>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="motif grain relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-lift"
      >
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{t("home.available")}</p>
        {balance.data ? (
          <MoneyText cents={balance.data.balance_kes_cents} countUp className="text-display mt-2 block text-4xl text-lime" />
        ) : (
          <Skeleton className="mt-3 h-10 w-48" />
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          {t("home.incoming")}:{" "}
          <span className="text-foreground tabular">
            {balance.data ? formatKesCents(balance.data.incoming_kes_cents) : "…"}
          </span>
        </p>
        {(balance.data?.demo_balance_kes_cents ?? 0) > 0 && (
          <p className="mt-1 text-sm text-amber">
            Sample {formatKesCents(balance.data?.demo_balance_kes_cents ?? 0)} · not included when you withdraw
          </p>
        )}
        {(balance.data?.demo_balance_kes_cents ?? 0) > 0 && (
          <p className="mt-1 text-sm text-amber">
            Sample {formatKesCents(balance.data?.demo_balance_kes_cents ?? 0)} · not included when you withdraw
          </p>
        )}
        <Link
          to="/app/withdraw"
          className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("home.withdraw")} <ArrowUpRight className="size-4" />
        </Link>
      </motion.section>

      {account.data?.channel_capability === "webapp+ussd" && (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <Phone className="size-5 text-sage" />
          <div className="text-sm">
            <p className="font-medium">{t("home.phoneAccess")}</p>
            <p className="text-xs text-muted-foreground">{t("home.dial", { code: "*384*72#" })}</p>
          </div>
        </div>
      )}

      {latest && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-medium">{t("home.latestPayout")}</h2>
          <Timeline
            steps={[
              { label: "Buyer paid the co-op", state: "done" },
              { label: "Converted to KES", state: "done" },
              { label: "Your share calculated", detail: formatKesCents(latest.amount_kes_cents), state: "done" },
              {
                label: "In your Stawi balance",
                at: formatDateTime(latest.created_at),
                state: latest.status === "confirmed" ? "done" : latest.status === "failed" ? "failed" : "active",
              },
            ]}
          />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium">{t("home.incomingList")}</h2>
        {txns.isLoading ? (
          <Skeleton className="h-16 w-full rounded-2xl" />
        ) : incoming.length === 0 ? (
          <EmptyState icon={Inbox} title={t("home.noIncoming")} description="When a buyer pays your co-op, your share appears here." />
        ) : (
          <div className="space-y-2">
            {incoming.map((p) => (
              <PayoutRow key={p.id} payout={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
