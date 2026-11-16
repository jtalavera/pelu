import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useParams, useSearchParams } from "react-router-dom";
import { Alert, Button, Spinner, Text } from "@design-system";
import {
  getAguinaldo,
  getProfessionalsSummary,
  getSettlement,
  getSettlementPreview,
  type AguinaldoBalance,
  type OverviewStatus,
  type SettlementDetail,
  type SettlementPreview,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { ACTION_BUTTON } from "../../components/actionButtons";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDate, formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { AguinaldoTab } from "./AguinaldoTab";
import { useFundActions } from "./FundActions";
import { formatPercent } from "./common";
import { Avatar } from "./HomePage";
import { MovementsTab } from "./MovementsTab";
import { ProfessionalRates } from "./ProfessionalRates";
import { StatusChip } from "./StatusChip";
import { useOverview } from "./overview";
import { buildSettlementDays, compose, type Composition } from "./settlementDays";

type TabId = "summary" | "rules" | "history";

/**
 * Comisiones › Equipo › one professional: Resumen · Reglas · Movimientos (HU-COM-15, HU-COM-24). The retention
 * (formerly «Aguinaldo») lives in the Resumen (balance and payment) and in Movimientos (its own list).
 */
export default function ProfessionalPage() {
  const { t } = useTranslation();
  const { professionalId: idParam } = useParams();
  const professionalId = Number(idParam);
  const { overview } = useOverview();
  const [params] = useSearchParams();
  const retention = overview?.aguinaldoEnabled ?? false;
  const requested = params.get("tab");
  // The old «Aguinaldo» tab no longer exists: its address opens the retention list of Movimientos.
  const tab: TabId = requested === "rules" ? "rules" : requested === "history" || requested === "aguinaldo" ? "history" : "summary";
  const view: "commissions" | "retention" = retention && (requested === "aguinaldo" || params.get("view") === "retention") ? "retention" : "commissions";
  const row = overview?.rows.find((r) => r.professionalId === professionalId) ?? null;
  /** Her retention % (the subtitle and the Summary card use it). */
  const [retentionPercent, setRetentionPercent] = useState<number | null>(null);
  useEffect(() => {
    if (!retention) return;
    getProfessionalsSummary()
      .then((s) => setRetentionPercent(s.professionals.find((x) => x.professionalId === professionalId)?.retentionPercent ?? null))
      .catch(() => setRetentionPercent(null));
  }, [retention, professionalId]);

  const tabs: { id: TabId; label: string }[] = [
    { id: "summary", label: t("femme.commissions.pro.tabSummary") },
    { id: "rules", label: t("femme.commissions.pro.tabRules") },
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
              {retention && retentionPercent !== null && retentionPercent > 0 && ` · ${t("femme.commissions.pro.subtitleRetains", { percent: formatPercent(retentionPercent) })}`}
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
      {tab === "summary" && <SummaryPane professionalId={professionalId} retentionPercent={retentionPercent} />}
      {tab === "rules" && <ProfessionalRates professionalId={professionalId} />}
      {tab === "history" && <ProfessionalMovements professionalId={professionalId} retention={retention} view={view} />}
    </div>
  );
}

/** «Movimientos» of one professional: her commissions, and (if the salon retains) the movements of her retention balance. */
function ProfessionalMovements({ professionalId, retention, view }: { professionalId: number; retention: boolean; view: "commissions" | "retention" }) {
  const { t } = useTranslation();
  const { overview } = useOverview();
  const row = overview?.rows.find((r) => r.professionalId === professionalId) ?? null;
  // What she retained that still waits for the settlement to be approved (not settled yet, or in a draft).
  const pending = row && row.retention !== 0 && (row.status === "UNSETTLED" || row.status === "DRAFT") ? { amount: row.retention, status: row.status } : null;
  const [, setParams] = useSearchParams();
  const pick = (next: "commissions" | "retention") =>
    setParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("tab", "history");
      if (next === "retention") params.set("view", "retention");
      else params.delete("view");
      return params;
    });
  const chip = (id: "commissions" | "retention", label: string) => (
    <button
      type="button"
      key={id}
      aria-pressed={view === id}
      data-testid={`pro-movements-view-${id}`}
      onClick={() => pick(id)}
      className={`min-h-11 rounded-full px-5 text-sm font-extrabold ${view === id ? "bg-primary text-primary-fg" : "text-ink-2"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="pro-movements">
      {retention && (
        <div role="group" aria-label={t("femme.commissions.pro.movementsSwitchAria")} className="inline-flex self-start rounded-full border border-line bg-surface p-1">
          {chip("commissions", t("femme.commissions.pro.movementsCommissions"))}
          {chip("retention", t("femme.commissions.pro.movementsRetention"))}
        </div>
      )}
      {view === "retention" ? <AguinaldoTab professionalId={professionalId} part="movements" pending={pending} /> : <MovementsTab fixedProfessionalId={professionalId} />}
    </div>
  );
}

/** What she earned in the current period: what is paid and, if the salon retains, what was retained and her balance. */
function SummaryPane({ professionalId, retentionPercent }: { professionalId: number; retentionPercent: number | null }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const { overview } = useOverview();
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [balance, setBalance] = useState<AguinaldoBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const row = overview?.rows.find((r) => r.professionalId === professionalId) ?? null;
  const from = overview?.period.from ?? undefined;
  const to = overview?.period.to ?? undefined;
  const retention = overview?.aguinaldoEnabled ?? false;

  const loadBalance = async () => {
    try {
      const all = await getAguinaldo();
      setBalance(all.balances.find((b) => b.professionalId === professionalId) ?? null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  };
  const fund = useFundActions(loadBalance, balance?.balance ?? 0);

  useEffect(() => {
    if (!overview) return;
    getSettlementPreview(professionalId, from, to)
      .then(setPreview)
      .catch((err) => setError(translateApiError(err, t)));
  }, [overview, professionalId, from, to, t]);

  // HU-COM-33: with a settlement (draft, approved or paid) the breakdown comes from it, so it adds up to the total shown.
  const settlementId = row?.settlementId ?? null;
  useEffect(() => {
    if (settlementId === null) {
      setDetail(null);
      return;
    }
    getSettlement(settlementId)
      .then(setDetail)
      .catch((err) => setError(translateApiError(err, t)));
  }, [settlementId, t]);

  useEffect(() => {
    if (!retention) return;
    void loadBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retention, professionalId]);

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!preview || !row || (settlementId !== null && detail?.settlement.id !== settlementId)) return <Spinner />;
  const comp: Composition = detail
    ? compose(buildSettlementDays(detail.entries, detail.adjustments))
    : (() => {
        const adjustments = preview.entries.filter((e) => e.sourceType === "ADJUSTMENT");
        const c = compose(buildSettlementDays(preview.entries.filter((e) => e.sourceType !== "ADJUSTMENT"), adjustments));
        return {
          services: { amount: preview.servicesTotal, count: c.services.count },
          products: { amount: preview.productsTotal, count: c.products.count },
          adjustments: { amount: preview.adjustmentsTotal, count: adjustments.length },
        };
      })();
  const sales = comp.services.count + comp.products.count;
  const lineCount = detail ? sales : preview.lines;
  const settlement = detail?.settlement ?? null;
  const line = (label: string, value: number, testId: string, tone = "text-ink") => (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-2">{label}</span>
      <b className={`font-heading tabular-nums ${tone}`} data-testid={testId}>
        {formatGuaraniesGs(value)}
      </b>
    </div>
  );
  const tile = (label: string, count: number, amount: number, testId: string, tone = "text-ink") => (
    <div className="flex flex-col gap-0.5 rounded-2xl bg-primary-lt/50 px-3 py-2.5">
      <span className="text-[13px] text-ink-3">
        <b className="text-ink">{label}</b> · {count}
      </span>
      <b className={`font-heading text-base tabular-nums ${tone}`} data-testid={testId}>
        {amount > 0 && testId === "pro-summary-adjustments" ? "+" : ""}
        {formatGuaraniesGs(amount)}
      </b>
    </div>
  );
  // Without any movement she has no row in the fund yet: her balance is 0 and she can still be adjusted.
  const fundTarget: AguinaldoBalance = balance ?? {
    professionalId,
    professionalName: row.professionalName,
    active: true,
    retained: 0,
    paid: 0,
    balance: 0,
    lastPaymentOn: null,
  };
  const lastPayment = balance?.lastPaymentOn ? formatParaguayDate(balance.lastPaymentOn + "T12:00:00", dateLocale) : "—";
  return (
    <section className="flex flex-col gap-4" data-testid="pro-summary">
      <div className={`grid gap-3.5 ${retention ? "sm:grid-cols-2" : ""}`}>
        <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5" data-testid="pro-pay-card">
          <div>
            <div className="text-sm font-bold text-ink-3">{t("femme.commissions.pro.summaryTotal")}</div>
            {overview?.period.from && overview.period.to && (
              <div className="text-xs text-ink-3">
                {formatParaguayDate(overview.period.from + "T12:00:00", dateLocale)} – {formatParaguayDate(overview.period.to + "T12:00:00", dateLocale)}
              </div>
            )}
          </div>
          {row.status === "NONE" ? <StatusChip status={row.status} /> : <Stepper status={row.status} />}
          <b className="mt-2 font-heading text-3xl tabular-nums text-ink" data-testid="pro-summary-total">
            {formatGuaraniesGs(row.amount || preview.total)}
          </b>
          <Text variant="small" className="text-ink-3" data-testid="pro-summary-lines">
            {t("femme.commissions.pro.summaryLines", { count: lineCount })}
            {comp.adjustments.count > 0 ? ` · ${t("femme.commissions.settlement.adjCount", { count: comp.adjustments.count })}` : ""}
            {row.status !== "NONE" ? ` · ${t(`femme.commissions.pro.next.${row.status}`)}` : ""}
          </Text>
          {preview.carriedAmount !== 0 && (
            <Text variant="small" className="text-warning" data-testid="pro-summary-carried">
              {t("femme.commissions.pro.summaryCarried", { amount: formatGuaraniesGs(preview.carriedAmount) })}
            </Text>
          )}
          {settlement?.paidAt && (
            <Text variant="small" className="font-bold text-success" data-testid="pro-summary-paid-info">
              {t("femme.commissions.settlement.paidInfo", {
                date: formatParaguayDateTime(settlement.paidAt, dateLocale),
                method: t(`femme.commissions.paymentMethod.${settlement.paymentMethod}`),
                reference: settlement.paymentReference ?? "—",
              })}
            </Text>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {tile(t("femme.commissions.pro.summaryServices"), comp.services.count, comp.services.amount, "pro-summary-services")}
            {tile(t("femme.commissions.pro.summaryProducts"), comp.products.count, comp.products.amount, "pro-summary-products")}
            {comp.adjustments.count > 0 || comp.adjustments.amount !== 0
              ? tile(t("femme.commissions.pro.summaryAdjustments"), comp.adjustments.count, comp.adjustments.amount, "pro-summary-adjustments", "text-success")
              : null}
          </div>
        </div>

        {retention && (
          <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5" data-testid="pro-retention-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-bold text-ink-3">{t("femme.commissions.pro.summaryRetained")}</div>
              {retentionPercent !== null && retentionPercent > 0 && (
                <span className="rounded-full bg-primary-lt px-3 py-1 text-xs font-extrabold text-primary" data-testid="pro-retention-pill">
                  {t("femme.commissions.pro.retentionPill", { percent: formatPercent(retentionPercent) })}
                </span>
              )}
            </div>
            <b className="font-heading text-3xl tabular-nums text-warning" data-testid="pro-summary-retained">
              {formatGuaraniesGs(row.retention || preview.retentionTotal)}
            </b>
            <Text variant="small" className="text-ink-3">
              {t("femme.commissions.pro.retentionNote")}
            </Text>
            <div className="mt-2 flex flex-col gap-1.5 border-t border-line pt-3">
              {line(t("femme.commissions.pro.retentionBalance"), balance?.balance ?? 0, "pro-retention-balance")}
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-2">{t("femme.commissions.pro.retentionLastPayment")}</span>
                <b className="font-heading text-ink" data-testid="pro-retention-last-payment">
                  {lastPayment}
                </b>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {row.settlementId ? (
          <Link
            to={`/app/commissions/settlements/${row.settlementId}`}
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-extrabold text-primary-fg"
            data-testid="pro-summary-open-settlement"
          >
            {t(row.status === "PAID" ? "femme.commissions.pro.viewSettlement" : "femme.commissions.pro.openSettlement")}
          </Link>
        ) : (
          <Link
            to="/app/commissions/liquidar"
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-extrabold text-primary-fg"
            data-testid="pro-summary-go-settle"
          >
            {t("femme.commissions.pro.goSettle")}
          </Link>
        )}
        {retention && (
          <Button
            type="button"
            variant="outline"
            className={ACTION_BUTTON}
            data-testid="pro-retention-pay"
            disabled={fundTarget.balance <= 0}
            title={fundTarget.balance <= 0 ? t("femme.commissions.pro.retentionNothingToPay") : undefined}
            onClick={() => fund.openPay(fundTarget)}
          >
            {t("femme.commissions.pro.retentionPay")}
          </Button>
        )}
        {retention && (
          <Button type="button" variant="tertiary" className={ACTION_BUTTON} data-testid="pro-retention-adjust" onClick={() => fund.openAdjust(fundTarget)}>
            {t("femme.commissions.pro.retentionAdjust")}
          </Button>
        )}
        {retention && (
          <Link to="?tab=history&view=retention" className="inline-flex min-h-11 items-center px-2 text-sm font-extrabold text-primary" data-testid="pro-retention-movements-link">
            {t("femme.commissions.pro.retentionMovements")}
          </Link>
        )}
      </div>
      {retention && fundTarget.balance <= 0 && (
        <Text variant="small" className="-mt-2 text-ink-3" data-testid="pro-retention-nothing-to-pay">
          {t("femme.commissions.pro.retentionNothingToPay")}
        </Text>
      )}
      {fund.notice && (
        <Alert variant="success" role="status" data-testid="pro-retention-notice">
          {fund.notice}
        </Alert>
      )}
      {fund.dialogs}
    </section>
  );
}

const STEPS: OverviewStatus[] = ["UNSETTLED", "DRAFT", "APPROVED", "PAID"];

/** HU-COM-33: where the period of this professional is in the cycle: to generate → draft → approved → paid. */
function Stepper({ status }: { status: OverviewStatus }) {
  const { t } = useTranslation();
  const current = Math.max(0, STEPS.indexOf(status));
  return (
    <ol className="mt-2 flex items-start" data-testid="pro-stepper" aria-label={t("femme.commissions.pro.stepperAria")}>
      {STEPS.map((step, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={step} data-testid="pro-step" data-step={step} data-state={state} aria-current={state === "current" ? "step" : undefined} className="flex min-w-0 flex-1 items-start">
            <span className="flex w-16 shrink-0 flex-col items-center gap-1 text-center sm:w-20">
              <span
                aria-hidden
                className={`inline-flex size-7 items-center justify-center rounded-full text-[13px] font-extrabold ${
                  state === "done" ? "bg-primary text-primary-fg" : state === "current" ? "border-[2.5px] border-primary bg-surface text-primary" : "bg-line text-ink-3"
                }`}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className={`text-xs ${state === "current" ? "font-extrabold text-ink" : "font-semibold text-ink-3"}`}>{t(`femme.commissions.pro.stepper.${step}`)}</span>
            </span>
            {i < STEPS.length - 1 && <span aria-hidden className={`mt-3 h-[3px] min-w-2 flex-1 rounded ${i < current ? "bg-primary" : "bg-line"}`} />}
          </li>
        );
      })}
    </ol>
  );
}
