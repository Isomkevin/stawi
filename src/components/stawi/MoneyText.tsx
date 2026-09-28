import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { formatKesCents } from "@/lib/format";

type Props = {
  cents: number;
  className?: string;
  countUp?: boolean;
  compactSymbol?: boolean;
};

export function MoneyText({ cents, className, countUp = false }: Props) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(countUp && !reduced ? 0 : cents);
  const previous = useRef(cents);

  useEffect(() => {
    if (!countUp || reduced) {
      setValue(cents);
      return;
    }
    const controls = animate(previous.current, cents, {
      duration: 1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setValue(Math.round(latest)),
    });
    previous.current = cents;
    return () => controls.stop();
  }, [cents, countUp, reduced]);

  return <span className={cn("tabular", className)}>{formatKesCents(value)}</span>;
}
