import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type InputGroupProps = HTMLAttributes<HTMLDivElement> & {
  /** Shown before the control (icon, prefix text, select) */
  start?: ReactNode;
  /** Shown after the control (icon, suffix, action button) */
  end?: ReactNode;
  invalid?: boolean;
};

/**
 * Wraps an Input (or select) with optional start/end slots. Place one focusable control as the direct child.
 */
export function InputGroup({
  className,
  start,
  end,
  invalid,
  children,
  ...props
}: InputGroupProps) {
  return (
    <div
      className={cn(
        "flex min-h-[44px] w-full min-w-0 items-stretch overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm transition-colors dark:border-slate-600 dark:bg-slate-900 sm:h-9 sm:min-h-0",
        "focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 dark:focus-within:border-indigo-400 dark:focus-within:ring-indigo-400/25",
        invalid &&
          "border-red-500 focus-within:border-red-500 focus-within:ring-red-500/20 dark:border-red-500 dark:focus-within:ring-red-500/30",
        className,
      )}
      {...props}
    >
      {start ? (
        <span className="flex shrink-0 items-center border-r border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400">
          {start}
        </span>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 items-center">{children}</div>
      {end ? (
        <span className="flex shrink-0 items-center border-l border-slate-200 bg-slate-50 px-2.5 dark:border-slate-700 dark:bg-slate-800/80">
          {end}
        </span>
      ) : null}
    </div>
  );
}
