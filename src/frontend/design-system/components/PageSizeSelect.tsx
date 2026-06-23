import { useId } from "react";
import { cn } from "../lib/cn";

const DEFAULT_PAGE_SIZES = [10, 25, 50] as const;

export type PageSizeSelectProps = {
  value: number;
  onChange: (size: number) => void;
  label: string;
  pageSizes?: number[];
  className?: string;
};

/**
 * A compact rows-per-page selector.
 *
 * Renders a native `<select>` with standard page-size options (10, 25, 50 by default).
 * Wrap with any layout container as needed — the control itself is unstyled for width.
 */
export function PageSizeSelect({
  value,
  onChange,
  label,
  pageSizes = DEFAULT_PAGE_SIZES as unknown as number[],
  className,
}: PageSizeSelectProps) {
  const id = useId();
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <label
        htmlFor={id}
        className="whitespace-nowrap text-sm text-slate-600 dark:text-slate-400"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 shadow-sm",
          "focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20",
          "dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100",
          "dark:focus-visible:border-indigo-400 dark:focus-visible:ring-indigo-400/25",
        )}
      >
        {pageSizes.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}
