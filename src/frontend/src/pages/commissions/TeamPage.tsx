import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Navigate, Outlet, useSearchParams } from "react-router-dom";
import { Alert, Button, Input, Label, Spinner, Text } from "@design-system";
import { getAguinaldo, getProfessionalsSummary, type AguinaldoSummary, type ProfessionalsRuleSummary } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDate } from "../../lib/paraguayDateTime";
import { useDateLocale } from "../../i18n/dateLocale";
import { Avatar } from "./HomePage";
import { StatusChip } from "./StatusChip";
import { formatPercent } from "./common";
import { summarize, useOverview } from "./overview";

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

type Filter = "all" | "pending" | "paid" | "none" | "retain";

/** One card per professional: what she earned in the period, her rules and her aguinaldo. */
export function TeamList() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const { overview } = useOverview();
  const [params] = useSearchParams();
  const [summary, setSummary] = useState<ProfessionalsRuleSummary | null>(null);
  const [fund, setFund] = useState<AguinaldoSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(() => {
    const f = params.get("filter");
    return f === "retain" || f === "pending" || f === "paid" || f === "none" ? f : "all";
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
    (f === "retain" && !!retention.get(r.professionalId)) ||
    (f === "pending" && ["UNSETTLED", "DRAFT", "APPROVED"].includes(r.status)) ||
    (f === "paid" && r.status === "PAID") ||
    (f === "none" && r.status === "NONE");
  const visible = rows.filter((r) => matches(filter, r) && (!needle || normalize(r.professionalName).includes(needle)));
  const chips: Filter[] = enabled ? ["all", "pending", "paid", "none", "retain"] : ["all", "pending", "paid", "none"];
  const sum = summarize(overview);
  const detailOf = (r: (typeof rows)[number]) => {
    if (r.status === "NONE") return t("femme.commissions.team.detail.NONE");
    if (r.status === "UNSETTLED") return t("femme.commissions.team.detail.UNSETTLED", { count: r.lineCount });
    if (r.status === "PAID" && r.paidOn) return t("femme.commissions.team.detail.PAID", { date: formatParaguayDate(`${r.paidOn}T12:00:00`, dateLocale) });
    return t(`femme.commissions.team.detail.${r.status}`);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="team-list">
      <p className="text-[15px] text-ink" data-testid="team-counts">
        <b>{t("femme.commissions.home.teamActive", { count: sum.active })}</b> · {t("femme.commissions.home.teamWith", { count: sum.withMovements })} ·{" "}
        {t("femme.commissions.home.teamWithout", { count: sum.none.people })}
      </p>
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
            const b = balance.get(r.professionalId);
            return (
              <Link
                key={r.professionalId}
                to={`/app/commissions/equipo/${r.professionalId}`}
                data-testid="team-card"
                data-professional={r.professionalName}
                className={`flex min-w-0 flex-col gap-2.5 rounded-card bg-surface p-4 hover:bg-bg ${
                  r.status === "NONE" ? "border border-dashed border-ink-3/40" : "border border-line"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Avatar name={r.professionalName} size={44} />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate font-heading text-lg text-ink">{r.professionalName}</b>
                    <span className="block truncate text-xs text-ink-3" data-testid="team-card-rules">
                      {r.ruleCount === 0
                        ? t("femme.commissions.team.usualPay")
                        : t("femme.commissions.team.differentIn", { count: r.ruleCount })}
                      {enabled && pct ? ` · ${t("femme.commissions.team.retainsPercent", { percent: formatPercent(pct) })}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusChip status={r.status} />
                  </div>
                </div>
                <div className="flex items-baseline justify-between text-[13px] text-ink-3">
                  <span>{t("femme.commissions.team.thisPeriod")}</span>
                  <b className={`text-lg tabular-nums ${r.status === "NONE" ? "text-ink-3" : "text-ink"}`} data-testid="team-card-amount">
                    {r.status === "NONE" ? "—" : formatGuaraniesGs(r.amount)}
                  </b>
                </div>
                <div className="-mt-1.5 text-xs text-ink-3" data-testid="team-card-detail">
                  {detailOf(r)}
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
