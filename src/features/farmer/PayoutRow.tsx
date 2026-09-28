import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { StatusChip } from "@/components/stawi/StatusChip";
import { formatKesCents, formatTime } from "@/lib/format";
import type { Payout } from "@/lib/types";
import { cn } from "@/lib/utils";

export function payoutTitle(p: Payout, invoiceLabel?: string) {
  return p.kind === "withdrawal" ? "Withdrawal to M-Pesa" : invoiceLabel ?? "Coffee sale payment";
}

export function PayoutRow({ payout, onClick }: { payout: Payout; onClick?: () => void }) {
  const credit = payout.kind === "credit";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-sage"
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full",
          credit ? "bg-lime/15 text-lime" : "bg-secondary text-foreground",
        )}
      >
        {credit ? <ArrowDownLeft className="size-5" /> : <ArrowUpRight className="size-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{payoutTitle(payout)}</span>
        <span className="text-xs text-muted-foreground tabular">{formatTime(payout.created_at)}</span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <span className={cn("text-sm font-medium tabular", credit && "text-lime")}>
          {credit ? "+" : "−"}
          {formatKesCents(payout.amount_kes_cents)}
        </span>
        <StatusChip status={payout.status} />
      </span>
    </button>
  );
}
