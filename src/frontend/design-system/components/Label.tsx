import { type LabelHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  required?: boolean;
};

export function Label({ className, children, required, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        "text-sm font-medium text-slate-700 dark:text-slate-200",
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <span
          className="ml-0.5 inline font-semibold text-red-600 dark:text-red-400"
          aria-hidden="true"
        >
          *
        </span>
      ) : null}
    </label>
  );
}
