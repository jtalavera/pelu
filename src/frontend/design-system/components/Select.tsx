import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex min-h-[44px] w-full appearance-none rounded-md border border-slate-300 bg-white bg-[length:1rem] bg-[right_0.5rem_center] bg-no-repeat px-3 py-2 pr-9 text-sm text-slate-900 shadow-sm transition-colors sm:h-9 sm:min-h-0 sm:py-1",
        "bg-[url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27none%27 viewBox=%270 0 20 20%27%3E%3Cpath stroke=%27%2364748b%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%271.5%27 d=%27m6 8 4 4 4-4%27/%3E%3C/svg%3E')]",
        "dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100",
        "dark:bg-[url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27none%27 viewBox=%270 0 20 20%27%3E%3Cpath stroke=%2394a3b8 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%271.5%27 d=%27m6 8 4 4 4-4%27/%3E%3C/svg%3E')]",
        "focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 dark:focus-visible:border-indigo-400 dark:focus-visible:ring-indigo-400/25",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 dark:disabled:bg-slate-800",
        invalid &&
          "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/20 dark:border-red-500 dark:focus-visible:ring-red-500/30",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    >
      {children}
    </select>
  ),
);

Select.displayName = "Select";
