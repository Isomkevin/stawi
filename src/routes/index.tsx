import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import heroImg from "@/assets/hero.png";
import {
  ArrowRight,
  BadgeCheck,
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
          "A co-op treasurer used to spend days paying farmers in cash. Stawi turns one buyer payment into a same-day split, with a flat 0.8% fee on the invoice.",
      },
      { property: "og:title", content: "Stawi — One payment in. Every farmer paid, same day." },
      {
        property: "og:description",
        content:
          "One buyer payment. A treasurer's approval. Every farmer paid the same day, to M-Pesa or a bank. 0.8% flat, written on the invoice.",
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
        <Story />
        <HowItWorks />
        <Join />
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
          <a href="#story" className="transition-colors hover:text-foreground">
            The change
          </a>
          <a href="#how" className="transition-colors hover:text-foreground">
            How it works
          </a>
          <a href="#join" className="transition-colors hover:text-foreground">
            Farmers
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
        <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease }}
          >
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium tracking-wide text-sage uppercase">
              <ShieldCheck className="size-3.5" strokeWidth={1.75} />
              For export co-ops
            </p>
            <h1 className="text-display mt-6 text-4xl leading-[1.05] font-medium sm:text-5xl xl:text-6xl">
              A week of cash,{" "}
              <span className="text-lime">done in an afternoon.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              The buyer pays the co-op once. The treasurer sees every farmer’s share and a flat
              0.8% fee, then releases it. Each farmer withdraws to M-Pesa or a bank the same day.
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
            transition={{ delay: 0.15, duration: 0.7, ease }}
            className="relative mx-auto w-full max-w-sm lg:max-w-none"
          >
            <div
              aria-hidden
              className="absolute -inset-6 rounded-[2.5rem] bg-lime/10 blur-2xl"
            />
            <img
              src={heroImg}
              width={1024}
              height={1280}
              alt="Illustration: one USD export invoice splitting into same-day KES mobile-money payments on three farmers' phones"
              className="relative w-full rounded-3xl border border-border shadow-lift"
            />
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.7, ease }}
          className="mt-14 grid gap-3 sm:grid-cols-3"
        >
          <HeroStat value="One invoice" label="The buyer pays the co-op, not each farmer" />
          <HeroStat value="One approval" label="The treasurer sees every share before money moves" />
          <HeroStat value="Same day" label="Each farmer withdraws to the account they registered" />
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

function Story() {
  const before = [
    { when: "Monday", line: "The buyer sends a wire. Nobody in the co-op can see it yet." },
    { when: "Days later", line: "A lump sum lands, with no names and no record of who delivered what." },
    { when: "Then", line: "The treasurer splits it from a notebook and pays farmers in cash." },
  ];
  const after = [
    { when: "Now", line: "The buyer pays one invoice, in dollars, euros or pounds." },
    { when: "Then", line: "The treasurer sees every share, and the 0.8% fee, before a shilling moves." },
    { when: "Today", line: "Each farmer withdraws to M-Pesa or the bank account they registered." },
  ];
  return (
    <section id="story" className="scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">The change</p>
          <h2 className="text-display mt-2 max-w-3xl text-3xl sm:text-5xl">
            From a week of envelopes to one afternoon.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <Reveal>
            <article className="h-full rounded-3xl border border-border bg-card/50 p-6 sm:p-8">
              <p className="text-xs font-medium tracking-wide text-amber uppercase">Before</p>
              <p className="text-display mt-3 text-5xl text-muted-foreground sm:text-6xl">A week</p>
              <p className="mt-2 text-sm text-muted-foreground">Cash, a notebook, and an argument about shares.</p>
              <ol className="mt-8 space-y-5">
                {before.map((step) => (
                  <li key={step.when} className="grid grid-cols-[6.5rem_1fr] gap-3 text-sm">
                    <span className="text-amber">{step.when}</span>
                    <span className="text-muted-foreground">{step.line}</span>
                  </li>
                ))}
              </ol>
            </article>
          </Reveal>
          <Reveal delay={0.1}>
            <article className="grain relative h-full overflow-hidden rounded-3xl border border-lime/40 bg-card p-6 shadow-lift sm:p-8">
              <p className="text-xs font-medium tracking-wide text-lime uppercase">With Stawi</p>
              <p className="text-display mt-3 text-5xl text-lime sm:text-6xl">Same day</p>
              <p className="mt-2 text-sm text-muted-foreground">One payment in. Every farmer can take their share.</p>
              <ol className="mt-8 space-y-5">
                {after.map((step) => (
                  <li key={step.when} className="grid grid-cols-[6.5rem_1fr] gap-3 text-sm">
                    <span className="text-lime">{step.when}</span>
                    <span>{step.line}</span>
                  </li>
                ))}
              </ol>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: Receipt,
      title: "The buyer pays once",
      body: "The co-op sends one invoice in dollars, euros or pounds. The buyer pays the co-op, and sees the fee before they confirm.",
    },
    {
      icon: Wallet,
      title: "The treasurer approves",
      body: "Shillings, the 0.8% fee, and every farmer’s share sit on one screen. Nothing is released until the treasurer says so.",
    },
    {
      icon: Users,
      title: "Every farmer is paid",
      body: "Each share lands in that farmer’s Stawi balance. They withdraw to M-Pesa or a bank, on a smartphone or a basic phone.",
    },
  ];
  return (
    <section id="how" className="scroll-mt-20 border-y border-border bg-card/30 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">How it works</p>
          <h2 className="text-display mt-2 max-w-2xl text-3xl sm:text-4xl">
            One payment. A treasurer’s yes. Then every farmer.
          </h2>
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

function Join() {
  const steps = [
    { n: "01", title: "An invite", body: "The treasurer sends a link. The co-op and the farmer’s share are already filled in." },
    { n: "02", title: "Who they are", body: "Name, national ID, and the phone they will use to sign in." },
    { n: "03", title: "Where money goes", body: "An M-Pesa number or a bank account. That is the only place a payout can land." },
    { n: "04", title: "A PIN they choose", body: "Four digits. The treasurer cannot withdraw on a farmer’s behalf." },
  ];
  return (
    <section id="join" className="scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">Farmers</p>
          <h2 className="text-display mt-2 max-w-3xl text-3xl sm:text-5xl">
            A farmer joins with the phone they already have.
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            No branch visit. No form posted to the treasurer. Four steps, then the next co-op payment can include them.
          </p>
        </Reveal>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <Reveal key={step.n} delay={i * 0.06}>
              <li className="h-full rounded-2xl border border-border bg-card p-6 shadow-soft">
                <p className="text-display text-3xl text-lime">{step.n}</p>
                <h3 className="text-display mt-4 text-xl">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
        <Reveal delay={0.15} className="mt-4">
          <div className="flex flex-col gap-4 rounded-2xl border border-lime/30 bg-lime/10 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-lime">
              <BadgeCheck className="size-5 text-[oklch(0.22_0.035_152)]" strokeWidth={1.75} />
            </span>
            <p className="text-sm leading-relaxed sm:text-base">
              A basic phone can check the balance and withdraw. It cannot type in a new number.
              Money only goes to the M-Pesa or bank account the farmer registered.
            </p>
          </div>
        </Reveal>
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
            The same money, on any handset.
          </h2>
          <p className="mt-4 text-muted-foreground">
            A smartphone gets the full account, in English or Swahili. A basic phone dials in and
            sees the same balance. The payout still goes only to the M-Pesa number or bank account
            they added when they joined.
          </p>
          <ul className="mt-6 space-y-3 text-sm">
            {[
              "No smartphone and no data required",
              "One balance, whether they open the app or dial in",
              "English and Swahili",
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
          <h2 className="text-display mt-2 text-3xl sm:text-5xl">
            0.8%. Written on the invoice.
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            Stawi takes 0.8% of the shilling amount, before anyone is paid. The buyer sees it.
            Every farmer’s line shows it. There is no subscription, and nothing extra is taken
            from the farmer.
          </p>
          <p className="mt-6 max-w-md text-sm text-muted-foreground">
            On a buyer payment of EUR 8,600, the fee is about KES 9,600. The rest is the farmers’.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grain relative overflow-hidden rounded-2xl border border-lime/30 bg-card p-6 shadow-lift">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Stawi</p>
              <p className="text-display mt-2 text-4xl text-lime tabular">0.8%</p>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li>Shown before the treasurer approves</li>
                <li>The same number on every farmer’s line</li>
                <li>Same-day, once it is released</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-card/60 p-6">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">
                A typical wire
              </p>
              <p className="text-display mt-2 text-4xl text-amber">Hidden</p>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li>Often about 4.5%, in fees and the rate</li>
                <li>A lump sum, with no farmer on it</li>
                <li>Days, then cash by hand</li>
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
          <h2 className="text-display mx-auto max-w-2xl text-3xl sm:text-5xl">
            The next shipment does not have to wait a week.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
            Invoice the buyer. Approve the split. Every farmer can take their money the same day.
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
          <a href="#story" className="hover:text-foreground">
            The change
          </a>
          <a href="#how" className="hover:text-foreground">
            How it works
          </a>
          <a href="#join" className="hover:text-foreground">
            Farmers
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
