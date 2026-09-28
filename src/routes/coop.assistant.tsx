import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/features/shared/DashboardShell";
import { api } from "@/lib/api";
import { useCoopId } from "@/lib/session";

export const Route = createFileRoute("/coop/assistant")({
  head: () => ({
    meta: [
      { title: "Ask Stawi — co-op finance assistant" },
      { name: "description", content: "Ask plain-language questions about invoices, farmer balances and payouts." },
      { property: "og:title", content: "Ask Stawi — co-op finance assistant" },
      { property: "og:description", content: "Ask plain-language questions about invoices, farmer balances and payouts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Assistant,
});

type Msg = { role: "user" | "assistant"; content: string; error?: boolean };

const SUGGESTIONS = [
  "How much has the co-op collected in total, and what fees did Stawi take?",
  "Which farmers have the highest balances right now?",
  "Which invoices are still waiting for payment or split approval?",
  "Were any payouts failed or still pending?",
];

async function buildSnapshot(coopId: string) {
  const [coop, members, invoices, payouts, metrics] = await Promise.all([
    api.getCoop(coopId),
    api.getCoopMembers(coopId),
    api.listInvoices({ coop_id: coopId }),
    api.listCoopPayouts(coopId),
    api.getCoopMetrics(coopId),
  ]);
  const farmers = await Promise.all(
    members.map(async (m) => {
      const b = await api.getBalance(m.account_id).catch(() => null);
      return { ...m, balance_kes_cents: b?.balance_kes_cents ?? null, incoming_kes_cents: b?.incoming_kes_cents ?? null };
    }),
  );
  const names = Object.fromEntries(farmers.map((f) => [f.account_id, f.full_name ?? f.account_id]));
  return {
    generated_at: new Date().toISOString(),
    coop,
    metrics,
    farmers,
    invoices,
    payouts: payouts.map((p) => ({ ...p, farmer_name: names[p.account_id] ?? p.account_id })),
  };
}

function Assistant() {
  const coopId = useCoopId();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    const history = messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const update = (fn: (m: Msg) => Msg) =>
      setMessages((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));
    try {
      const snapshot = await buildSnapshot(coopId);
      const res = await fetch("/api/coop-assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, history, snapshot }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg =
          res.status === 402 ? "AI credits have run out for this workspace." :
          res.status === 429 ? "Too many questions right now — try again in a minute." :
          body.error ?? "The assistant couldn't answer.";
        update((m) => ({ ...m, content: msg, error: true }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        update((m) => ({ ...m, content: m.content + chunk }));
      }
      update((m) => (m.content ? m : { ...m, content: "No answer was returned.", error: true }));
    } catch (e) {
      if ((e as Error).name === "AbortError") update((m) => ({ ...m, content: m.content + " (stopped)" }));
      else update((m) => ({ ...m, content: "The assistant couldn't answer.", error: true }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="Ask Stawi" subtitle="Plain-language answers from your co-op's live invoices, balances and payouts." />

      <div className="flex-1 space-y-4">
        {messages.length === 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void ask(s)}
                className="rounded-lg border border-border bg-card p-3 text-left text-sm hover:bg-secondary"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="ml-auto max-w-[80%] rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
                {m.content}
              </div>
            ) : (
              <div
                key={i}
                className={`max-w-[90%] whitespace-pre-wrap text-sm leading-relaxed ${m.error ? "text-destructive" : ""}`}
              >
                {m.content || (busy && i === messages.length - 1 ? <span className="text-muted-foreground">Looking through your records…</span> : null)}
              </div>
            ),
          )
        )}
      </div>

      <form
        className="sticky bottom-0 flex items-end gap-2 rounded-lg border border-border bg-card p-2"
        onSubmit={(e) => { e.preventDefault(); void ask(input); }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
          placeholder="e.g. How much did farmer Wanjiku receive this month?"
          className="min-h-11 resize-none border-0 shadow-none focus-visible:ring-0"
          aria-label="Your question"
        />
        {busy ? (
          <Button type="button" size="icon" variant="outline" aria-label="Stop" onClick={() => abortRef.current?.abort()}>
            <Square className="size-4" />
          </Button>
        ) : (
          <Button type="submit" size="icon" aria-label="Ask" disabled={!input.trim()}>
            <ArrowUp className="size-4" />
          </Button>
        )}
      </form>
      <p className="text-xs text-muted-foreground">AI-powered answers — check important figures against your records.</p>
    </div>
  );
}
