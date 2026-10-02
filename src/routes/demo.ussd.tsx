import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Phone, PhoneOff } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { FARMER_ID } from "@/lib/mock";
import { formatKesCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import { noindexMeta } from "@/lib/site";

export const Route = createFileRoute("/demo/ussd")({
  head: () => ({
    meta: [
      { title: "Basic-phone simulator — Stawi" },
      { name: "description", content: "Try Stawi on a feature phone: check balance, payment status and withdraw by USSD." },
      { property: "og:title", content: "Basic-phone simulator — Stawi" },
      { property: "og:description", content: "Try Stawi on a feature phone: check balance, payment status and withdraw by USSD." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      noindexMeta,
    ],
  }),
  component: UssdSim,
});

type LogEntry = { dir: "req" | "res"; body: string };
const CODE = "*384*56990#";
const MENU = "CON Welcome to Stawi\n1. My balance\n2. Last payment status\n3. Withdraw to M-Pesa\n0. Exit";

function UssdSim() {
  const qc = useQueryClient();
  const [dial, setDial] = useState("");
  const [screen, setScreen] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState("");

  const respond = (text: string, nextPath: string[]) => {
    setLog((l) => [...l, { dir: "res", body: text }]);
    if (text.startsWith("END")) {
      setScreen(text.slice(4));
      setPath([]);
      setTimeout(() => setScreen((s) => (s === text.slice(4) ? null : s)), 4000);
    } else {
      setScreen(text.slice(4));
      setPath(nextPath);
    }
  };

  // Mirrors the backend USSD handler: text is the *-joined history of inputs.
  const handle = async (p: string[], sid: string = sessionId) => {
    const text = p.join("*");
    setLog((l) => [...l, { dir: "req", body: JSON.stringify({ sessionId: sid, phoneNumber: "+254712004501", serviceCode: CODE, text }) }]);
    setBusy(true);
    try {
      if (p.length === 0) return respond(MENU, p);
      const [first, ...rest] = p;
      if (first === "0") return respond("END Asante. Goodbye.", []);
      if (first === "1") {
        const b = await api.getBalance(FARMER_ID);
        return respond(`END Balance: ${formatKesCents(b.balance_kes_cents)}\nOn the way: ${formatKesCents(b.incoming_kes_cents)}`, []);
      }
      if (first === "2") {
        const t = await api.getAccountTransactions(FARMER_ID, 1);
        const last = t[0];
        return respond(last ? `END Last: ${formatKesCents(last.amount_kes_cents)}\nStatus: ${last.status.toUpperCase()}` : "END No payments yet.", []);
      }
      if (first === "3") {
        if (rest.length === 0) return respond("CON Enter amount in KES:", p);
        const amount = Number(rest[0]);
        if (!amount || amount <= 0) return respond("END Invalid amount.", []);
        if (rest.length === 1) return respond(`CON Send KES ${amount.toLocaleString()} to M-Pesa 0712***501?\nEnter PIN:`, p);
        try {
          await api.withdraw(FARMER_ID, {
            destination_id: "dst_f1",
            amount_kes_cents: Math.round(amount * 100),
            pin: rest[1] ?? "",
            idempotency_key: `${sid}-${text}`,
          });
          void qc.invalidateQueries({ queryKey: ["account", FARMER_ID] });
          return respond(`END Sent KES ${amount.toLocaleString()}. You will receive an M-Pesa SMS.`, []);
        } catch (e) {
          if (e instanceof ApiError && e.code === "locked") return respond("END Too many attempts. Try in 15 min.", []);
          if (e instanceof ApiError && e.code === "wrong") return respond(`END Wrong PIN. ${e.attemptsLeft ?? 0} tries left.`, []);
          if (e instanceof ApiError && e.status === 400) return respond("END Not enough balance.", []);
          return respond("END Service error. Try again.", []);
        }
      }
      return respond("END Invalid choice.", []);
    } finally {
      setBusy(false);
    }
  };

  const press = (k: string) => {
    if (screen === null) setDial((d) => d + k);
    else setInput((i) => i + k);
  };
  const call = () => {
    if (screen !== null) {
      const next = [...path, input];
      setInput("");
      void handle(next);
      return;
    }
    if (dial !== CODE) {
      setScreen(`Unknown code. Dial ${CODE}`);
      setTimeout(() => setScreen(null), 2000);
      setDial("");
      return;
    }
    setSessions((s) => s + 1);
    const sid = `ATUid_${Date.now().toString(36)}`;
    setSessionId(sid);
    setDial("");
    void handle([], sid);
  };
  const hangup = () => {
    setScreen(null);
    setPath([]);
    setInput("");
    setDial("");
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

  return (
    <div className="motif min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <Link to="/" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to Stawi
        </Link>
        <div className="mb-8">
          <p className="text-xs tracking-wide text-amber uppercase">Sandbox simulation</p>
          <h1 className="text-display text-3xl">Stawi on any phone</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dial <span className="text-lime tabular">{CODE}</span> and press the green key. Signed in as Wanjiku Mwangi. Demo PIN 1234.
          </p>
        </div>
        <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
          <div className="mx-auto w-[300px] rounded-[44px] border border-border bg-card p-5 shadow-lift">
            <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-border" />
            <div className="h-52 rounded-xl border-4 border-secondary bg-[oklch(0.3_0.06_140)] p-3 font-mono text-[13px] leading-snug text-[oklch(0.88_0.18_130)] shadow-inner" aria-live="polite">
              {busy ? (
                <p>Please wait…</p>
              ) : screen !== null ? (
                <>
                  <p className="whitespace-pre-line">{screen}</p>
                  {path.length > 0 || screen.startsWith("Welcome to Stawi") ? <p className="mt-2 border-t border-current/30 pt-1">&gt; {input}<span className="animate-pulse">_</span></p> : null}
                </>
              ) : (
                <p className="text-right text-xl tabular">{dial || <span className="opacity-50">Safaricom</span>}</p>
              )}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={call} aria-label="Call / send" className="grid h-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><Phone className="size-5" /></button>
              <button type="button" onClick={hangup} aria-label="Hang up" className="grid h-12 place-items-center rounded-2xl bg-terracotta text-background"><PhoneOff className="size-5" /></button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {keys.map((k) => (
                <button key={k} type="button" onClick={() => press(k)} className="h-12 rounded-2xl border border-border bg-secondary text-lg tabular active:scale-95">{k}</button>
              ))}
            </div>
            <button type="button" onClick={() => (screen === null ? setDial((d) => d.slice(0, -1)) : setInput((i) => i.slice(0, -1)))} className="mt-2 h-10 w-full rounded-2xl border border-border text-sm text-muted-foreground">
              Clear
            </button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-medium">Gateway traffic</h2>
              <span className="text-xs text-muted-foreground tabular">Sessions: {sessions}</span>
            </div>
            <div className="max-h-[520px] space-y-2 overflow-y-auto font-mono text-xs">
              {log.length === 0 && <p className="text-muted-foreground">Requests and responses will appear here.</p>}
              {log.map((e, i) => (
                <div key={i} className={cn("rounded-lg border p-2", e.dir === "req" ? "border-border" : "border-lime/30 bg-lime/5")}>
                  <p className="mb-1 text-[10px] tracking-wide text-muted-foreground uppercase">{e.dir === "req" ? "→ POST /ussd" : "← response"}</p>
                  <pre className="whitespace-pre-wrap">{e.body}</pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
