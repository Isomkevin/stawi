import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Leaf,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, formatKesCents } from "@/lib/format";
import { invoiceDetailOptions, accountOptions, coopOptions, coopMembersOptions } from "@/features/buyer/queries";
import { PayazaCheckout } from "@/components/stawi/Checkout";
import { StatusChip } from "@/components/stawi/StatusChip";
import { Timeline, type TimelineStep } from "@/components/stawi/Timeline";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pay/$invoiceId")({
  head: () => ({
    meta: [
      { title: "Pay invoice — Stawi" },
      {
        name: "description",
        content: "Review and pay your Stawi export invoice. Funds convert at a live rate and reach every farmer the same day.",
      },
      { property: "og:title", content: "Pay invoice — Stawi" },
      {
        property: "og:description",
        content: "Secure cross-border payment with a transparent fee and same-day farmer payouts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(invoiceDetailOptions(params.invoiceId)),
  component: PayPage,
});

type Phase = "idle" | "checkout" | "declined";

function PayPage() {
  const { invoiceId } = Route.useParams();
  const { data } = useSuspenseQuery(invoiceDetailOptions(invoiceId));
  const invoice = data.invoice;

  const coopId = invoice.coop_id;
  const accountId = invoice.account_id;
  const coop = useSuspenseQuery({
    ...coopOptions(coopId ?? "none"),
    enabled: Boolean(coopId),
  }).data;
  const members = useSuspenseQuery({
    ...coopMembersOptions(coopId ?? "none"),
    enabled: Boolean(coopId),
  }).data;
  const payeeAccount = useSuspenseQuery({
    ...accountOptions(accountId ?? "none"),
    enabled: Boolean(accountId),
  }).data;

  const payeeName = coop?.name ?? payeeAccount?.full_name ?? "Stawi exporter";

  if (invoice.status === "pending" && invoice.due_at && new Date(invoice.due_at) < new Date()) {
    return (
      <Shell payeeName={payeeName} invoice={invoice}>
        <StatePanel
          icon={Clock3}
          tone="text-amber"
          title="This payment link has expired"
          body={`The due date was ${formatDate(invoice.due_at)}. Ask ${payeeName} to issue a fresh invoice.`}
        />
      </Shell>
    );
  }

  if (invoice.status === "failed") {
    return (
      <Shell payeeName={payeeName} invoice={invoice}>
        <StatePanel
          icon={XCircle}
          tone="text-terracotta"
          title="Payment failed"
          body="The last attempt didn't go through. You can try again, or contact the seller if the problem persists."
        />
      </Shell>
    );
  }

  const settled = invoice.status !== "pending";

  return (
    <Shell payeeName={payeeName} invoice={invoice}>
      {settled ? (
        <ReceiptView
          invoice={invoice}
          payeeName={payeeName}
          farmerCount={coopId ? (members?.length ?? 0) : null}
          transactions={data.transactions}
        />
      ) : (
        <UnpaidView
          invoice={invoice}
          payeeName={payeeName}
          farmerCount={coopId ? (members?.length ?? 0) : null}
        />
      )}
    </Shell>
  );
}

function UnpaidView({
  invoice,
  payeeName,
  farmerCount,
}: {
  invoice: ReturnType<typeof getInvoiceOf>;
  payeeName: string;
  farmerCount: number | null;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const queryClient = useQueryClient();
  const pay = useMutation({
    mutationFn: () => api.simulatePayment(invoice.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(["invoice", invoice.id], {
        invoice: updated,
        transactions: [],
      });
      queryClient.invalidateQueries({ queryKey: ["invoice", invoice.id] });
      setPhase("idle");
    },
  });

  const feeKes = invoice.fee_kes_cents;
  const kesGross =
    invoice.kes_total_cents != null && feeKes != null ? invoice.kes_total_cents + feeKes : null;

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-2xl border border-border bg-card p-6 shadow-soft"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs tracking-wide text-muted-foreground uppercase">Amount due</p>
            <p className="text-display mt-1 text-4xl tabular">
              {formatCurrency(invoice.amount, invoice.currency)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {invoice.description} · ref {invoice.reference}
            </p>
          </div>
          <StatusChip status={invoice.status} />
        </div>

        <dl className="mt-6 space-y-3 border-t border-border pt-4 text-sm">
          <Row
            label="Converted at"
            value={
              invoice.fx_rate
                ? `1 ${invoice.currency} = KES ${invoice.fx_rate.toFixed(2)}`
                : "Live rate when you pay"
            }
          />
          <Row
            label="Shilling equivalent"
            value={kesGrosLabel(kesGross)}
            muted={!kesGross}
          />
          <Row
            label="Stawi fee (0.8%)"
            value={feeKes != null ? formatKesCents(feeKes) : "Deducted before payout"}
            muted={feeKes == null}
          />
          <Row
            label="Reaching the seller"
            value={invoice.kes_total_cents != null ? formatKesCents(invoice.kes_total_cents) : "Confirmed at payment"}
            muted={invoice.kes_total_cents == null}
            accent={invoice.kes_total_cents != null}
          />
        </dl>
      </motion.section>

      {farmerCount != null && farmerCount > 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-lime/25 bg-lime/10 px-4 py-3 text-sm text-lime">
          <BadgeCheck className="size-4 shrink-0" strokeWidth={2} />
          Your payment reaches {farmerCount} farmers directly.
        </p>
      )}

      <WhatHappensNext />

      <Button
        size="lg"
        className="w-full min-h-[52px] text-base"
        disabled={pay.isPending}
        onClick={() => setPhase("checkout")}
      >
        Pay {formatCurrency(invoice.amount, invoice.currency)} securely
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Card and bank transfer · run by our payment partner
      </p>

      <PayazaCheckout
        open={phase === "checkout"}
        onOpenChange={(open) => !open && setPhase("idle")}
        amountLabel={formatCurrency(invoice.amount, invoice.currency)}
        payee={payeeName}
        reference={invoice.reference}
        onApproved={() => pay.mutate()}
        onDeclined={() => {
          setPhase("declined");
        }}
      />

      {phase === "declined" && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta"
        >
          <XCircle className="size-4 shrink-0" strokeWidth={2} />
          The payment was declined. No money has moved — you can try again.
        </p>
      )}
      {pay.isPending && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" strokeWidth={2} />
          Confirming your payment…
        </p>
      )}
    </div>
  );
}

function kesGrosLabel(kesGross: number | null): string {
  return kesGross != null ? formatKesCents(kesGross) : "Shown when you pay";
}

function ReceiptView({
  invoice,
  payeeName,
  farmerCount,
  transactions,
}: {
  invoice: ReturnType<typeof getInvoiceOf>;
  payeeName: string;
  farmerCount: number | null;
  transactions: ReturnType<typeof getTxnsOf>;
}) {
  const steps: TimelineStep[] = [
    { label: "Payment received", state: "done", detail: `${formatCurrency(invoice.amount, invoice.currency)} · ${payeeName}` },
  ];
  const conversion = transactions.find((t) => t.type === "conversion");
  steps.push({
    label: `Converted to shillings`,
    detail: invoice.fx_rate ? `1 ${invoice.currency} = KES ${invoice.fx_rate.toFixed(2)}` : undefined,
    state: conversion ? (conversion.status === "completed" ? "done" : "active") : "active",
  });
  if (invoice.type === "coop") {
    steps.push({
      label: farmerCount ? `Split across ${farmerCount} farmers` : "Split across members",
      state: invoice.split_approved ? "done" : "todo",
ecord      });
  }
  steps.push({
    label: invoice.type === "coop" ? "M-Pesa payouts sent" : "Payout to bank account",
    state:
      invoice.status === "completed"
        ? "done"
        : invoice.status === "settling"
          ? "active"
          : "todo",
  });

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-2xl border border-border bg-card p-6 text-center shadow-soft"
      >
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-lime/15">
          <CheckCircle2 className="size-7 text-lime" strokeWidth={2} />
        </span>
        <h2 className="text-display mt-4 text-2xl">
          {invoice.status === "completed" ? "Payment complete" : "Payment received"}
        </h2>
        <p className="text-display mt-1 text-4xl text-lime tabular">
          {formatCurrency(invoice.amount, invoice.currency)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Paid {formatDate(invoice.created_at)} · receipt {invoice.payaza_checkout_reference ?? invoice.reference}
        </p>
        {invoice.kes_total_cents != null && (
          <p className="mt-1 text-sm text-muted-foreground tabular">
            {formatKesCents(invoice.kes_total_cents)} to the seller after the 0.8% fee
          </p>
        )}
        {farmerCount != null && farmerCount > 0 && (
          <p className="mt-3 text-sm text-lime">
            Your payment reaches {farmerCount} farmers directly.
          </p>
        )}
      </motion.section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h3 className="text-display text-lg">Live payout tracker</h3>
        <Timeline steps={steps} className="mt-5" />
      </section>

      <Button asChild variant="outline" className="w-full min-h-[48px] border-border bg-transparent">
        <Link to="/">
          <ArrowLeft className="size-4" strokeWidth={2} />
          Back to Stawi
        </Link>
      </Button>
    </div>
  );
}

function WhatHappensNext() {
  const steps = ["Payment received", "Converted to KES", "Split by contribution", "Same-day M-Pesa"];
  return (
    <section>
      <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        What happens next
      </h3>
      <ol className="mt-3 grid gap-2 sm:grid-cols-4">
        {steps.map((step, i) => (
          <li
            key={step}
            className="rounded-xl border border-border bg-card/70 px-3 py-2.5 text-xs text-muted-foreground"
          >
            <span className="text-lime tabular">{i + 1}.</span> {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

function StatePanel({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: typeof Clock3;
  tone: string;
  title: string;
  body: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card p-8 text-center shadow-soft"
    >
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-secondary">
        <Icon className={`size-7 ${tone}`} strokeWidth={2} />
      </span>
      <h2 className="text-display mt-4 text-2xl">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>
      <Button asChild variant="outline" className="mt-6 min-h-[44px] border-border bg-transparent">
        <Link to="/">Back to Stawi</Link>
      </Button>
    </motion.section>
  );
}

function Row({
  label,
  value,
  muted,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`tabular ${accent ? "text-lime" : muted ? "text-muted-foreground" : "text-foreground"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Shell({
  payeeName,
  invoice,
  children,
}: {
  payeeName: string;
  invoice: { buyer_name: string; reference: string };
  children: React.ReactNode;
}) {
  return (
    <div className="motif min-h-screen bg-background px-4 py-10 text-foreground sm:py-14">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-lime">
              <Leaf className="size-4 text-[oklch(0.22_0.035_152)]" strokeWidth={2} />
            </span>
            <span className="text-display text-xl">Stawi</span>
          </Link>
          <Link
            to="/"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Powered by Stawi
          </Link>
        </div>

        <div className="mb-6">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">You're paying</p>
          <h1 className="text-display mt-1 flex items-center gap-2 text-2xl">
            {payeeName}
            <BadgeCheck className="size-5 text-lime" strokeWidth={2} aria-label="Verified seller" />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invoice to {invoice.buyer_name} · ref {invoice.reference}
          </p>
        </div>

        {children}
      </div>
    </div>
  );
}
