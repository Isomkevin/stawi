import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  ArrowRight,
  Clock3,
  Landmark,
  Leaf,
  LockKeyhole,
  Phone,
  Receipt,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
} from "lucide-react";
import { FlowDiagram } from "@/components/stawi/FlowDiagram";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Stawi — One payment in. Every farmer paid, same day." },
      {
        name: "description",
        content:
          "Stawi turns one cross-border export payment into same-day mobile-money payouts for every farmer in a co-op. 0.8% flat fee, live FX, full transparency.",
      },
      { property: "og:title", content: "Stawi — One payment in. Every farmer paid, same day." },
      {
        property: "og:description",
        content:
          "Cross-border export payments split to every farmer's M-Pesa the same day. 0.8% flat, live FX, no hidden bank spread.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

const ease = [0.16, 1, 0.3, 1] as const;

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ delay, duration: 0.55, ease }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <AnyPhone />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-lime">
            <Leaf className="size-4 text-[oklch(0.22_0.035_152)]" strokeWidth={2} />
          </span>
          <span className="text-display text-xl">Stawi</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a href="#how" className="transition-colors hover:text-foreground">
            How it works
          </a>
          <a href="#any-phone" className="transition-colors hover:text-foreground">
            Any phone
          </a>
          <a href="#pricing" className="transition-colors hover:text-foreground">
            Pricing
          </a>
        </nav>
        <Button asChild size="sm" className="min-h-[40px]">
          <Link to="/login">
            Sign in
            <ArrowRight className="size-4" strokeWidth={2} />
          </Link>
        </Button>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="motif grain relative overflow-hidden px-4 pt-32 pb-16 sm:px-6 sm:pt-40 sm:pb-24">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
          className="max-w-3xl"
        >
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium tracking-wide text-sage uppercase">
            <ShieldCheck className="size-3.5" strokeWidth={1.75} />
            Cross-border payments for African exports
          </p>
          <h1 className="text-display mt-6 text-4xl leading-[1.05] font-medium sm:text-6xl">
            One payment in.{" "}
            <span className="text-lime">Every farmer paid, same day.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Your buyer pays one invoice in dollars or euros. Stawi converts at a live rate, takes a
            flat 0.8%, and splits the rest to every member's M-Pesa — today, not next month.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="min-h-[48px] text-base">
              <Link to="/login">
                Get paid the same day
                <ArrowRight className="size-4" strokeWidth={2} />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="min-h-[48px] border-border bg-transparent text-base"
            >
              <a href="#how">See how it works</a>
            </Button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.7, ease }}
          className="mt-14 grid gap-3 sm:grid-cols-3"
        >
          <HeroStat value="KES 3.4M" label="moved this season through one co-op" />
          <HeroStat value="10 farmers" label="paid from a single export invoice" />
          <HeroStat value="Same day" label="from buyer's card to M-Pesa" />
        </motion.div>

        <div className="mt-14">
          <FlowDiagram />
        </div>
      </div>
    </section>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5 shadow-soft backdrop-blur">
      <p className="text-display text-2xl text-lime tabular">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function Problem() {
  const items = [
    {
      icon: Landmark,
      title: "Bank wires eat the margin",
      body: "A SWIFT chain takes 3–6% in fees and FX spread before the money even lands in Kenya.",
    },
    {
      icon: Clock3,
      title: "Weeks of waiting",
      body: "Correspondent banks hold funds for 3–15 days. Farmers wait a month for cash they already earned.",
    },
    {
      icon: Receipt,
      title: "No one can see anything",
      body: "A lump sum arrives with no record of who delivered what, so splits are argued by memory.",
    },
  ];
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">The problem</p>
          <h2 className="text-display mt-2 max-w-2xl text-3xl sm:text-4xl">
            Getting paid from abroad shouldn't cost a harvest
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {items.map((item, i) => (
            <Reveal key={item.title} delay={i * 0.08}>
              <div className="h-full rounded-2xl border border-border bg-card p-6 shadow-soft">
                <span className="grid size-10 place-items-center rounded-xl border border-border bg-secondary">
                  <item.icon className="size-5 text-amber" strokeWidth={1.75} />
                </span>
                <h3 className="text-display mt-4 text-lg">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: Receipt,
      title: "Invoice the buyer",
      body: "Create an invoice in USD, EUR or GBP and share the payment link. The buyer sees exactly who they're paying.",
    },
    {
      icon: Wallet,
      title: "One payment lands",
      body: "The buyer pays by card or bank transfer. Stawi converts to shillings at a live rate — 0.8% flat, shown up front.",
    },
    {
      icon: Users,
      title: "Everyone is paid",
      body: "The split follows each member's contribution. Payouts hit M-Pesa or bank accounts the same day, with a record for every shilling.",
    },
  ];
  return (
    <section id="how" className="scroll-mt-20 border-y border-border bg-card/30 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">How it works</p>
          <h2 className="text-display mt-2 text-3xl sm:text-4xl">Three steps, one afternoon</h2>
        </Reveal>
        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {steps.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.08}>
              <li className="relative h-full rounded-2xl border border-border bg-card p-6 shadow-soft">
                <span className="text-display absolute top-5 right-6 text-4xl text-border">
                  {i + 1}
                </span>
                <span className="grid size-10 place-items-center rounded-xl bg-lime">
                  <step.icon className="size-5 text-[oklch(0.22_0.035_152)]" strokeWidth={1.75} />
                </span>
                <h3 className="text-display mt-4 text-lg">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

function AnyPhone() {
  return (
    <section id="any-phone" className="scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-2">
        <Reveal>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">Any phone</p>
          <h2 className="text-display mt-2 text-3xl sm:text-4xl">
            Works on a smartphone or a kabwea
          </h2>
          <p className="mt-4 text-muted-foreground">
            Farmers with smartphones get a full app in English or Swahili. Everyone else dials a
            short code and uses the same account from a basic phone — balance, payment status and
            withdrawals, all over USSD.
          </p>
          <ul className="mt-6 space-y-3 text-sm">
            {[
              "No smartphone, no data, no problem",
              "Same balance and same money on every channel",
              "Swahili and English across the app",
            ].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-lime/15">
                  <Phone className="size-3 text-lime" strokeWidth={2} />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
              <Smartphone className="size-6 text-lime" strokeWidth={1.75} />
              <h3 className="text-display mt-3">The app</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Balance, incoming payments, withdrawals and a full activity trail.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
              <LockKeyhole className="size-6 text-sage" strokeWidth={1.75} />
              <h3 className="text-display mt-3">USSD short code</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Dial in on any handset. Menu-driven, works offline, protected by a PIN.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-20 border-y border-border bg-card/30 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-2">
        <Reveal>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">Pricing</p>
          <h2 className="text-display mt-2 text-3xl sm:text-4xl">
            0.8% flat. No hidden spread.
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            One fee covers collection, conversion and every payout. You see the exact shilling
            amount before anyone approves anything — the same number the buyer sees.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grain relative overflow-hidden rounded-2xl border border-lime/30 bg-card p-6 shadow-lift">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Stawi</p>
              <p className="text-display mt-2 text-4xl text-lime tabular">0.8%</p>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li>Live mid-market FX</li>
                <li>Unlimited splits and payouts</li>
                <li>Same-day settlement</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-card/60 p-6">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">
                Typical bank wire
              </p>
              <p className="text-display mt-2 text-4xl text-amber tabular">3–6%</p>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li>SWIFT fees at both ends</li>
                <li>Opaque FX spread</li>
                <li>3–15 days to clear</li>
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24">
      <Reveal className="mx-auto max-w-6xl">
        <div className="motif grain relative overflow-hidden rounded-3xl border border-border px-6 py-14 text-center shadow-lift sm:px-12">
          <h2 className="text-display mx-auto max-w-2xl text-3xl sm:text-4xl">
            Ready when your next shipment is
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
            Set up an account in minutes — invoice a buyer today and watch the split land tomorrow.
          </p>
          <div className="mt-8 flex justify-center">
            <Button asChild size="lg" className="min-h-[48px] text-base">
              <Link to="/login">
                Create your account
                <ArrowRight className="size-4" strokeWidth={2} />
              </Link>
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-lime">
            <Leaf className="size-3.5 text-[oklch(0.22_0.035_152)]" strokeWidth={2} />
          </span>
          <div>
            <p className="text-display text-lg leading-none">Stawi</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Same-day payments for African exports
            </p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <a href="#how" className="hover:text-foreground">
            How it works
          </a>
          <a href="#pricing" className="hover:text-foreground">
            Pricing
          </a>
          <Link to="/login" className="hover:text-foreground">
            Sign in
          </Link>
        </nav>
      </div>
      <p className="mx-auto mt-6 max-w-6xl text-xs text-muted-foreground/70">
        Demo environment — payments run against sandbox data and no real money moves.
      </p>
    </footer>
  );
}
