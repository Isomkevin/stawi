import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "pending" | "danger" | "live";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground border-border",
  success: "bg-[color-mix(in_oklab,var(--lime)_16%,transparent)] text-lime border-[color-mix(in_oklab,var(--lime)_35%,transparent)]",
  pending: "bg-[color-mix(in_oklab,var(--amber)_14%,transparent)] text-amber border-[color-mix(in_oklab,var(--amber)_35%,transparent)]",
  danger: "bg-[color-mix(in_oklab,var(--terracotta)_16%,transparent)] text-terracotta border-[color-mix(in_oklab,var(--terracotta)_38%,transparent)]",
  live: "bg-[color-mix(in_oklab,var(--sage)_18%,transparent)] text-foreground border-[color-mix(in_oklab,var(--sage)_40%,transparent)]",
};

const statusMap: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "pending" },
  paid: { label: "Paid", tone: "live" },
  converting: { label: "Converting", tone: "live" },
  settling: { label: "Sending", tone: "live" },
  completed: { label: "Paid out", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  sent: { label: "Sending", tone: "live" },
  confirmed: { label: "Paid", tone: "success" },
  verified: { label: "Verified", tone: "success" },
  missing: { label: "Missing", tone: "danger" },
  invited: { label: "Invited", tone: "pending" },
  active: { label: "Active", tone: "success" },
};

export function StatusChip({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const meta = statusMap[status] ?? { label: status, tone: "neutral" as Tone };
  const isLive = meta.tone === "live";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        toneClasses[meta.tone],
        className,
      )}
    >
      {isLive && <span className="size-1.5 animate-pulse rounded-full bg-lime" />}
      {label ?? meta.label}
    </span>
  );
}
