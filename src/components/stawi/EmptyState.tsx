import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "motif grain relative overflow-hidden rounded-2xl border border-border bg-card/60 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mx-auto grid size-12 place-items-center rounded-full border border-border bg-card">
        <Icon className="size-5 text-sage" strokeWidth={1.75} />
      </span>
      <h3 className="text-display mt-4 text-lg">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
