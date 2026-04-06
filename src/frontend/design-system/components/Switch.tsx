import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, disabled, ...props }, ref) => (
    <span
      className={cn(
        "inline-flex cursor-pointer items-center",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
        <input
          ref={ref}
          type="checkbox"
          role="switch"
          disabled={disabled}
          className="peer sr-only"
          {...props}
        />
        <span
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full bg-slate-200 transition-colors dark:bg-slate-600",
            "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo-600 dark:peer-focus-visible:outline-indigo-400",
            "peer-checked:bg-indigo-600 peer-disabled:opacity-50 dark:peer-checked:bg-indigo-500",
          )}
          aria-hidden
        />
        <span
          className={cn(
            "pointer-events-none absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform dark:bg-slate-100",
            "peer-checked:translate-x-4",
          )}
          aria-hidden
        />
      </span>
    </span>
  ),
);

Switch.displayName = "Switch";
