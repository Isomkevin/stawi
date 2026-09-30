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
import { coopMembersOptions, coopShipmentsOptions } from "@/lib/queries";
import { FEE_RATE, fxFor, accountName } from "@/lib/mock";
import { formatKesCents } from "@/lib/format";
import { ApiError, type Invoice, type ShipmentFarmer } from "@/lib/types";

const schema = z.object({
  buyer_name: z.string().min(2, "Enter the buyer's name"),
  buyer_email: z.string().email("Enter a valid email"),
  amount: z.coerce.number().positive("Enter an amount"),
  currency: z.enum(["USD", "EUR"]),
  description: z.string().min(3, "Describe the goods"),
  shipment_id: z.string().optional(),
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
  const shipments = useQuery({ ...coopShipmentsOptions(coopId ?? ""), enabled: type === "coop" && !!coopId });
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { buyer_name: "", buyer_email: "", amount: 0, currency: "USD", description: "", shipment_id: "" },
  });
  const amount = Number(form.watch("amount")) || 0;
  const currency = form.watch("currency");
  const shipmentId = form.watch("shipment_id") ?? "";
  const openLots = (shipments.data ?? []).filter((shipment) => !shipment.invoice_id);
  const chosen = openLots.find((shipment) => shipment.id === shipmentId);

  const create = useMutation({
    mutationFn: (v: Values) =>
      api.createInvoice({
        buyer_name: v.buyer_name,
        buyer_email: v.buyer_email,
        amount: v.amount,
        currency: v.currency,
        description: v.description,
        type,
        coop_id: coopId,
        account_id: accountId,
        shipment_id: v.shipment_id || undefined,
      }),
    onSuccess: (inv) => {
      setCreated(inv);
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      if (coopId) void qc.invalidateQueries({ queryKey: ["coop", coopId, "shipments"] });
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
            {type === "coop" && (
              <F label="Shipment">
                <select {...form.register("shipment_id")} className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="">New shipment</option>
                  {openLots.map((shipment) => (
                    <option key={shipment.id} value={shipment.id}>
                      {shipment.reference} · {shipment.product} · {shipment.quantity_kg} kg
                    </option>
                  ))}
                </select>
              </F>
            )}

            {amount > 0 && (
              <div className="rounded-2xl border border-border bg-card p-4 text-sm">
                <p className="mb-2 text-xs tracking-wide text-amber uppercase">Estimate — final rate set at payment</p>
                <div className="flex justify-between"><span className="text-muted-foreground">You receive about</span><span className="tabular text-lime">{formatKesCents(netPreview)}</span></div>
                {type === "coop" && chosen && chosen.farmers.length > 0 && (
                  <div className="mt-3 max-h-48 space-y-1 overflow-y-auto border-t border-border pt-3">
                    {kiloShares(netPreview, chosen.farmers).map((row) => (
                      <div key={row.account_id} className="flex justify-between text-xs">
                        <span>{memberName(members.data, row.account_id)} · {row.kilos} kg</span>
                        <span className="tabular">{formatKesCents(row.cents)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {type === "coop" && (
                  <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                    {chosen
                      ? chosen.farmers.length > 0
                        ? "These farmers are paid from this shipment, by the kilos they delivered."
                        : "Add farmers on this shipment. They are the ones paid."
                      : "A new shipment opens with this invoice. Add the farmers there before the split."}
                  </p>
                )}
              </div>
            )}
            {create.isError && (
              <p role="alert" className="text-sm text-terracotta">
                {create.error instanceof ApiError ? create.error.message : "Couldn't create the invoice. Try again."}
              </p>
            )}
            <Button type="submit" className="h-12 w-full" disabled={create.isPending}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />} Create payment link
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

function memberName(members: { account_id: string; full_name?: string | null }[] | undefined, accountId: string) {
  return members?.find((member) => member.account_id === accountId)?.full_name ?? accountName(accountId);
}

function kiloShares(net: number, farmers: ShipmentFarmer[]) {
  const total = farmers.reduce((sum, farmer) => sum + farmer.kilos, 0);
  if (total <= 0 || net <= 0) return farmers.map((farmer) => ({ ...farmer, cents: 0 }));
  const rows = farmers.map((farmer) => {
    const exact = (net * farmer.kilos) / total;
    const cents = Math.floor(exact);
    return { ...farmer, cents, remainder: exact - cents };
  });
  let left = net - rows.reduce((sum, row) => sum + row.cents, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || b.kilos - a.kilos)) {
    if (left <= 0) break;
    row.cents += 1;
    left -= 1;
  }
  return rows;
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
