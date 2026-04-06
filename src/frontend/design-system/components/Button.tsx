import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

const variants = {
  primary:
    "bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:bg-indigo-400 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:focus-visible:outline-indigo-400 dark:disabled:bg-indigo-800",
  secondary:
    "bg-white text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600 dark:hover:bg-slate-700",
  outline:
    "border border-slate-300 bg-transparent text-slate-900 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800",
  ghost:
    "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
  /** Same visual weight as ghost; use when naming matches design-system “tertiary” */
  tertiary:
    "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
  danger:
    "bg-red-600 text-white shadow-sm hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:bg-red-700 dark:hover:bg-red-600 dark:focus-visible:outline-red-500",
} as const;

const sizes = {
  sm: "min-h-[44px] rounded-md px-2.5 text-xs sm:h-8 sm:min-h-0",
  md: "min-h-[44px] rounded-md px-3.5 text-sm sm:h-9 sm:min-h-0",
  lg: "min-h-[44px] rounded-md px-4 text-sm sm:h-10 sm:min-h-0",
  icon:
    "min-h-[44px] min-w-[44px] rounded-md p-0 sm:h-9 sm:min-h-0 sm:min-w-0 sm:w-9",
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading,
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={props.type ?? "button"}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  ),
);

Button.displayName = "Button";
