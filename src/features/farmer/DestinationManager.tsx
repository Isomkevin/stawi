import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Landmark, Smartphone, Trash2 } from "lucide-react";
import { StatusChip } from "@/components/stawi/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { maskDestination } from "@/lib/format";
import type { Account } from "@/lib/types";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.code : "Something went wrong");

export function DestinationManager({ account }: { account: Account | undefined }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"mpesa" | "bank">("mpesa");
  const [details, setDetails] = useState("");
  const [name, setName] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["account", account?.id] });
  const reset = () => {
    setDetails("");
    setName(null);
  };

  const lookup = useMutation({
    mutationFn: () => api.resolveAccountName(type, details),
    onSuccess: setName,
    onError: (e) => toast.error(errMsg(e)),
  });
  const add = useMutation({
    mutationFn: () => api.addDestination(account!.id, { type, details, account_name: name! }),
    onSuccess: () => {
      toast.success("Destination added");
      setOpen(false);
      reset();
      void refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: (destId: string) => api.removeDestination(account!.id, destId),
    onSuccess: () => {
      toast.success("Destination removed");
      void refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const list = account?.payout_destinations ?? [];

  return (
    <>
      {list.map((d) => (
        <div key={d.id} className="flex items-center gap-3 py-1">
          {d.type === "mpesa" ? <Smartphone className="size-5 text-lime" /> : <Landmark className="size-5 text-sage" />}
          <div className="flex-1 text-sm">
            <p className="font-medium">{maskDestination(d.details)}</p>
            <p className="text-xs text-muted-foreground">{d.account_name}</p>
          </div>
          <StatusChip status={d.is_verified ? "verified" : "pending"} label={d.is_verified ? "Verified" : "Checking"} />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${maskDestination(d.details)}`}
            disabled={list.length <= 1 || remove.isPending}
            onClick={() => remove.mutate(d.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" className="mt-2 h-11 w-full" onClick={() => setOpen(true)} disabled={!account}>
        Add a destination
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a payout destination</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {(["mpesa", "bank"] as const).map((t) => (
              <Button key={t} variant={type === t ? "default" : "outline"} onClick={() => { setType(t); reset(); }}>
                {t === "mpesa" ? "M-Pesa" : "Bank"}
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="dest-details">{type === "mpesa" ? "M-Pesa number" : "Bank account number"}</Label>
            <Input
              id="dest-details"
              inputMode="numeric"
              value={details}
              placeholder={type === "mpesa" ? "+254 7XX XXX XXX" : "0110 0123 4567 00"}
              onChange={(e) => { setDetails(e.target.value); setName(null); }}
            />
          </div>
          {name ? (
            <p className="text-sm">Registered to <span className="font-medium">{name}</span></p>
          ) : null}
          {name ? (
            <Button className="h-11" onClick={() => add.mutate()} disabled={add.isPending}>
              {add.isPending ? "Adding…" : "Confirm and add"}
            </Button>
          ) : (
            <Button className="h-11" onClick={() => lookup.mutate()} disabled={!details.trim() || lookup.isPending}>
              {lookup.isPending ? "Checking…" : "Check account name"}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
