import { type LabelHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  required?: boolean;
};

export function Label({ className, children, required, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        "text-sm font-medium text-ink-2",
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <span
          className="ml-0.5 inline font-semibold text-danger"
          aria-hidden="true"
        >
          *
        </span>
      ) : null}
    </label>
  );
}
