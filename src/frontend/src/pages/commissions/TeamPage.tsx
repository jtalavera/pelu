import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Navigate, Outlet, useSearchParams } from "react-router-dom";
import { Alert, Button, Input, Label, Spinner, Text } from "@design-system";
import { getAguinaldo, getProfessionalsSummary, type AguinaldoSummary, type ProfessionalsRuleSummary } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { Avatar } from "./HomePage";
import { StatusChip } from "./StatusChip";
import { formatPercent } from "./common";
import { useOverview } from "./overview";

const normalize = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Comisiones › Equipo: «Profesionales» and, only when the salon uses it, «Aguinaldo» (HU-COM-15). */
export function TeamLayout() {
  const { t } = useTranslation();
  const { overview } = useOverview();
  const aguinaldo = overview?.aguinaldoEnabled ?? false;
  const tab = (to: string, end: boolean, key: string, testId: string, label: string) => (
    <NavLink
      to={to}
      end={end}
      data-testid={testId}
      className={({ isActive }) =>
        `inline-flex min-h-10 flex-1 items-center justify-center rounded-[10px] px-3 text-sm font-bold ${
          isActive ? "bg-surface text-primary shadow-[0_1px_3px_rgba(10,31,51,0.15)]" : "text-ink-2"
        }`
      }
      key={key}
    >
      {label}
    </NavLink>
  );
  return (
    <div className="flex flex-col gap-4" data-testid="commissions-team">
      {aguinaldo && (
        <div className="flex max-w-sm gap-1 rounded-2xl bg-primary-lt p-1">
          {tab("/app/commissions/equipo", true, "people", "team-tab-people", t("femme.commissions.team.tabPeople", { count: overview?.rows.length ?? 0 }))}
          {tab("/app/commissions/equipo/aguinaldo", false, "aguinaldo", "team-tab-aguinaldo", t("femme.commissions.team.tabAguinaldo"))}
        </div>
      )}
      <Outlet />
    </div>
  );
}

/** Aguinaldo is only reachable when the salon turned it on in the setup. */
export function AguinaldoGuard({ children }: { children: React.ReactNode }) {
  const { overview } = useOverview();
  if (!overview) return <Spinner />;
  if (!overview.aguinaldoEnabled) return <Navigate to="/app/commissions/equipo" replace />;
  return <>{children}</>;
}

type Filter = "all" | "norules" | "retain" | "pending";

/** One card per professional: what she earned in the period, her rules and her aguinaldo. */
export function TeamList() {
  const { t } = useTranslation();
  const { overview } = useOverview();
  const [params] = useSearchParams();
  const [summary, setSummary] = useState<ProfessionalsRuleSummary | null>(null);
  const [fund, setFund] = useState<AguinaldoSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(() => {
    const f = params.get("filter");
    return f === "norules" || f === "retain" || f === "pending" ? f : "all";
  });
  const enabled = overview?.aguinaldoEnabled ?? false;

  useEffect(() => {
    getProfessionalsSummary()
      .then(setSummary)
      .catch((err) => setError(translateApiError(err, t)));
  }, [t]);
  useEffect(() => {
    if (!enabled) return;
    getAguinaldo()
      .then(setFund)
      .catch((err) => setError(translateApiError(err, t)));
  }, [enabled, t]);

  const retention = useMemo(() => new Map((summary?.professionals ?? []).map((p) => [p.professionalId, p.retentionPercent])), [summary]);
  const balance = useMemo(() => new Map((fund?.balances ?? []).map((b) => [b.professionalId, b])), [fund]);

  if (!overview) return <Spinner />;
  const rows = overview.rows;
  const needle = normalize(query.trim());
  const matches = (f: Filter, r: (typeof rows)[number]) =>
    f === "all" ||
    (f === "norules" && r.ruleCount === 0) ||
    (f === "retain" && !!retention.get(r.professionalId)) ||
    (f === "pending" && ["UNSETTLED", "DRAFT", "APPROVED"].includes(r.status));
  const visible = rows.filter((r) => matches(filter, r) && (!needle || normalize(r.professionalName).includes(needle)));
  const chips: Filter[] = enabled ? ["all", "norules", "retain", "pending"] : ["all", "norules", "pending"];

  return (
    <div className="flex flex-col gap-4" data-testid="team-list">
      <div className="flex flex-wrap items-center gap-2">
        <form role="search" onSubmit={(e) => e.preventDefault()} className="flex min-w-0 flex-1 basis-64 items-center gap-1">
          <Label htmlFor="team-search" className="sr-only">
            {t("femme.commissions.team.search")}
          </Label>
          <Input id="team-search" type="search" value={query} placeholder={t("femme.commissions.team.search")} data-testid="team-search" onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" variant="secondary" className="min-h-11" data-testid="team-search-submit">
            {t("femme.commissions.groups.searchSubmit")}
          </Button>
        </form>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("femme.commissions.team.filterAria")}>
        {chips.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            data-testid={`team-filter-${f}`}
            onClick={() => setFilter(f)}
            className={`min-h-[38px] rounded-full border px-3.5 text-[13px] font-extrabold ${
              filter === f ? "border-primary bg-primary-lt text-primary" : "border-line bg-surface text-ink hover:bg-bg"
            }`}
          >
            {t(`femme.commissions.team.filter.${f}`, { count: rows.filter((r) => matches(f, r)).length })}
          </button>
        ))}
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {visible.length === 0 ? (
        <Text variant="muted" data-testid="team-empty">
          {t("femme.commissions.team.empty")}
        </Text>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          {visible.map((r) => {
            const pct = retention.get(r.professionalId);
            const noRules = r.ruleCount === 0;
            const b = balance.get(r.professionalId);
            return (
              <Link
                key={r.professionalId}
                to={`/app/commissions/equipo/${r.professionalId}`}
                data-testid="team-card"
                data-professional={r.professionalName}
                className={`flex min-w-0 flex-col gap-2.5 rounded-card bg-surface p-4 hover:bg-bg ${noRules ? "border border-warning/40" : "border border-line"}`}
              >
                <div className="flex items-center gap-3">
                  <Avatar name={r.professionalName} size={44} />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate font-heading text-lg text-ink">{r.professionalName}</b>
                    <span className="block truncate text-xs text-ink-3" data-testid="team-card-rules">
                      {noRules
                        ? t("femme.commissions.team.noRulesYet")
                        : enabled && pct
                          ? t("femme.commissions.byProfessional.selectorDetail", { rules: t("femme.commissions.byProfessional.ruleCount", { count: r.ruleCount }), percent: formatPercent(pct) })
                          : t("femme.commissions.byProfessional.ruleCount", { count: r.ruleCount })}
                    </span>
                  </div>
                  {noRules ? (
                    <span className="inline-flex min-h-7 items-center rounded-full bg-warning-lt px-2.5 text-[11px] font-extrabold text-warning" data-testid="team-card-missing">
                      {t("femme.commissions.team.missingRules")}
                    </span>
                  ) : (
                    <StatusChip status={r.status} />
                  )}
                </div>
                <div className="flex items-baseline justify-between text-[13px] text-ink-3">
                  <span>{t("femme.commissions.team.thisPeriod")}</span>
                  <b className="text-lg tabular-nums text-ink" data-testid="team-card-amount">
                    {formatGuaraniesGs(r.amount)}
                  </b>
                </div>
                {enabled && (
                  <div className="flex items-baseline justify-between text-[13px] text-warning">
                    <span>{t("femme.commissions.team.aguinaldo")}</span>
                    <b className="tabular-nums" data-testid="team-card-aguinaldo">
                      {b && b.balance !== 0 ? formatGuaraniesGs(b.balance) : "—"}
                    </b>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
      <p className="px-1 text-sm text-ink-3">{t("femme.commissions.team.footer")}</p>
    </div>
  );
}
