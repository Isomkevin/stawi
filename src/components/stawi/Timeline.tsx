import { motion } from "motion/react";
import { Check, Circle, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type TimelineStep = {
  label: string;
  detail?: string | undefined;
  at?: string | undefined;
  state: "done" | "active" | "todo" | "failed";
};

export function Timeline({ steps, className }: { steps: TimelineStep[]; className?: string }) {
  return (
    <ol className={cn("relative space-y-5 pl-7", className)}>
      <span className="absolute top-2 bottom-2 left-[9px] w-px bg-border" aria-hidden />
      {steps.map((step, index) => (
        <motion.li
          key={step.label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.06, duration: 0.3 }}
          className="relative"
        >
          <span
            className={cn(
              "absolute top-0.5 -left-7 grid size-[19px] place-items-center rounded-full border",
              step.state === "done" && "border-lime bg-lime text-[oklch(0.22_0.035_152)]",
              step.state === "active" && "border-lime text-lime",
              step.state === "todo" && "border-border text-muted-foreground",
              step.state === "failed" && "border-terracotta bg-terracotta text-background",
            )}
          >
            {step.state === "done" && <Check className="size-3" strokeWidth={2.5} />}
            {step.state === "failed" && <X className="size-3" strokeWidth={2.5} />}
            {step.state === "active" && (
              <span className="size-2 animate-pulse rounded-full bg-lime" />
            )}
            {step.state === "todo" && <Circle className="size-2" strokeWidth={1.75} />}
          </span>
          <p
            className={cn(
              "text-sm font-medium",
              step.state === "todo" ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {step.label}
          </p>
          {step.detail && <p className="text-xs text-muted-foreground tabular">{step.detail}</p>}
          {step.at && <p className="mt-0.5 text-xs text-muted-foreground/70 tabular">{step.at}</p>}
        </motion.li>
      ))}
    </ol>
  );
}
