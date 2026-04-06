import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

const variants = {
  default:
    "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100",
  info: "border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-100",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100",
  warning:
    "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
  destructive:
    "border-red-200 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100",
} as const;

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  variant?: keyof typeof variants;
  title?: string;
  icon?: ReactNode;
};

export function Alert({
  className,
  variant = "default",
  title,
  icon,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "relative w-full rounded-lg border px-4 py-3 text-sm",
        variants[variant],
        className,
      )}
      {...props}
    >
      <div className="flex gap-3">
        {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
        <div className="min-w-0 flex-1 space-y-1">
          {title ? <p className="font-medium leading-none">{title}</p> : null}
          <div className="leading-relaxed [&_p]:m-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
