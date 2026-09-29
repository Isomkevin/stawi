import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { motion } from "motion/react";
import { z } from "zod";
import { BadgeCheck, Leaf, Loader2 } from "lucide-react";
import { PinPad } from "@/components/stawi/PinPad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { homeForRole, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const search = z.object({
  coop: z.string().optional(),
  share: z.coerce.number().optional(),
  phone: z.string().optional(),
});

export const Route = createFileRoute("/onboarding")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "Create your account — Stawi" },
      { name: "description", content: "Set up Stawi in four quick steps and start getting paid same day." },
      { property: "og:title", content: "Create your account — Stawi" },
      { property: "og:description", content: "Set up Stawi in four quick steps and start getting paid same day." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Onboarding,
});

const steps = ["Who you are", "Where money goes", "Your PIN", "How you'll use Stawi"];

function Onboarding() {
  const invite = Route.useSearch();
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [idNo, setIdNo] = useState("");
  const [phone, setPhone] = useState(invite.phone ?? "+2547");
  const [destType, setDestType] = useState<"mpesa" | "bank">("mpesa");
  const [details, setDetails] = useState(invite.phone ?? "");
  const [resolved, setResolved] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [ussd, setUssd] = useState(true);

  const nameCheck = useMutation({
    mutationFn: () => api.resolveAccountName(destType, details),
    onSuccess: (n) => setResolved(n === "Pending name check" ? null : n),
  });

  const create = useMutation({
    mutationFn: () =>
      api.createAccount({
        full_name: name,
        phone_number: phone,
        id_number: idNo,
        pin,
        destination: { type: destType, details, account_name: resolved ?? name },
        ussd,
        coop_id: invite.coop ? "coop_kiambu" : undefined,
      }),
    onSuccess: (acc) => {
      if (acc.roles && acc.roles.length === 0) {
        setPinErr("This number isn't mapped to an account type yet.");
        return;
      }
      const role = acc.role ?? "farmer";
      const roles = acc.roles?.length ? acc.roles : [role];
      signIn(role, { accountId: acc.id, coopId: acc.coop_id, token: acc.token, roles });
      void navigate({ to: homeForRole[role] });
    },
  });

  const valid0 = name.trim().length > 2 && /^\d{6,10}$/.test(idNo) && /^\+2547\d{8}$/.test(phone);

  return (
    <div className="motif grain min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-lime">
            <Leaf className="size-4 text-primary-foreground" />
          </span>
          <span className="text-display text-xl">Stawi</span>
        </div>
        {invite.coop && (
          <div className="mb-4 rounded-2xl border border-lime/40 bg-lime/10 p-4 text-sm">
            You've been invited to join <strong>{invite.coop}</strong>
            {invite.share ? ` with a ${invite.share}% share` : ""}.
          </div>
        )}
        <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s} className={cn("h-1.5 rounded-full", i <= step ? "bg-lime" : "bg-border")} aria-current={i === step} />
          ))}
        </ol>
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card p-6 shadow-lift"
        >
          <p className="text-xs tracking-wide text-muted-foreground uppercase">Step {step + 1} of 4</p>
          <h1 className="text-display mt-1 text-2xl">{steps[step]}</h1>

          {step === 0 && (
            <div className="mt-5 space-y-4">
              <Field id="name" label="Full name" value={name} onChange={setName} />
              <Field id="id" label="National ID number" value={idNo} onChange={(v) => setIdNo(v.replace(/\D/g, ""))} inputMode="numeric" />
              <Field id="phone" label="Phone number" value={phone} onChange={setPhone} inputMode="tel" hint="Format: +2547XXXXXXXX" />
              <Button className="h-12 w-full" disabled={!valid0} onClick={() => setStep(1)}>Continue</Button>
            </div>
          )}

          {step === 1 && (
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {(["mpesa", "bank"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setDestType(t);
                      setResolved(null);
                      nameCheck.reset();
                    }}
                    className={cn("min-h-11 rounded-xl border text-sm", destType === t ? "border-lime bg-lime/15 text-lime" : "border-border")}
                  >
                    {t === "mpesa" ? "M-Pesa" : "Bank account"}
                  </button>
                ))}
              </div>
              <Field
                id="dest"
                label={destType === "mpesa" ? "M-Pesa number" : "Bank account number"}
                value={details}
                onChange={(v) => {
                  setDetails(v);
                  setResolved(null);
                  nameCheck.reset();
                }}
                inputMode="numeric"
              />
              {resolved ? (
                <p className="flex items-center gap-2 rounded-xl border border-lime/40 bg-lime/10 p-3 text-sm">
                  <BadgeCheck className="size-4 text-lime" /> Registered to <strong>{resolved}</strong>
                </p>
              ) : (
                <Button variant="outline" className="h-11 w-full" disabled={nameCheck.isPending || details.length < 6} onClick={() => nameCheck.mutate()}>
                  {nameCheck.isPending && <Loader2 className="size-4 animate-spin" />} Check account name
                </Button>
              )}
              {(nameCheck.isError || (nameCheck.isSuccess && !resolved)) && (
                <p role="status" className="text-sm text-muted-foreground">
                  We'll use {name.trim()} for this payout account.
                </p>
              )}
              <Button className="h-12 w-full" disabled={details.replace(/\D/g, "").length < 6} onClick={() => setStep(2)}>
                {resolved ? "That's me — continue" : "Continue"}
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="mt-5 flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {pin.length < 4 ? "Choose 4 digits you'll remember." : "Enter it again to confirm."}
              </p>
              <PinPad
                value={pin.length < 4 ? pin : pin2}
                error={pinErr}
                onChange={(v) => {
                  setPinErr(null);
                  if (pin.length < 4) return setPin(v);
                  setPin2(v);
                  if (v.length === 4) {
                    if (v === pin) setStep(3);
                    else {
                      setPinErr("PINs don't match. Start again.");
                      setPin("");
                      setPin2("");
                    }
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">Never share your PIN — Stawi staff will never ask for it.</p>
            </div>
          )}

          {step === 3 && (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-border p-4 text-sm">
                <p className="font-medium">Stawi app</p>
                <p className="text-muted-foreground">Always on — use any smartphone browser.</p>
              </div>
              <label className="flex items-center justify-between gap-4 rounded-xl border border-border p-4 text-sm">
                <span>
                  <span className="font-medium">Basic phone access</span>
                  <span className="block text-muted-foreground">Check balance and withdraw by dialling *384*72#</span>
                </span>
                <Switch checked={ussd} onCheckedChange={setUssd} />
              </label>
              <Button className="h-12 w-full" disabled={create.isPending} onClick={() => create.mutate()}>
                {create.isPending && <Loader2 className="size-4 animate-spin" />} Create my account
              </Button>
            </div>
          )}

          {step > 0 && step < 3 && (
            <button type="button" className="mt-4 min-h-11 text-sm text-muted-foreground" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  hint,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  inputMode?: "numeric" | "tel";
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} inputMode={inputMode} className="h-12" />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
