import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, Leaf, Phone, ShieldCheck } from "lucide-react";
import { homeForRole, useSession } from "@/lib/session";
import type { Role } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Stawi" },
      {
        name: "description",
        content: "Sign in to Stawi with your phone number and a one-time code.",
      },
      { property: "og:title", content: "Sign in — Stawi" },
      { property: "og:description", content: "Phone + one-time-code sign in for Stawi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoginPage,
});

const DEMO_CODE = "123456";

const roleCards: Array<{ role: Exclude<Role, "buyer">; title: string; body: string }> = [
  {
    role: "farmer",
    title: "I'm a farmer",
    body: "See your balance, incoming payments and withdraw to M-Pesa.",
  },
  {
    role: "treasurer",
    title: "I run a co-op",
    body: "Invoice buyers, review splits and release payouts to members.",
  },
  {
    role: "exporter",
    title: "I export directly",
    body: "Invoice buyers and get paid straight to your own account.",
  },
];

function LoginPage() {
  const [step, setStep] = useState<"phone" | "code" | "role">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const { signIn } = useSession();
  const navigate = useNavigate();

  const phoneOk = phone.replace(/\D/g, "").length >= 9;
  const normalized = () => {
    const d = phone.replace(/\D/g, "");
    if (d.startsWith("254")) return `+${d}`;
    if (d.startsWith("0")) return `+254${d.slice(1)}`;
    return `+254${d}`;
  };

  const sendCode = async () => {
    if (!phoneOk) {
      setError("Enter a valid phone number.");
      return;
    }
    setError(null);
    if (isMock) {
      setStep("code");
      return;
    }
    setBusy(true);
    try {
      const r = await api.requestOtp(normalized());
      setDevCode(r.dev_code ?? null);
      setStep("code");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "No Stawi account uses this number." : "Couldn't send the code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    if (isMock) {
      if (code !== DEMO_CODE) {
        setError("That code isn't right. Demo code is 123456.");
        return;
      }
      setStep("role");
      return;
    }
    setBusy(true);
    try {
      const r = await api.verifyOtp(normalized(), code);
      signIn(r.role, { accountId: r.account_id, coopId: r.account.coop_id, token: r.token });
      void navigate({ to: homeForRole[r.role] });
    } catch {
      setError("That code isn't right or has expired.");
    } finally {
      setBusy(false);
    }
  };

  const choose = (role: Exclude<Role, "buyer">) => {
    signIn(role);
    void navigate({ to: homeForRole[role] });
  };

  return (
    <div className="motif grain relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" strokeWidth={2} />
          Back to Stawi
        </Link>

        <motion.div
          key={step}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-border bg-card p-6 shadow-lift sm:p-8"
        >
          <span className="grid size-11 place-items-center rounded-xl bg-lime">
            <Leaf className="size-5 text-[oklch(0.22_0.035_152)]" strokeWidth={2} />
          </span>

          {step === "phone" && (
            <div className="mt-5">
              <h1 className="text-display text-2xl">Welcome to Stawi</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Sign in with your phone number. We'll text you a one-time code.
              </p>
              <label className="mt-6 block text-sm font-medium" htmlFor="phone">
                Phone number
              </label>
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-input bg-secondary/50 px-3">
                <Phone className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <Input
                  id="phone"
                  inputMode="tel"
                  placeholder="+254 712 000 000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendCode()}
                  className="min-h-[48px] border-0 bg-transparent shadow-none focus-visible:ring-0"
                />
              </div>
              {error && (
                <p role="alert" className="mt-2 text-sm text-terracotta">
                  {error}
                </p>
              )}
              <Button
                size="lg"
                className="mt-5 w-full min-h-[48px] text-base"
                onClick={sendCode}
              >
                Send code
                <ArrowRight className="size-4" strokeWidth={2} />
              </Button>
            </div>
          )}

          {step === "code" && (
            <div className="mt-5">
              <h1 className="text-display text-2xl">Check your messages</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a 6-digit code to {phone}. In this demo, use{" "}
                <span className="tabular text-lime">123456</span>.
              </p>
              <label className="mt-6 block text-sm font-medium" htmlFor="code">
                One-time code
              </label>
              <Input
                id="code"
                inputMode="numeric"
                maxLength={6}
                placeholder="••••••"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && verify()}
                className="mt-2 min-h-[48px] text-center text-xl tracking-[0.4em] tabular"
              />
              {error && (
                <p role="alert" className="mt-2 text-sm text-terracotta">
                  {error}
                </p>
              )}
              <Button size="lg" className="mt-5 w-full min-h-[48px] text-base" onClick={verify}>
                Verify code
                <ArrowRight className="size-4" strokeWidth={2} />
              </Button>
              <button
                type="button"
                className="mt-3 w-full text-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setStep("phone");
                  setError(null);
                }}
              >
                Use a different number
              </button>
            </div>
          )}

          {step === "role" && (
            <div className="mt-5">
              <h1 className="text-display text-2xl">Who's signing in?</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This demo account holds all three views. Pick where to land.
              </p>
              <div className="mt-5 space-y-3">
                {roleCards.map((card) => (
                  <button
                    key={card.role}
                    type="button"
                    onClick={() => choose(card.role)}
                    className="flex w-full items-center gap-4 rounded-xl border border-border bg-secondary/50 p-4 text-left transition-colors hover:border-lime/50"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-lime/15">
                      <ShieldCheck className="size-5 text-lime" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{card.title}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {card.body}
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-sage" strokeWidth={2} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </motion.div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          New to Stawi?{" "}
          <Link to="/onboarding" className="text-lime underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>

        <p className="mt-6 text-center text-xs text-muted-foreground/70">
          Demo environment · any phone number works with code {DEMO_CODE}
        </p>
      </div>
    </div>
  );
}
