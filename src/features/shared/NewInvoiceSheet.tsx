import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { CopyLink } from "@/components/stawi/CopyLink";
import { QrCode } from "@/components/stawi/QrCode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import { coopMembersOptions } from "@/lib/queries";
import { FEE_RATE, fxFor, accountName } from "@/lib/mock";
import { formatKesCents } from "@/lib/format";
import type { Invoice } from "@/lib/types";

const schema = z.object({
  buyer_name: z.string().min(2, "Enter the buyer's name"),
  buyer_email: z.string().email("Enter a valid email"),
  amount: z.coerce.number().positive("Enter an amount"),
  currency: z.enum(["USD", "EUR"]),
  description: z.string().min(3, "Describe the goods"),
});
type Values = z.infer<typeof schema>;

export function NewInvoiceSheet({
  type,
  coopId,
  accountId,
  trigger = "New invoice",
}: {
  type: "coop" | "direct";
  coopId?: string;
  accountId?: string;
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<Invoice | null>(null);
  const qc = useQueryClient();
  const members = useQuery({ ...coopMembersOptions(coopId ?? ""), enabled: type === "coop" && !!coopId });
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { buyer_name: "", buyer_email: "", amount: 0, currency: "USD", description: "" },
  });
  const amount = Number(form.watch("amount")) || 0;
  const currency = form.watch("currency");

  const create = useMutation({
    mutationFn: (v: Values) =>
      api.createInvoice({ ...v, type, coop_id: coopId, account_id: accountId }),
    onSuccess: (inv) => {
      setCreated(inv);
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  // Labelled estimate only — the backend sets the real rate at payment time.
  const grossPreview = Math.round(amount * fxFor(currency) * 100);
  const netPreview = grossPreview - Math.round(grossPreview * FEE_RATE);
  const url = created && typeof window !== "undefined" ? `${window.location.origin}/pay/${created.id}` : "";

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setCreated(null);
          form.reset();
        }
      }}
    >
      <Button className="h-11" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> {trigger}
      </Button>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-display text-2xl">{created ? "Payment link ready" : "New invoice"}</SheetTitle>
          <SheetDescription>
            {created ? "Send this link to your buyer. They can pay by card or bank." : "Your buyer pays in their currency. You receive KES."}
          </SheetDescription>
        </SheetHeader>

        {created ? (
          <div className="mt-6 space-y-5">
            <div className="flex justify-center rounded-2xl border border-border bg-card p-5">
              <QrCode value={url} size={180} />
            </div>
            <CopyLink url={url} subject={`Invoice ${created.reference}`} />
            <Button variant="outline" className="h-11 w-full" onClick={() => setCreated(null)}>Create another</Button>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="mt-6 space-y-4 px-1">
            <F label="Buyer name" error={form.formState.errors.buyer_name?.message}>
              <Input {...form.register("buyer_name")} className="h-11" />
            </F>
            <F label="Buyer email" error={form.formState.errors.buyer_email?.message}>
              <Input type="email" {...form.register("buyer_email")} className="h-11" />
            </F>
            <div className="grid grid-cols-[1fr_110px] gap-3">
              <F label="Amount" error={form.formState.errors.amount?.message}>
                <Input inputMode="decimal" {...form.register("amount")} className="h-11 tabular" />
              </F>
              <F label="Currency">
                <select {...form.register("currency")} className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </F>
            </div>
            <F label="What's being sold" error={form.formState.errors.description?.message}>
              <Textarea {...form.register("description")} rows={2} />
            </F>

            {amount > 0 && (
              <div className="rounded-2xl border border-border bg-card p-4 text-sm">
                <p className="mb-2 text-xs tracking-wide text-amber uppercase">Estimate — final rate set at payment</p>
                <div className="flex justify-between"><span className="text-muted-foreground">You receive about</span><span className="tabular text-lime">{formatKesCents(netPreview)}</span></div>
                {type === "coop" && members.data && (
                  <div className="mt-3 max-h-48 space-y-1 overflow-y-auto border-t border-border pt-3">
                    {members.data.map((m) => (
                      <div key={m.account_id} className="flex justify-between text-xs">
                        <span>{m.full_name ?? accountName(m.account_id)} · {m.contribution_share}%</span>
                        <span className="tabular">{formatKesCents(Math.round((netPreview * m.contribution_share) / 100))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {create.isError && <p role="alert" className="text-sm text-terracotta">Couldn't create the invoice. Try again.</p>}
            <Button type="submit" className="h-12 w-full" disabled={create.isPending}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />} Create payment link
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

function F({ label, error, children }: { label: string; error?: string | undefined; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-terracotta">{error}</p>}
    </div>
  );
}
