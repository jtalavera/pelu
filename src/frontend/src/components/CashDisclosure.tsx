import type { ReactNode } from "react";

/** One folded line of the cash screens: label, optional counter badge, chevron. */
export function Disclosure({
  id,
  label,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        data-testid={`cash-section-${id}`}
        onClick={onToggle}
        className="flex min-h-12 w-full items-center justify-between gap-3 text-left font-bold text-ink"
      >
        <span>{label}</span>
        <span className="flex items-center gap-2.5 text-ink-3">
          {count !== undefined && (
            <span
              className={`inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full px-2 text-[13px] font-extrabold ${
                count > 0 ? "bg-primary-lt text-primary" : "bg-line text-ink-3"
              }`}
            >
              {count}
            </span>
          )}
          <span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>
            ⌄
          </span>
        </span>
      </button>
      {open ? (
        <div id={`${id}-body`} className="pb-3 text-sm">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-ink-3">{label}</span>
      <span className="min-w-0 break-words text-right font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

