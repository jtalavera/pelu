import { type HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type SeparatorProps = HTMLAttributes<HTMLHRElement> & {
  orientation?: "horizontal" | "vertical";
};

export function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorProps) {
  return (
    <hr
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 border-0 bg-slate-200 dark:bg-slate-700",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}
