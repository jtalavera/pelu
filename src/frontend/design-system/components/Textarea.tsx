import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors",
        "placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500",
        "focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 dark:focus-visible:border-indigo-400 dark:focus-visible:ring-indigo-400/25",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 dark:disabled:bg-slate-800",
        invalid &&
          "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/20 dark:border-red-500 dark:focus-visible:ring-red-500/30",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";
