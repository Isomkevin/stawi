import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Banknote, CreditCard, RefreshCw, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const nodes = [
  { icon: CreditCard, label: "Buyer pays", sub: "USD, EUR, GBP" },
  { icon: RefreshCw, label: "Converted", sub: "Into shillings" },
  { icon: Users, label: "Split", sub: "By contribution" },
  { icon: Banknote, label: "Farmers paid", sub: "Same day, M-Pesa" },
];

export function FlowDiagram({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-stretch", className)}>
      {nodes.map((node, index) => (
        <div key={node.label} className="flex flex-1 items-center gap-3">
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: index * 0.18, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="grain relative w-full overflow-hidden rounded-2xl border border-border bg-card/70 p-4 shadow-soft backdrop-blur"
          >
            <motion.span
              aria-hidden
              className="absolute inset-x-0 top-0 h-px bg-lime"
              initial={reduced ? false : { scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.18 + 0.2, duration: 0.6 }}
              style={{ transformOrigin: "left" }}
            />
            <node.icon className="size-5 text-lime" strokeWidth={1.75} />
            <p className="mt-3 font-medium">{node.label}</p>
            <p className="text-sm text-muted-foreground">{node.sub}</p>
          </motion.div>
          {index < nodes.length - 1 && (
            <ArrowRight
              className="hidden size-4 shrink-0 text-sage md:block"
              strokeWidth={1.75}
              aria-hidden
            />
          )}
        </div>
      ))}
    </div>
  );
}
