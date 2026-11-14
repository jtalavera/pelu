import { createContext, useContext } from "react";
import type { TFunction } from "i18next";
import type { Overview, OverviewStatus, PeriodInfo } from "../../api/commissions";
import { formatParaguayDate } from "../../lib/paraguayDateTime";

/** The current period's overview, shared by every section of the Comisiones screen (HU-COM-15). */
export type OverviewState = {
  overview: Overview | null;
  error: string | null;
  /** Reads the overview again (after generating, approving, paying, changing rules…). */
  refresh: () => Promise<void>;
};

export const OverviewContext = createContext<OverviewState>({ overview: null, error: null, refresh: async () => {} });

export const useOverview = () => useContext(OverviewContext);

/** How each state of a professional in a period is told, colored and acted on. */
export const STATUS_META: Record<
  OverviewStatus,
  { chip: string; action: "GENERATE" | "APPROVE" | "PAY" | "VIEW" | null; dot: string }
> = {
  UNSETTLED: { chip: "bg-warning-lt text-warning", action: "GENERATE", dot: "bg-[#F0B35A]" },
  DRAFT: { chip: "bg-primary-lt text-primary", action: "APPROVE", dot: "bg-[#8FC1C5]" },
  APPROVED: { chip: "bg-success-lt text-success", action: "PAY", dot: "bg-[#4FA97A]" },
  PAID: { chip: "bg-bg text-ink-2", action: "VIEW", dot: "bg-ink-3" },
  NONE: { chip: "bg-bg text-ink-3", action: null, dot: "bg-line" },
};

/** «Quincena del 01/11/2026 al 14/11/2026» (the wording follows the salon's periodicity). */
export function periodLabel(t: TFunction, period: PeriodInfo | null | undefined, locale: string): string {
  if (!period?.from || !period?.to) return t("femme.commissions.period.MANUAL");
  const from = formatParaguayDate(period.from + "T12:00:00", locale);
  const to = formatParaguayDate(period.to + "T12:00:00", locale);
  return t(`femme.commissions.period.${period.periodicity}`, { from, to });
}

/** What still needs doing in the setup (steps 2 and 3 are the only ones that can be pending). */
export function setupProgress(o: Overview) {
  const groupsDone = o.groupCount > 0 && o.ungroupedServices === 0;
  const rulesDone = o.groupCount > 0 && o.professionalsWithoutRules === 0 && o.rows.length > 0;
  return {
    groupsDone,
    rulesDone,
    aguinaldoDone: o.aguinaldoEnabled,
    /** Required steps still pending (shown as the badge of «Configurar»). */
    pending: (groupsDone ? 0 : 1) + (rulesDone ? 0 : 1),
    /** Nothing was set up yet: the first-time guide replaces the home. */
    firstTime: o.groupCount === 0,
  };
}
