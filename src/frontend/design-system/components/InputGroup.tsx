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
        "flex min-h-[44px] w-full min-w-0 items-stretch overflow-hidden rounded-xl border border-line bg-surface transition-colors sm:h-9 sm:min-h-0",
        "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
        invalid &&
          "border-danger focus-within:border-danger focus-within:ring-danger/20",
        className,
      )}
      {...props}
    >
      {start ? (
        <span className="flex shrink-0 items-center border-r border-line bg-page px-2.5 text-sm text-ink-3">
          {start}
        </span>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 items-center">{children}</div>
      {end ? (
        <span className="flex shrink-0 items-center border-l border-line bg-page px-2.5">
          {end}
        </span>
      ) : null}
    </div>
  );
}
