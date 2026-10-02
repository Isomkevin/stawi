import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, FileUp, Landmark, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/stawi/StatusChip";
import { buyerPortal } from "@/lib/buyerPortal";
import { formatCurrency, formatDate } from "@/lib/format";
import type { BuyerLookup } from "@/lib/types";
import { noindexMeta } from "@/lib/site";

export const Route = createFileRoute("/buyer")({
  head: () => ({
    meta: [
      { title: "Buyer portal — Stawi" },
      { name: "description", content: "Buyers pay a Stawi shipment by card or submit bank transfer proof with the shipment number." },
      { property: "og:title", content: "Buyer portal — Stawi" },
      { property: "og:description", content: "Pay a shipment by card or submit bank transfer proof." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      noindexMeta,
    ],
  }),
  component: BuyerPortal,
});

const proofSchema = z.object({
  payer_name: z.string().trim().min(2, "Enter the company or payer name").max(255),
  payer_email: z.string().trim().email("Enter a valid email").max(255),
  bank_reference: z.string().trim().min(3, "Enter the bank transfer reference").max(128),
  amount: z.number().positive("Enter the amount sent"),
  paid_at: z.string().min(1, "Choose the transfer date"),
  note: z.string().max(1000).optional(),
});

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function codeFromLocation(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("code")?.trim() ?? "";
}

function BuyerPortal() {
  const linked = codeFromLocation();
  const [code, setCode] = useState(linked);
  const [ref, setRef] = useState("");
  const [found, setFound] = useState<BuyerLookup | null>(null);
  const [opening, setOpening] = useState(Boolean(linked));
  const [mode, setMode] = useState<"card" | "transfer">("card");

  const lookup = useMutation({
    mutationFn: () => buyerPortal.lookup(code, ref),
    onSuccess: (r) => setFound(r),
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (!linked) return;
    setCode(linked);
    let cancelled = false;
    buyerPortal.lookup(linked)
      .then((r) => {
        if (!cancelled) setFound(r);
      })
      .catch((e: Error) => {
        if (!cancelled) toast.error(e.message);
      })
      .finally(() => {
        if (!cancelled) setOpening(false);
      });
    return () => {
      cancelled = true;
    };
  }, [linked]);

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10 sm:py-16">
      <Link to="/" className="text-display text-2xl">Stawi</Link>
      <h1 className="text-display mt-6 text-3xl sm:text-4xl">Buyer portal</h1>
      <p className="mt-2 text-muted-foreground">
        Open the link from your seller, or enter the access code on your documents. Pay by card, or tell us about a bank transfer you have made.
      </p>
      {opening && !found && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Opening this shipment…
        </p>
      )}

      <form
        className="mt-8 grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) lookup.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="code">Access code</Label>
          <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="STAWI-BUYER-…" autoComplete="off" maxLength={64} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ref">Shipment number (optional)</Label>
          <Input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Optional if you have the link" maxLength={128} />
        </div>
        <Button type="submit" className="h-10" disabled={lookup.isPending || !code.trim()}>
          {lookup.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Find
        </Button>
      </form>

      {found && (
        <section className="mt-6 space-y-5">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Shipment {found.shipment.reference}</p>
                <p className="mt-1 font-medium">{found.shipment.product} · {found.shipment.quantity_kg.toLocaleString()} kg → {found.shipment.destination}</p>
                <p className="text-sm text-muted-foreground">Payee: {found.payee_name} · Invoice {found.invoice.reference}</p>
              </div>
              <StatusChip status={found.invoice.status} />
            </div>
            <p className="text-display mt-4 text-3xl tabular">{formatCurrency(found.invoice.amount, found.invoice.currency)}</p>
            {found.invoice.due_at && <p className="text-sm text-muted-foreground">Due {formatDate(found.invoice.due_at)}</p>}
          </div>

          {found.invoice.status !== "pending" ? (
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-secondary/60 p-5">
              <CheckCircle2 className="size-5 text-sage" /> This invoice is paid. Thank you.
            </div>
          ) : (
            <>
              {found.proofs.some((p) => p.status === "submitted") && (
                <p className="rounded-xl border border-border bg-secondary/60 p-4 text-sm">
                  We have your transfer details and the payee is checking them. You don't need to do anything else.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant={mode === "card" ? "default" : "outline"} className="h-11" onClick={() => setMode("card")}>
                  <CreditCard className="size-4" /> Pay by card
                </Button>
                <Button variant={mode === "transfer" ? "default" : "outline"} className="h-11" onClick={() => setMode("transfer")}>
                  <Landmark className="size-4" /> I paid by transfer
                </Button>
              </div>
              {mode === "card" ? (
                <div className="rounded-2xl border border-border bg-card p-5">
                  <p className="text-sm text-muted-foreground">Secure card checkout through Payaza. The payment is confirmed automatically.</p>
                  <Button asChild className="mt-4 h-11 w-full">
                    <Link to="/pay/$invoiceId" params={{ invoiceId: found.invoice.id }}>Continue to checkout</Link>
                  </Button>
                </div>
              ) : (
                <TransferForm code={code} found={found} onDone={() => lookup.mutate()} />
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}

function TransferForm({ code, found, onDone }: { code: string; found: BuyerLookup; onDone: () => void }) {
  const [form, setForm] = useState({
    payer_name: found.invoice.buyer_name,
    payer_email: "",
    bank_reference: "",
    amount: String(found.invoice.amount),
    paid_at: new Date().toISOString().slice(0, 10),
    note: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = useMutation({
    mutationFn: async () => {
      const parsed = proofSchema.safeParse({ ...form, amount: Number(form.amount), note: form.note || undefined });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
      if (file && file.size > 2 * 1024 * 1024) throw new Error("Receipt must be under 2 MB");
      const receipt_data = file ? await readFile(file) : undefined;
      return buyerPortal.submitProof({
        access_code: code,
        shipment_reference: found.shipment.reference,
        currency: found.invoice.currency,
        ...parsed.data,
        ...(receipt_data ? { receipt_data, receipt_name: file!.name } : {}),
      });
    },
    onSuccess: () => {
      toast.success("Transfer details sent. The payee will confirm once the money arrives.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate();
      }}
    >
      <div className="space-y-1.5"><Label htmlFor="pn">Payer name</Label><Input id="pn" value={form.payer_name} onChange={set("payer_name")} maxLength={255} /></div>
      <div className="space-y-1.5"><Label htmlFor="pe">Your email</Label><Input id="pe" type="email" value={form.payer_email} onChange={set("payer_email")} maxLength={255} /></div>
      <div className="space-y-1.5"><Label htmlFor="br">Bank transfer reference</Label><Input id="br" value={form.bank_reference} onChange={set("bank_reference")} placeholder="SWIFT / UTR / MT103 ref" maxLength={128} /></div>
      <div className="space-y-1.5"><Label htmlFor="am">Amount sent ({found.invoice.currency})</Label><Input id="am" type="number" step="0.01" min="0" value={form.amount} onChange={set("amount")} /></div>
      <div className="space-y-1.5"><Label htmlFor="pd">Transfer date</Label><Input id="pd" type="date" value={form.paid_at} onChange={set("paid_at")} /></div>
      <div className="space-y-1.5">
        <Label htmlFor="rc">Receipt (PDF or image, optional)</Label>
        <Input id="rc" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="nt">Note (optional)</Label><Textarea id="nt" value={form.note} onChange={set("note")} maxLength={1000} rows={2} /></div>
      <Button type="submit" className="h-11 sm:col-span-2" disabled={submit.isPending}>
        {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} Submit transfer details
      </Button>
    </form>
  );
}
