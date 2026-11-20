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

/**
 * What still needs doing in the setup (HU-COM-20): a group without its % (it pays the general one),
 * and aguinaldo on while nobody retains. A professional with nothing loaded just earns the usual
 * % of each service, so there is no step «rules per professional» any more.
 */
export function setupProgress(o: Overview) {
  const groupsDone = o.groupCount > 0 && o.groupsWithoutPercent === 0;
  // Aguinaldo on but nobody retains yet: it was switched on and never finished. Some professionals
  // not retaining is normal, so only «nobody» counts as missing.
  const aguinaldoPending = o.aguinaldoEnabled && o.professionalsRetaining === 0;
  return {
    groupsDone,
    aguinaldoDone: o.aguinaldoEnabled,
    aguinaldoPending,
    /** Steps still pending (shown as the badge of «Configurar»). */
    pending: (o.groupCount > 0 && o.groupsWithoutPercent > 0 ? 1 : 0) + (aguinaldoPending ? 1 : 0),
    /** Nothing was set up yet: the first-time guide replaces the home. */
    firstTime: o.groupCount === 0,
  };
}

/**
 * What the period looks like in people and money (HU-COM-17): each state with its professionals and
 * amount, how much is already paid and how much is left to pay, and who has nothing to settle.
 */
export function summarize(o: Overview) {
  const by = <S extends OverviewStatus>(status: S) => {
    const rows = o.rows.filter((r) => r.status === status);
    return { status, rows, people: rows.length, amount: rows.reduce((a, r) => a + r.amount, 0) };
  };
  const steps = [by("UNSETTLED"), by("DRAFT"), by("APPROVED"), by("PAID")] as const;
  const none = by("NONE");
  const paid = steps[3].amount;
  const pending = steps[0].amount + steps[1].amount + steps[2].amount;
  const withMovements = o.rows.length - none.people;
  return {
    steps,
    none,
    paid,
    pending,
    paidPeople: steps[3].people,
    pendingPeople: steps[0].people + steps[1].people + steps[2].people,
    total: paid + pending,
    active: o.rows.length,
    withMovements,
  };
}
