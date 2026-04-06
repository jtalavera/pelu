import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  /** Use inside `InputGroup`; omits outer border and focus ring (group provides them). */
  unstyled?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, unstyled, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-9 w-full px-3 py-1 text-sm text-slate-900 transition-colors placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500",
        "disabled:cursor-not-allowed disabled:opacity-60",
        unstyled
          ? "h-full min-h-0 w-full border-0 bg-transparent shadow-none focus-visible:outline-none"
          : [
              "flex min-h-[44px] rounded-md border border-slate-300 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-900 sm:h-9 sm:min-h-0",
              "focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 dark:focus-visible:border-indigo-400 dark:focus-visible:ring-indigo-400/25",
              "disabled:bg-slate-50 dark:disabled:bg-slate-800",
            ],
        !unstyled &&
          invalid &&
          "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/20 dark:border-red-500 dark:focus-visible:ring-red-500/30",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  ),
);

Input.displayName = "Input";
