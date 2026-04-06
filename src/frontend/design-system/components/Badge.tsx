import { type HTMLAttributes } from "react";
import { cn } from "../lib/cn";

const variants = {
  default:
    "border-transparent bg-slate-900 text-slate-50 dark:bg-slate-100 dark:text-slate-900",
  secondary:
    "border-transparent bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-slate-100",
  outline:
    "border-slate-200 text-slate-900 dark:border-slate-600 dark:text-slate-100",
  success:
    "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  warning:
    "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  destructive:
    "border-transparent bg-red-100 text-red-800 dark:bg-red-900/45 dark:text-red-300",
  info: "border-transparent bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300",
} as const;

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variants;
};

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
