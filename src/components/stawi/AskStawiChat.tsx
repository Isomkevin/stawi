import { useRef, useState } from "react";
import type { ChatStatus } from "ai";
import { Expand, Leaf, MessageCircleQuestion, Minus, Shrink, X } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "@/lib/api";
import { useCoopId } from "@/lib/session";
import { cn } from "@/lib/utils";

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
    members.map(async (member) => {
      const balance = await api.getBalance(member.account_id).catch(() => null);
      return {
        ...member,
        balance_kes_cents: balance?.balance_kes_cents ?? null,
        incoming_kes_cents: balance?.incoming_kes_cents ?? null,
      };
    }),
  );
  const names = Object.fromEntries(
    farmers.map((farmer) => [farmer.account_id, farmer.full_name ?? farmer.account_id]),
  );
  return {
    generated_at: new Date().toISOString(),
    coop,
    metrics,
    farmers,
    invoices,
    payouts: payouts.map((payout) => ({
      ...payout,
      farmer_name: names[payout.account_id] ?? payout.account_id,
    })),
  };
}

function IconControl({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AskStawiChat() {
  const coopId = useCoopId();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<ChatStatus>("ready");
  const abortRef = useRef<AbortController | null>(null);
  const busy = status === "submitted" || status === "streaming";

  const ask = async (question: string) => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || busy) return;
    const history = messages
      .filter((message) => !message.error)
      .map(({ role, content }) => ({ role, content }));
    setMessages((current) => [
      ...current,
      { role: "user", content: cleanQuestion },
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setStatus("submitted");
    const controller = new AbortController();
    abortRef.current = controller;
    const updateLast = (update: (message: Msg) => Msg) =>
      setMessages((current) =>
        current.map((message, index) => (index === current.length - 1 ? update(message) : message)),
      );

    try {
      const snapshot = await buildSnapshot(coopId);
      const response = await fetch("/api/coop-assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: cleanQuestion, history, snapshot }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        const message =
          body.message ??
          body.error ??
          (response.status === 402
            ? "AI credits have run out for this workspace."
            : response.status === 429
              ? "Too many questions right now — try again in a minute."
              : "The assistant couldn't answer.");
        updateLast((current) => ({ ...current, content: message, error: true }));
        setStatus("error");
        return;
      }
      setStatus("streaming");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        updateLast((current) => ({ ...current, content: current.content + chunk }));
      }
      updateLast((current) =>
        current.content ? current : { ...current, content: "No answer was returned.", error: true },
      );
      setStatus("ready");
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        updateLast((current) => ({ ...current, content: current.content || "Response stopped." }));
        setStatus("ready");
      } else {
        updateLast((current) => ({
          ...current,
          content: "The assistant couldn't answer.",
          error: true,
        }));
        setStatus("error");
      }
    } finally {
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <TooltipProvider delayDuration={250}>
      <Button
        type="button"
        size="lg"
        className={cn(
          "fixed bottom-5 right-5 z-40 h-12 rounded-full px-4 shadow-lift md:bottom-6 md:right-6",
          open && "pointer-events-none opacity-0",
        )}
        aria-label="Open Ask Stawi"
        onClick={() => setOpen(true)}
      >
        <MessageCircleQuestion className="size-5" />
        Ask Stawi
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onOpenAutoFocus={(event) => event.preventDefault()}
          className={cn(
            "flex max-h-none max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden border-border bg-background p-0 shadow-lift [&>button]:hidden",
            isMobile || maximized
              ? "inset-0 h-dvh w-screen rounded-none"
              : "bottom-5 left-auto right-5 top-auto h-[min(740px,calc(100vh-2.5rem))] w-[min(460px,calc(100vw-2.5rem))] rounded-lg",
          )}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-lime text-primary-foreground">
                <Leaf className="size-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-display truncate text-lg">Ask Stawi</DialogTitle>
                <DialogDescription className="truncate text-xs">
                  Answers from your co-op records
                </DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <IconControl label="Minimize chat" onClick={() => setOpen(false)}>
                <Minus className="size-4" />
              </IconControl>
              {!isMobile && (
                <IconControl
                  label={maximized ? "Restore chat size" : "Maximize chat"}
                  onClick={() => setMaximized((current) => !current)}
                >
                  {maximized ? <Shrink className="size-4" /> : <Expand className="size-4" />}
                </IconControl>
              )}
              <IconControl label="Close chat" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </IconControl>
            </div>
          </header>

          <Conversation className="min-h-0 bg-background">
            <ConversationContent
              className={cn(
                "mx-auto w-full",
                maximized && !isMobile ? "max-w-4xl px-8 py-7" : "px-4 py-5",
              )}
            >
              {messages.length === 0 ? (
                <div className="flex min-h-[340px] flex-col justify-center py-8">
                  <div className="mb-6 flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-lime">
                      <Leaf className="size-5" />
                    </span>
                    <div>
                      <h2 className="text-display text-xl">What would you like to know?</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Ask about invoices, farmer balances, payouts, or fees.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.map((suggestion) => (
                      <Button
                        key={suggestion}
                        type="button"
                        variant="outline"
                        className="h-auto min-h-14 justify-start whitespace-normal px-3 py-3 text-left text-sm leading-snug"
                        onClick={() => void ask(suggestion)}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message, index) => (
                  <Message key={`${message.role}-${index}`} from={message.role}>
                    <MessageContent className={message.error ? "text-destructive" : undefined}>
                      {message.role === "assistant" ? (
                        message.content ? (
                          <MessageResponse isAnimating={busy && index === messages.length - 1}>
                            {message.content}
                          </MessageResponse>
                        ) : busy && index === messages.length - 1 ? (
                          <Shimmer>Looking through your records…</Shimmer>
                        ) : null
                      ) : (
                        message.content
                      )}
                    </MessageContent>
                  </Message>
                ))
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="shrink-0 border-t border-border bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4">
            <div className={cn("mx-auto w-full", maximized && !isMobile && "max-w-4xl")}>
              <PromptInput onSubmit={({ text }) => ask(text)}>
                <PromptInputTextarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask about your co-op finances…"
                  aria-label="Your question"
                  disabled={busy}
                  className="min-h-12 max-h-32"
                />
                <PromptInputFooter className="justify-between">
                  <span className="text-xs text-muted-foreground">
                    Check important figures against your records.
                  </span>
                  <PromptInputSubmit
                    status={status}
                    onStop={stop}
                    disabled={!busy && !input.trim()}
                    aria-label={busy ? "Stop response" : "Send question"}
                  />
                </PromptInputFooter>
              </PromptInput>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
