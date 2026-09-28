import { motion } from "motion/react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  hint,
  spark,
  index = 0,
  accent = false,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  spark?: number[];
  index?: number;
  accent?: boolean;
  className?: string;
}) {
  const data = (spark ?? []).map((v, i) => ({ i, v }));
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-soft",
        className,
      )}
    >
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "text-display mt-2 text-2xl tabular",
          accent ? "text-lime" : "text-foreground",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {data.length > 1 && (
        <div className="mt-3 h-10">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${label.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--sage)" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="var(--sage)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke="var(--sage)"
                strokeWidth={1.5}
                fill={`url(#spark-${label.replace(/\W/g, "")})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  );
}
