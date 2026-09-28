import { Delete } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export function PinPad({
  value,
  onChange,
  length = 4,
  error,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  error?: string | null;
  className?: string;
}) {
  const press = (digit: string) => {
    if (value.length >= length) return;
    onChange(value + digit);
  };

  return (
    <div className={cn("w-full max-w-xs", className)}>
      <motion.div
        animate={error ? { x: [0, -8, 8, -5, 0] } : { x: 0 }}
        transition={{ duration: 0.35 }}
        className="flex justify-center gap-3"
      >
        {Array.from({ length }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "size-4 rounded-full border transition-colors",
              i < value.length ? "border-lime bg-lime" : "border-border bg-transparent",
              error && "border-terracotta",
            )}
          />
        ))}
      </motion.div>
      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-terracotta">
          {error}
        </p>
      )}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <PadButton key={digit} onClick={() => press(digit)}>
            {digit}
          </PadButton>
        ))}
        <span />
        <PadButton onClick={() => press("0")}>0</PadButton>
        <PadButton onClick={() => onChange(value.slice(0, -1))} aria-label="Delete last digit">
          <Delete className="size-5" strokeWidth={1.75} />
        </PadButton>
      </div>
    </div>
  );
}

function PadButton({
  children,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-14 min-h-[44px] place-items-center rounded-xl border border-border bg-card text-xl font-medium tabular transition-transform active:scale-95 hover:border-sage"
      {...rest}
    >
      {children}
    </button>
  );
}
