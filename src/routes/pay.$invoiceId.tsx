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
import { useState, type ReactNode } from "react";
import { api, isMock } from "@/lib/api";
import type { Invoice, InvoiceDetail, Transaction } from "@/lib/types";
import { ApiError } from "@/lib/types";
import { formatCurrency, formatDate, formatKesCents } from "@/lib/format";
import { invoiceDetailOptions } from "@/features/buyer/queries";
import { openPayazaCheckout } from "@/lib/payazaWidget";
import { PayazaCheckout } from "@/components/stawi/Checkout";
import { DemoBadge } from "@/components/stawi/DemoDataControl";
import { StatusChip } from "@/components/stawi/StatusChip";
import { Timeline, type TimelineStep } from "@/components/stawi/Timeline";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PaymentReceiptCard } from "@/features/shared/PaymentReceiptCard";
import {
  PAY_CURRENCIES,
  checkoutAmount,
  defaultPayCurrency,
  formatKesRate,
  formatPayAmount,
  kesPerUnit,
  type PayCurrency,
} from "@/lib/payCurrencies";

export const Route = createFileRoute("/pay/$invoiceId")({
  head: () => ({
    meta: [
      { title: "Pay invoice — Stawi" },
      {
        name: "description",
        content:
          "Review and pay your Stawi export invoice. Funds convert at a live rate and reach every farmer the same day.",
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

  const payeeName = data.payee_name ?? "Stawi seller";
  const farmerCount = data.farmer_count ?? null;
  const [payCurrency, setPayCurrency] = useState<PayCurrency>(() =>
    defaultPayCurrency(invoice.currency),
  );
  const expired =
    invoice.status === "pending" && !!invoice.due_at && new Date(invoice.due_at) < new Date();
  const payIn =
    invoice.status === "pending" && !expired ? (
      <PayInSelect value={payCurrency} onChange={setPayCurrency} />
    ) : null;

  if (expired && invoice.due_at) {
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
    <Shell payeeName={payeeName} invoice={invoice} payIn={payIn}>
      {settled ? (
        <ReceiptView
          invoice={invoice}
          payeeName={payeeName}
          farmerCount={farmerCount}
          transactions={data.transactions}
        />
      ) : (
        <UnpaidView
          invoice={invoice}
          payeeName={payeeName}
          farmerCount={farmerCount}
          payCurrency={payCurrency}
        />
      )}
    </Shell>
  );
}

function PayInSelect({
  value,
  onChange,
}: {
  value: PayCurrency;
  onChange: (currency: PayCurrency) => void;
}) {
  return (
    <label className="flex flex-col items-end gap-1 text-[10px] tracking-wide text-muted-foreground uppercase">
      Pay in
      <Select value={value} onValueChange={(next) => onChange(next as PayCurrency)}>
        <SelectTrigger aria-label="Pay in" className="h-9 w-[5.75rem] bg-card">
          <SelectValue>{value}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {PAY_CURRENCIES.map((code) => (
            <SelectItem key={code} value={code}>
              {code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function UnpaidView({
  invoice,
  payeeName,
  farmerCount,
  payCurrency,
}: {
  invoice: Invoice;
  payeeName: string;
  farmerCount: number | null;
  payCurrency: PayCurrency;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [payError, setPayError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const demoBlocked = !isMock && invoice.is_demo === true;
  const pay = useMutation({
    mutationFn: async (): Promise<{ invoice: Invoice | null; declined?: boolean }> => {
      if (isMock) return { invoice: await api.simulatePayment(invoice.id) };

      const session = await api.createCheckoutSession(invoice.id, payCurrency);
      const outcome = await openPayazaCheckout({
        session,
        amount: session.checkout_amount,
        currency: session.currency_code,
        buyerName: invoice.buyer_name,
        buyerEmail: invoice.buyer_email,
        buyerPhone: invoice.buyer_phone,
        invoiceId: invoice.id,
      });
      if (outcome === "redirect" || outcome === "closed") return { invoice: null };
      if (outcome === "declined") return { invoice: null, declined: true };

      for (let attempt = 0; attempt < 15; attempt += 1) {
        const detail = await api.getInvoice(invoice.id);
        if (detail.invoice.status !== "pending") return { invoice: detail.invoice };
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
      throw new ApiError(202, "Payment is with your bank. Refresh this page in a moment.");
    },
    onSuccess: (result) => {
      const updated = result.invoice;
      if (result.declined) {
        setPhase("declined");
        setPayError(null);
        return;
      }
      if (!updated) return;
      queryClient.setQueryData(["invoice", invoice.id], (current: InvoiceDetail | undefined) => ({
        invoice: updated,
        transactions: current?.transactions ?? [],
        split_preview: current?.split_preview ?? null,
        payee_name: current?.payee_name,
        farmer_count: current?.farmer_count,
      }));
      queryClient.invalidateQueries({ queryKey: ["invoice", invoice.id] });
      setPhase("idle");
      setPayError(null);
    },
    onError: (err) => {
      setPhase("idle");
      setPayError(err instanceof ApiError ? err.message : "Payment could not be started");
    },
  });

  const due = checkoutAmount(invoice.amount, invoice.currency, payCurrency);
  const dueLabel = formatPayAmount(due, payCurrency);
  const kesGross = Math.round(invoice.amount * kesPerUnit(invoice.currency) * 100);
  const feeKes = Math.round(kesGross * 0.008);
  const sellerKes = kesGross - feeKes;

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
            <p className="text-display mt-1 text-4xl tabular">{dueLabel}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {invoice.description} · ref {invoice.reference}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <DemoBadge demo={invoice.is_demo} />
            <StatusChip status={invoice.status} />
          </div>
        </div>

        <dl className="mt-6 space-y-3 border-t border-border pt-4 text-sm">
          <Row label="Converted at" value={formatKesRate(payCurrency)} />
          <Row label="Shilling equivalent" value={formatKesCents(kesGross)} />
          <Row label="Stawi fee (0.8%)" value={formatKesCents(feeKes)} />
          <Row label="Reaching the seller" value={formatKesCents(sellerKes)} accent />
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
        disabled={pay.isPending || demoBlocked}
        onClick={() => {
          setPayError(null);
          if (isMock) setPhase("checkout");
          else pay.mutate();
        }}
      >
        Pay {dueLabel} securely
      </Button>
      <Button size="lg" variant="outline" className="w-full min-h-[52px] text-base" disabled>
        Pay via stablecoins
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Stablecoin payments are not available yet. Card and bank transfer run through our payment
        partners.
      </p>

      <PayazaCheckout
        open={phase === "checkout"}
        onOpenChange={(open) => !open && setPhase("idle")}
        amountLabel={dueLabel}
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
      {payError && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta"
        >
          <XCircle className="size-4 shrink-0" strokeWidth={2} />
          {payError}
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

function ReceiptView({
  invoice,
  payeeName,
  farmerCount,
  transactions,
}: {
  invoice: Invoice;
  payeeName: string;
  farmerCount: number | null;
  transactions: Transaction[];
}) {
  const steps: TimelineStep[] = [
    {
      label: "Payment received",
      state: "done",
      detail: `${formatCurrency(invoice.amount, invoice.currency)} · ${payeeName}`,
    },
  ];
  const conversion = transactions.find((t) => t.type === "conversion");
  steps.push({
    label: `Converted to shillings`,
    ...(invoice.fx_rate
      ? { detail: `1 ${invoice.currency} = KES ${invoice.fx_rate.toFixed(2)}` }
      : {}),
    state: conversion ? (conversion.status === "completed" ? "done" : "active") : "active",
  });
  if (invoice.type === "coop") {
    steps.push({
      label: farmerCount ? `Split across ${farmerCount} farmers` : "Split across members",
      state: invoice.split_approved ? "done" : "todo",
    });
  }
  steps.push({
    label: invoice.type === "coop" ? "M-Pesa payouts sent" : "Payout to bank account",
    state:
      invoice.status === "completed" ? "done" : invoice.status === "settling" ? "active" : "todo",
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
          Paid {formatDate(invoice.created_at)} · receipt{" "}
          {invoice.payaza_checkout_reference ?? invoice.reference}
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

      {invoice.status !== "failed" && <PaymentReceiptCard invoiceId={invoice.id} />}

      <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h3 className="text-display text-lg">Live payout tracker</h3>
        <Timeline steps={steps} className="mt-5" />
      </section>

      <Button
        asChild
        variant="outline"
        className="w-full min-h-[48px] border-border bg-transparent"
      >
        <Link to="/">
          <ArrowLeft className="size-4" strokeWidth={2} />
          Back to Stawi
        </Link>
      </Button>
    </div>
  );
}

function WhatHappensNext() {
  const steps = [
    "Payment received",
    "Converted to KES",
    "Split by contribution",
    "Same-day Payout",
  ];
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
  payIn,
  children,
}: {
  payeeName: string;
  invoice: { buyer_name: string; reference: string; is_demo?: boolean | undefined };
  payIn?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="motif min-h-screen bg-background px-4 py-10 text-foreground sm:py-14">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8 flex items-start justify-between gap-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-lime">
              <Leaf className="size-4 text-[oklch(0.22_0.035_152)]" strokeWidth={2} />
            </span>
            <span className="text-display text-xl">Stawi</span>
          </Link>
          <div className="flex flex-col items-end gap-1.5">
            {payIn}
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
              Powered by Stawi
            </Link>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">You're paying</p>
          <h1 className="text-display mt-1 flex items-center gap-2 text-2xl">
            {payeeName}
            <BadgeCheck className="size-5 text-lime" strokeWidth={2} aria-label="Verified seller" />
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Invoice to {invoice.buyer_name} · ref {invoice.reference}
            <DemoBadge demo={invoice.is_demo} />
          </p>
          {invoice.is_demo && (
            <p className="mt-3 rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm text-amber">
              Sample invoice. A live Payaza checkout is not started from this record.
            </p>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}
