import { cn } from "../lib/cn";
import { type SVGAttributes } from "react";

const stroke = { strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const base =
  "inline-block shrink-0 size-5 text-slate-500 dark:text-slate-400";

export function IconSearch({
  className,
  ...props
}: SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={cn(base, className)}
      {...stroke}
      {...props}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function IconUser({ className, ...props }: SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={cn(base, className)}
      {...stroke}
      {...props}
    >
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function IconChevronRight({
  className,
  ...props
}: SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={cn("inline-block shrink-0 size-4", className)}
      {...stroke}
      {...props}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function IconMenu({ className, ...props }: SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={cn(base, className)}
      {...stroke}
      {...props}
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
