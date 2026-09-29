import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowLeft, Check, Smartphone, Landmark } from "lucide-react";
import { PinPad } from "@/components/stawi/PinPad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { accountOptions, balanceOptions } from "@/lib/queries";
import { useAccountId } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { formatKesCents, maskDestination } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/withdraw")({
  head: () => ({
    meta: [
      { title: "Withdraw — Stawi" },
      { name: "description", content: "Send your Stawi balance to M-Pesa or your bank." },
      { property: "og:title", content: "Withdraw — Stawi" },
      { property: "og:description", content: "Send your Stawi balance to M-Pesa or your bank." },
    ],
  }),
  component: WithdrawTab,
});

type Step = "destination" | "amount" | "review" | "pin" | "success";

function WithdrawTab() {
  const { t } = useI18n();
  const accountId = useAccountId();
  const qc = useQueryClient();
  const account = useQuery(accountOptions(accountId));
  const balance = useQuery(balanceOptions(accountId));
  const [step, setStep] = useState<Step>("destination");
  const [destId, setDestId] = useState<string | null>(null);
  const [kes, setKes] = useState("");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [idem] = useState(() => crypto.randomUUID());

  const available = balance.data?.balance_kes_cents ?? 0;
  const cents = Math.round(Number(kes || 0) * 100);
  const dest = account.data?.payout_destinations.find((d) => d.id === destId);
  const tooMuch = cents > available;

  const withdraw = useMutation({
    mutationFn: () =>
      api.withdraw(accountId, { destination_id: destId!, amount_kes_cents: cents, pin, idempotency_key: idem }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["account", accountId] });
      setStep("success");
    },
    onError: (e) => {
      setPin("");
      if (e instanceof ApiError && e.code === "locked") {
        setLocked(true);
        setPinError(t("withdraw.tooMany"));
      } else if (e instanceof ApiError && e.code === "wrong") {
        setPinError(t("withdraw.wrongPin", { attempts: e.attemptsLeft ?? 0 }));
      } else if (e instanceof ApiError && e.status === 400) {
        setPinError(t("withdraw.insufficient"));
      } else {
        setPinError("Something went wrong. Your money is safe — please try again.");
      }
    },
  });

  useEffect(() => {
    if (step === "pin" && pin.length === 4 && !withdraw.isPending && !locked) withdraw.mutate();
  }, [pin, step, withdraw, locked]);

  const back = () =>
    setStep((s) => (s === "amount" ? "destination" : s === "review" ? "amount" : s === "pin" ? "review" : s));

  return (
    <div>
      {step !== "destination" && step !== "success" && (
        <button type="button" onClick={back} className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" /> {t("withdraw.back")}
        </button>
      )}
      <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
        {step === "destination" && (
          <section className="space-y-4">
            <h1 className="text-display text-2xl">{t("withdraw.chooseDestination")}</h1>
            <p className="text-sm text-muted-foreground">{t("withdraw.available", { amount: formatKesCents(available) })}</p>
            {(balance.data?.demo_balance_kes_cents ?? 0) > 0 && (
              <p className="text-sm text-amber">
                Sample funds ({formatKesCents(balance.data?.demo_balance_kes_cents ?? 0)}) are not included in this payout.
              </p>
            )}
            {account.data?.payout_destinations.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setDestId(d.id);
                  setStep("amount");
                }}
                className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left hover:border-lime"
              >
                {d.type !== "bank" ? <Smartphone className="size-5 text-lime" /> : <Landmark className="size-5 text-sage" />}
                <span className="flex-1">
                  <span className="block text-sm font-medium">{d.type === "mpesa" ? "M-Pesa" : d.type === "momo" ? "Mobile money" : "Bank"} · {maskDestination(d.details)}</span>
                  <span className="text-xs text-muted-foreground">{d.account_name}{!d.is_verified && " · not verified yet"}</span>
                </span>
              </button>
            ))}
          </section>
        )}

        {step === "amount" && (
          <section className="space-y-4">
            <h1 className="text-display text-2xl">{t("withdraw.amount")}</h1>
            <p className="text-sm text-muted-foreground">{t("withdraw.available", { amount: formatKesCents(available) })}</p>
            {(balance.data?.demo_balance_kes_cents ?? 0) > 0 && (
              <p className="text-sm text-amber">
                Sample funds ({formatKesCents(balance.data?.demo_balance_kes_cents ?? 0)}) are not included in this payout.
              </p>
            )}
            <div className="relative">
              <span className="absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground">KES</span>
              <Input
                inputMode="decimal"
                value={kes}
                onChange={(e) => setKes(e.target.value.replace(/[^\d.]/g, ""))}
                className="text-display h-16 pl-16 text-2xl tabular"
                aria-label="Amount in KES"
              />
            </div>
            <div className="flex gap-2">
              {[
                { l: "25%", v: 0.25 },
                { l: "50%", v: 0.5 },
                { l: t("withdraw.all"), v: 1 },
              ].map((c) => (
                <button
                  key={c.l}
                  type="button"
                  onClick={() => setKes((Math.floor(available * c.v) / 100).toFixed(2))}
                  className="min-h-11 flex-1 rounded-full border border-border text-sm hover:border-lime"
                >
                  {c.l}
                </button>
              ))}
            </div>
            {tooMuch && <p role="alert" className="text-sm text-terracotta">{t("withdraw.insufficient")}</p>}
            <Button className="h-12 w-full" disabled={cents <= 0 || tooMuch} onClick={() => setStep("review")}>
              {t("withdraw.continue")}
            </Button>
          </section>
        )}

        {step === "review" && dest && (
          <section className="space-y-4">
            <h1 className="text-display text-2xl">{t("withdraw.review")}</h1>
            <div className="space-y-3 rounded-2xl border border-border bg-card p-5 text-sm">
              <Line k="Amount" v={formatKesCents(cents)} strong />
              <Line k="To" v={`${dest.type === "mpesa" ? "M-Pesa" : dest.type === "momo" ? "Mobile money" : "Bank"} ${maskDestination(dest.details)}`} />
              <Line k="Name" v={dest.account_name} />
              <Line k="Fee" v="Free" />
              <Line k="Arrives" v="Within minutes" />
            </div>
            <Button className="h-12 w-full" onClick={() => setStep("pin")}>
              {t("withdraw.continue")}
            </Button>
          </section>
        )}

        {step === "pin" && (
          <section className="flex flex-col items-center space-y-4 text-center">
            <h1 className="text-display text-2xl">{t("withdraw.pin")}</h1>
            <p className="text-sm text-muted-foreground">Demo PIN: 1234</p>
            <PinPad
              value={pin}
              onChange={(v) => {
                if (locked) return;
                setPinError(null);
                setPin(v);
              }}
              error={pinError}
            />
            {withdraw.isPending && <p className="text-sm text-muted-foreground">Sending…</p>}
          </section>
        )}

        {step === "success" && (
          <section className="flex flex-col items-center py-10 text-center">
            <motion.span
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              className="grid size-20 place-items-center rounded-full bg-lime text-primary-foreground"
            >
              <Check className="size-10" strokeWidth={2.5} />
            </motion.span>
            <h1 className="text-display mt-6 text-3xl">{t("withdraw.success")}</h1>
            <p className="mt-2 text-muted-foreground tabular">
              {formatKesCents(cents)} → {dest ? maskDestination(dest.details) : ""}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">You'll get an M-Pesa message shortly.</p>
            <Link to="/app/home" className="mt-8 inline-flex min-h-12 items-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground">
              Done
            </Link>
          </section>
        )}
      </motion.div>
    </div>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("text-right tabular", strong && "text-display text-lg text-lime")}>{v}</span>
    </div>
  );
}
