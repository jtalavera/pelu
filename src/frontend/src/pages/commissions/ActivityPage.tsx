import { NavLink, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MovementsTab } from "./MovementsTab";
import { ReportsTab } from "./ReportsTab";

/** Comisiones › Actividad: «Movimientos» (what happened) and «Reportes» (HU-COM-15). */
export default function ActivityPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const reports = params.get("tab") === "reports";
  const tab = (to: string, active: boolean, testId: string, label: string) => (
    <NavLink
      to={to}
      end
      data-testid={testId}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-10 flex-1 items-center justify-center rounded-[10px] px-3 text-sm font-bold ${
        active ? "bg-surface text-primary shadow-[0_1px_3px_rgba(10,31,51,0.15)]" : "text-ink-2"
      }`}
    >
      {label}
    </NavLink>
  );
  return (
    <div className="flex flex-col gap-4" data-testid="commissions-activity">
      <p className="px-0.5 text-sm text-ink-3">{t("femme.commissions.activity.intro")}</p>
      <div className="flex max-w-sm gap-1 rounded-2xl bg-primary-lt p-1">
        {tab("/app/commissions/actividad", !reports, "activity-tab-movements", t("femme.commissions.activity.movements"))}
        {tab("/app/commissions/actividad?tab=reports", reports, "activity-tab-reports", t("femme.commissions.activity.reports"))}
      </div>
      {reports ? <ReportsTab /> : <MovementsTab />}
    </div>
  );
}
