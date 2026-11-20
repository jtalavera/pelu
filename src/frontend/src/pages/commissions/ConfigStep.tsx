import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** done = ✓ green · pending = amber number · optional = gray number (HU-COM-18). */
export type StepTone = "done" | "pending" | "optional";

const CIRCLE: Record<StepTone, string> = {
  done: "bg-success-lt text-success",
  pending: "bg-warning-lt text-warning",
  optional: "bg-bg text-ink-3",
};

/**
 * One collapsible step of «Configurar»: a circle (✓ or its number), the title, a one-line summary,
 * a short label on the right (the pill says what is missing) and a chevron. Only color in the circle
 * and the label marks what is pending; every border is the same.
 */
export function ConfigStep({
  n,
  title,
  summary,
  tone,
  pill,
  open,
  onToggle,
  children,
}: {
  n: number;
  title: string;
  summary: ReactNode;
  tone: StepTone;
  /** What is missing, for tone «pending». «done» and «optional» use their own label. */
  pill?: string;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const label = tone === "done" ? t("femme.commissions.config.stepDone") : tone === "optional" ? t("femme.commissions.config.stepOptional") : pill;
  return (
    <li className="rounded-card border border-line bg-surface shadow-sm" data-testid={`config-step-${n}`} data-tone={tone} data-open={open}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`config-step-${n}-body`}
        onClick={onToggle}
        data-testid={`config-step-${n}-toggle`}
        className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left sm:px-5"
      >
        <span
          aria-hidden
          data-testid={`config-step-${n}-badge`}
          className={`inline-flex size-[30px] flex-none items-center justify-center rounded-full text-[15px] font-extrabold ${CIRCLE[tone]}`}
        >
          {tone === "done" ? "✓" : n}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block font-heading text-[17px] font-extrabold text-ink">{title}</b>
          <span className="text-[13px] text-ink-3" data-testid={`config-step-${n}-summary`}>
            {summary}
          </span>
        </span>
        {label && (
          <span
            data-testid={`config-step-${n}-pill`}
            className={`flex-none text-[13px] font-extrabold ${
              tone === "pending" ? "rounded-full bg-warning-lt px-3 py-1 text-warning" : tone === "done" ? "text-success" : "text-ink-3"
            }`}
          >
            {label}
          </span>
        )}
        <span aria-hidden className={`flex-none text-lg text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}>
          ⌄
        </span>
      </button>
      {open && (
        <div id={`config-step-${n}-body`} className="border-t border-line" data-testid={`config-step-${n}-body`}>
          {children}
        </div>
      )}
    </li>
  );
}
