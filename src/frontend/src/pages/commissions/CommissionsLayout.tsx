import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import { Alert, Spinner } from "@design-system";
import { getOverview, type Overview } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { useFeatureFlag, useFeatureFlagsState } from "../../hooks/useFeatureFlags";
import { useMe } from "../../hooks/useMe";
import { useDateLocale } from "../../i18n/dateLocale";
import { OverviewContext, periodLabel, setupProgress } from "./overview";

const SECTIONS = ["home", "settle", "team", "activity", "setup"] as const;
const PATHS: Record<(typeof SECTIONS)[number], string> = {
  home: "/app/commissions",
  settle: "/app/commissions/liquidar",
  team: "/app/commissions/equipo",
  activity: "/app/commissions/actividad",
  setup: "/app/commissions/configurar",
};

/**
 * Comisiones (ADMIN), HU-COM-15: one title, five places (Inicio · Liquidar · Equipo · Actividad ·
 * Configurar) and the current period's overview shared with all of them.
 */
export default function CommissionsLayout() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const enabled = useFeatureFlag("COMMISSIONS");
  const { loading } = useFeatureFlagsState();
  const { me } = useMe();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setOverview(await getOverview(0));
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [t]);

  const allowed = enabled && (!me || me.role === "ADMIN");
  useEffect(() => {
    if (allowed) void refresh();
  }, [allowed, refresh]);

  const value = useMemo(() => ({ overview, error, refresh }), [overview, error, refresh]);

  if (loading) return <Spinner />;
  if (!allowed) {
    return (
      <div className="mx-auto flex w-full min-w-0 max-w-xl flex-col gap-3" data-testid="commissions-disabled">
        <h1 className="font-heading text-2xl font-extrabold text-ink sm:text-3xl">{t("femme.commissions.pageTitle")}</h1>
        <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-6 shadow-sm">
          <h2 className="font-heading text-xl font-extrabold text-ink">{t("femme.commissions.disabled.title")}</h2>
          <p className="text-ink-2">{t("femme.commissions.disabled.what")}</p>
          <p className="text-sm text-ink-3">{t("femme.commissions.disabled.how")}</p>
        </section>
      </div>
    );
  }

  const toDo = overview ? overview.unsettled + overview.drafts + overview.approved : 0;
  const setupPending = overview ? setupProgress(overview).pending : 0;
  const badge = (key: (typeof SECTIONS)[number]) => (key === "settle" ? toDo : key === "setup" ? setupPending : 0);

  return (
    <OverviewContext.Provider value={value}>
      <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-4" data-testid="commissions">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-heading text-2xl font-extrabold text-ink sm:text-3xl">{t("femme.commissions.pageTitle")}</h1>
          {overview && (
            <span className="text-sm text-ink-3" data-testid="commissions-period">
              {periodLabel(t, overview.period, dateLocale)}
            </span>
          )}
        </div>
        <nav aria-label={t("femme.commissions.pageTitle")} className="flex flex-wrap gap-1.5 rounded-2xl bg-primary-lt p-1.5">
          {SECTIONS.map((key) => (
            <NavLink
              key={key}
              to={PATHS[key]}
              end={key === "home"}
              data-testid={`commissions-nav-${key}`}
              className={({ isActive }) =>
                `inline-flex min-h-12 min-w-0 flex-1 basis-28 items-center justify-center gap-2 rounded-[13px] px-3 text-[15px] font-extrabold ${
                  isActive ? "bg-surface text-primary shadow-[0_1px_3px_rgba(10,31,51,0.15)]" : "text-ink-2 hover:bg-surface/60"
                }`
              }
            >
              {t(`femme.commissions.nav.${key}`)}
              {badge(key) > 0 && (
                <span
                  data-testid={`commissions-nav-badge-${key}`}
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[11px] font-extrabold text-surface"
                >
                  {badge(key)}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Outlet />
      </div>
    </OverviewContext.Provider>
  );
}
