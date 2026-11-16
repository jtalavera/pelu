import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useParams, useSearchParams } from "react-router-dom";
import { Alert, Spinner, Text } from "@design-system";
import { getSettlementPreview, type SettlementPreview } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { AguinaldoTab } from "./AguinaldoTab";
import { Avatar } from "./HomePage";
import { MovementsTab } from "./MovementsTab";
import { ProfessionalRates } from "./ProfessionalRates";
import { StatusChip } from "./StatusChip";
import { useOverview } from "./overview";

type TabId = "summary" | "rules" | "aguinaldo" | "history";

/** Comisiones › Equipo › one professional: Resumen · Reglas · Aguinaldo (if used) · Historial (HU-COM-15). */
export default function ProfessionalPage() {
  const { t } = useTranslation();
  const { professionalId: idParam } = useParams();
  const professionalId = Number(idParam);
  const { overview } = useOverview();
  const [params] = useSearchParams();
  const aguinaldo = overview?.aguinaldoEnabled ?? false;
  const requested = params.get("tab") as TabId | null;
  const tab: TabId = requested === "rules" || requested === "history" || (requested === "aguinaldo" && aguinaldo) ? requested : "summary";
  const row = overview?.rows.find((r) => r.professionalId === professionalId) ?? null;

  const tabs: { id: TabId; label: string }[] = [
    { id: "summary", label: t("femme.commissions.pro.tabSummary") },
    { id: "rules", label: t("femme.commissions.pro.tabRules") },
    ...(aguinaldo ? [{ id: "aguinaldo" as const, label: t("femme.commissions.pro.tabAguinaldo") }] : []),
    { id: "history", label: t("femme.commissions.pro.tabHistory") },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="commission-professional">
      <Link to="/app/commissions/equipo" className="inline-flex min-h-11 items-center text-sm font-bold text-primary" data-testid="pro-back">
        ← {t("femme.commissions.pro.back")}
      </Link>
      {row && (
        <header className="flex items-center gap-3">
          <Avatar name={row.professionalName} />
          <div className="min-w-0">
            <h2 className="truncate font-heading text-xl font-extrabold text-ink" data-testid="pro-name">
              {row.professionalName}
            </h2>
            <div className="text-sm text-ink-3" data-testid="pro-subtitle">
              {row.ruleCount === 0 ? t("femme.commissions.team.usualPay") : t("femme.commissions.team.differentIn", { count: row.ruleCount })}
            </div>
          </div>
        </header>
      )}
      <nav aria-label={t("femme.commissions.pro.tabsAria")} className="flex gap-1 overflow-x-auto rounded-2xl bg-primary-lt p-1">
        {tabs.map((x) => (
          <NavLink
            key={x.id}
            to={x.id === "summary" ? "." : `?tab=${x.id}`}
            end
            data-testid={`pro-tab-${x.id}`}
            aria-current={tab === x.id ? "page" : undefined}
            className={`inline-flex min-h-10 flex-1 items-center justify-center whitespace-nowrap rounded-[10px] px-3 text-sm font-bold ${
              tab === x.id ? "bg-surface text-primary shadow-[0_1px_3px_rgba(10,31,51,0.15)]" : "text-ink-2"
            }`}
          >
            {x.label}
          </NavLink>
        ))}
      </nav>
      {tab === "summary" && <SummaryPane professionalId={professionalId} />}
      {tab === "rules" && <ProfessionalRates professionalId={professionalId} />}
      {tab === "aguinaldo" && <AguinaldoTab professionalId={professionalId} />}
      {tab === "history" && <MovementsTab fixedProfessionalId={professionalId} />}
    </div>
  );
}

/** What she earned in the current period: the former «Vista previa», now one tab of her page. */
function SummaryPane({ professionalId }: { professionalId: number }) {
  const { t } = useTranslation();
  const { overview } = useOverview();
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const row = overview?.rows.find((r) => r.professionalId === professionalId) ?? null;
  const from = overview?.period.from ?? undefined;
  const to = overview?.period.to ?? undefined;

  useEffect(() => {
    if (!overview) return;
    getSettlementPreview(professionalId, from, to)
      .then(setPreview)
      .catch((err) => setError(translateApiError(err, t)));
  }, [overview, professionalId, from, to, t]);

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!preview || !row) return <Spinner />;
  const line = (label: string, value: number, testId: string, tone = "text-ink") => (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 first:border-t-0">
      <span className="text-sm text-ink-2">{label}</span>
      <b className={`font-heading tabular-nums ${tone}`} data-testid={testId}>
        {formatGuaraniesGs(value)}
      </b>
    </div>
  );
  return (
    <section className="flex flex-col gap-3" data-testid="pro-summary">
      <div className="rounded-card border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-ink-3">{t("femme.commissions.pro.summaryTotal")}</div>
            <b className="font-heading text-3xl tabular-nums text-ink" data-testid="pro-summary-total">
              {formatGuaraniesGs(row.amount || preview.total)}
            </b>
          </div>
          <StatusChip status={row.status} />
        </div>
        <Text variant="small" className="mt-1 text-ink-3" data-testid="pro-summary-lines">
          {t("femme.commissions.pro.summaryLines", { count: preview.lines })}
        </Text>
        {preview.carriedAmount !== 0 && (
          <Text variant="small" className="mt-1 text-warning" data-testid="pro-summary-carried">
            {t("femme.commissions.pro.summaryCarried", { amount: formatGuaraniesGs(preview.carriedAmount) })}
          </Text>
        )}
      </div>
      <div className="rounded-card border border-line bg-surface shadow-sm">
        {line(t("femme.commissions.pro.summaryServices"), preview.servicesTotal, "pro-summary-services")}
        {line(t("femme.commissions.pro.summaryProducts"), preview.productsTotal, "pro-summary-products")}
        {preview.adjustmentsTotal !== 0 && line(t("femme.commissions.pro.summaryAdjustments"), preview.adjustmentsTotal, "pro-summary-adjustments")}
        {overview?.aguinaldoEnabled && line(t("femme.commissions.pro.summaryRetained"), preview.retentionTotal, "pro-summary-retained", "text-warning")}
      </div>
      <div className="flex flex-wrap gap-2">
        {row.settlementId ? (
          <Link
            to={`/app/commissions/settlements/${row.settlementId}`}
            className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-extrabold text-surface"
            data-testid="pro-summary-open-settlement"
          >
            {t("femme.commissions.pro.openSettlement")}
          </Link>
        ) : (
          <Link
            to="/app/commissions/liquidar"
            className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-extrabold text-surface"
            data-testid="pro-summary-go-settle"
          >
            {t("femme.commissions.pro.goSettle")}
          </Link>
        )}
      </div>
    </section>
  );
}
