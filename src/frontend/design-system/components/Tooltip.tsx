import { cloneElement, useId, type HTMLAttributes, type ReactElement } from "react";
import { cn } from "../lib/cn";

export type TooltipProps = HTMLAttributes<HTMLSpanElement> & {
  label: string;
  children: ReactElement<{ className?: string; "aria-describedby"?: string }>;
};

/**
 * Hover and keyboard focus reveal. The child must be a single element that can receive `className` and `aria-describedby`.
 */
export function Tooltip({ className, label, children, ...props }: TooltipProps) {
  const tipId = useId().replace(/:/g, "");
  const trigger = cloneElement(children, {
    "aria-describedby": tipId,
    className: cn("peer", children.props.className),
  });

  return (
    <span className={cn("relative inline-flex", className)} {...props}>
      {trigger}
      <span
        id={tipId}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-md transition-opacity",
          "peer-hover:opacity-100 peer-focus-visible:opacity-100",
          "dark:bg-slate-700",
        )}
      >
        {label}
      </span>
    </span>
  );
}
