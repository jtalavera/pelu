import { type ButtonHTMLAttributes, type ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

export type PaginationProps = ComponentPropsWithoutRef<"nav"> & {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  previousLabel: string;
  nextLabel: string;
  "aria-label"?: string;
};

export function Pagination({
  className,
  page,
  pageCount,
  onPageChange,
  previousLabel,
  nextLabel,
  "aria-label": ariaLabel = "Pagination",
  ...props
}: PaginationProps) {
  const canPrev = page > 1;
  const canNext = page < pageCount;

  return (
    <nav
      className={cn("flex flex-wrap items-center justify-center gap-2", className)}
      aria-label={ariaLabel}
      {...props}
    >
      <PaginationButton
        type="button"
        disabled={!canPrev}
        onClick={() => onPageChange(page - 1)}
        aria-label={previousLabel}
      >
        {previousLabel}
      </PaginationButton>
      <span className="min-w-[8rem] text-center text-sm text-slate-600 dark:text-slate-400">
        {page} / {pageCount}
      </span>
      <PaginationButton
        type="button"
        disabled={!canNext}
        onClick={() => onPageChange(page + 1)}
        aria-label={nextLabel}
      >
        {nextLabel}
      </PaginationButton>
    </nav>
  );
}

function PaginationButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors sm:h-9 sm:min-h-0",
        "hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
        "disabled:pointer-events-none disabled:opacity-50",
        "dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:outline-indigo-400",
        className,
      )}
      {...props}
    />
  );
}
