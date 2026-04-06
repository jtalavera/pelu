import { useId, type HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type ProgressProps = HTMLAttributes<HTMLDivElement> & {
  /** 0–100 */
  value: number;
  max?: number;
  label?: string;
};

export function Progress({
  className,
  value,
  max = 100,
  label,
  ...props
}: ProgressProps) {
  const labelId = useId();
  const clamped = Math.min(max, Math.max(0, value));
  const pct = max > 0 ? Math.round((clamped / max) * 100) : 0;
  return (
    <div
      className={cn("w-full space-y-1", className)}
      {...props}
    >
      {label ? (
        <div
          id={labelId}
          className="flex justify-between text-xs text-slate-500 dark:text-slate-400"
        >
          <span>{label}</span>
          <span aria-hidden>{pct}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : "Progress"}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
      >
        <div
          className="h-full rounded-full bg-indigo-600 transition-[width] duration-300 dark:bg-indigo-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
