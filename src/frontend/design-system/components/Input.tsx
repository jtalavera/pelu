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
        "h-9 w-full px-3 py-1 text-sm text-ink transition-colors placeholder:text-ink-3",
        "disabled:cursor-not-allowed disabled:opacity-60",
        unstyled
          ? "h-full min-h-0 w-full border-0 bg-transparent shadow-none focus-visible:outline-none"
          : [
              "flex min-h-[44px] rounded-xl border border-line bg-surface sm:h-9 sm:min-h-0",
              "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
              "disabled:bg-page",
            ],
        !unstyled &&
          invalid &&
          "border-danger focus-visible:border-danger focus-visible:ring-danger/20",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  ),
);

Input.displayName = "Input";
