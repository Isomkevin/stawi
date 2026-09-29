import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, ShieldCheck, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amountLabel: string;
  payee: string;
  reference: string;
  onApproved: () => void;
  onDeclined: () => void;
};

/**
 * Mock-mode stand-in for Payaza. Live checkout uses the Payaza Web SDK
 * from the pay page (openPayazaCheckout) and does not call this dialog.
 */
export function PayazaCheckout({
  open,
  onOpenChange,
  amountLabel,
  payee,
  reference,
  onApproved,
  onDeclined,
}: Props) {
  const [phase, setPhase] = useState<"form" | "processing">("form");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!open) setPhase("form");
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [open]);

  const approve = () => {
    setPhase("processing");
    timers.current.push(window.setTimeout(onApproved, 1600));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl border-border bg-card sm:rounded-2xl">
        <DialogHeader className="text-left">
          <span className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-sage uppercase">
            <Lock className="size-3.5" strokeWidth={2} />
            Secure checkout
          </span>
          <DialogTitle className="text-display text-2xl">Payaza sandbox</DialogTitle>
          <DialogDescription>
            Paying {payee} · ref {reference}
          </DialogDescription>
        </DialogHeader>

        {phase === "form" ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-secondary/60 p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase">Amount due</p>
              <p className="text-display mt-1 text-3xl tabular">{amountLabel}</p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              This is a simulated checkout — no card is charged and no real money moves. Choose an
              outcome to see how Stawi handles it.
            </p>
            <div className="space-y-2">
              <Button onClick={approve} className="w-full min-h-[48px] text-base">
                <ShieldCheck className="size-4" strokeWidth={2} />
                Approve payment
              </Button>
              <Button
                variant="outline"
                className="w-full min-h-[44px] border-border bg-transparent"
                onClick={onDeclined}
              >
                <X className="size-4" strokeWidth={2} />
                Simulate a decline
              </Button>
              <Button
                variant="ghost"
                className="w-full min-h-[44px] text-muted-foreground"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <Loader2 className="size-8 animate-spin text-lime" strokeWidth={2} />
            <div>
              <p className="font-medium">Confirming with your bank…</p>
              <p className="mt-1 text-sm text-muted-foreground">This takes a moment.</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
