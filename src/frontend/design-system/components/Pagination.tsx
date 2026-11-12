import { type ButtonHTMLAttributes, type ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";
import { IconChevronRight } from "./Icon";

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
        <IconChevronRight className="size-4 rotate-180" />
        <span>{previousLabel}</span>
      </PaginationButton>
      <span className="min-w-[8rem] text-center text-sm font-medium text-ink-2">
        {page} / {pageCount}
      </span>
      <PaginationButton
        type="button"
        disabled={!canNext}
        onClick={() => onPageChange(page + 1)}
        aria-label={nextLabel}
      >
        <span>{nextLabel}</span>
        <IconChevronRight className="size-4" />
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
        "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink-2 shadow-sm transition-colors sm:h-9 sm:min-h-0",
        "hover:bg-page hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:pointer-events-none disabled:opacity-50",
        "",
        className,
      )}
      {...props}
    />
  );
}
