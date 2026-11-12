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
        "flex min-h-[80px] w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink transition-colors",
        "placeholder:text-ink-3",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
        "disabled:cursor-not-allowed disabled:bg-page disabled:opacity-60",
        invalid &&
          "border-danger focus-visible:border-danger focus-visible:ring-danger/20",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";
