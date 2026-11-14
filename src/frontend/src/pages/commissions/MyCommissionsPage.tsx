import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Modal, Spinner, Text } from "@design-system";
import { getMySettlement, getMySummary, type MySettlementDetail, type MySummary } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { useFeatureFlag, useFeatureFlagsState } from "../../hooks/useFeatureFlags";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDate, formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { SettlementStatusBadge, formatPercent } from "./common";

/** HU-COM-07: the logged professional's own commissions and settlements, read-only. */
export default function MyCommissionsPage() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const enabled = useFeatureFlag("COMMISSIONS");
  const { loading } = useFeatureFlagsState();
  const [summary, setSummary] = useState<MySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MySettlementDetail | null>(null);

  useEffect(() => {
    if (!enabled) return;
    getMySummary()
      .then(setSummary)
      .catch((err) => setError(translateApiError(err, t)));
  }, [enabled, t]);

  if (loading) return <Spinner />;
  if (!enabled) return <Alert variant="warning">{t("femme.commissions.notEnabled")}</Alert>;
  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!summary) return <Spinner />;

  const period = summary.currentPeriod;
  const sectionTitle = "mt-1 font-heading text-xs font-extrabold uppercase tracking-wider text-primary";
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4" data-testid="my-commissions">
      <div>
        <h1 className="font-heading text-2xl font-extrabold text-ink sm:text-3xl">{t("femme.commissions.my.title")}</h1>
        <p className="text-sm text-ink-3">{t("femme.commissions.my.subtitle")}</p>
      </div>
      <section className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4 shadow-sm sm:p-5">
        <span className="text-sm text-ink-3">
          {period.from && period.to
            ? t("femme.commissions.my.currentPeriod", {
                from: formatParaguayDate(period.from + "T12:00:00", dateLocale),
                to: formatParaguayDate(period.to + "T12:00:00", dateLocale),
              })
            : t("femme.commissions.my.currentMonth")}
        </span>
        <span className="font-heading text-3xl font-extrabold tabular-nums text-ink" data-testid="my-commissions-total">
          {formatGuaraniesGs(summary.currentPeriodTotal)}
        </span>
        <span className="text-sm text-ink-3">
          {t("femme.commissions.kind.SERVICE")}{" "}
          <b className="tabular-nums text-ink" data-testid="my-commissions-services">
            {formatGuaraniesGs(summary.servicesTotal)}
          </b>{" "}
          · {t("femme.commissions.kind.PRODUCT")}{" "}
          <b className="tabular-nums text-ink" data-testid="my-commissions-products">
            {formatGuaraniesGs(summary.productsTotal)}
          </b>
        </span>
      </section>

      {summary.aguinaldoEnabled && (
        <section
          className="flex flex-col gap-1 rounded-card border border-warning/35 bg-warning-lt p-4 shadow-sm sm:p-5"
          data-testid="my-commissions-aguinaldo"
        >
          <span className="flex items-baseline justify-between gap-3 text-sm text-warning">
            {t("femme.commissions.my.retained")}
            <b className="tabular-nums" data-testid="my-commissions-retained">
              {formatGuaraniesGs(summary.currentPeriodRetention)}
            </b>
          </span>
          <span className="text-sm text-warning">{t("femme.commissions.my.aguinaldoBalance")}</span>
          <b className="font-heading text-2xl tabular-nums text-warning" data-testid="my-commissions-aguinaldo-balance">
            {formatGuaraniesGs(summary.aguinaldoBalance)}
          </b>
          <span className="text-xs text-warning">{t("femme.commissions.my.aguinaldoHelp")}</span>
        </section>
      )}
      {summary.currentPeriodFixed !== 0 && (
        <p className="px-0.5 text-sm text-ink-3" data-testid="my-commissions-product-cost">
          {t("femme.commissions.my.productCost")}: <b className="tabular-nums text-ink">{formatGuaraniesGs(summary.currentPeriodFixed)}</b>
        </p>
      )}

      <h2 className={sectionTitle}>{t("femme.commissions.my.entriesTitle")}</h2>
      <div className="rounded-card border border-line bg-surface shadow-sm">
        {summary.currentPeriodEntries.length === 0 ? (
          <Text variant="muted" className="p-4">
            {t("femme.commissions.my.noEntries")}
          </Text>
        ) : (
          <ul data-testid="my-commissions-entries">
            {summary.currentPeriodEntries.map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-4 py-2.5 first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">
                    {e.itemName ?? e.note ?? t(`femme.commissions.reason.${e.reasonCode}`)}
                  </div>
                  <div className="text-sm text-ink-3">
                    {formatParaguayDateTime(e.accrualAt, dateLocale)} · {formatGuaraniesGs(e.baseAmount)} ×{" "}
                    {formatPercent(e.percentApplied)}
                    {e.baseType ? ` · ${t(`femme.commissions.baseShort.${e.baseType}`)}` : ""}
                    {e.fixedToProfessional && e.fixedAmount !== 0
                      ? ` · ${t("femme.commissions.my.includesProductCost", { amount: formatGuaraniesGs(e.fixedAmount) })}`
                      : ""}
                    {e.retentionAmount !== 0
                      ? ` · ${t("femme.commissions.my.retentionLine", { amount: formatGuaraniesGs(e.retentionAmount) })}`
                      : ""}
                  </div>
                </div>
                <span className="text-right font-heading font-extrabold tabular-nums text-ink">
                  {formatGuaraniesGs(e.commissionAmount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2 className={sectionTitle}>{t("femme.commissions.my.settlementsTitle")}</h2>
      <div className="rounded-card border border-line bg-surface shadow-sm">
        {summary.settlements.length === 0 ? (
          <Text variant="muted" className="p-4">
            {t("femme.commissions.settlements.empty")}
          </Text>
        ) : (
          <ul data-testid="my-commissions-settlements">
            {summary.settlements.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() =>
                    void getMySettlement(s.id)
                      .then(setDetail)
                      .catch((err) => setError(translateApiError(err, t)))
                  }
                  className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-4 py-2 text-left first:border-t-0 hover:bg-bg"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">
                      {formatParaguayDate(s.periodFrom + "T12:00:00", dateLocale)} –{" "}
                      {formatParaguayDate(s.periodTo + "T12:00:00", dateLocale)}
                    </span>
                    <span className="block text-sm">
                      <SettlementStatusBadge status={s.status} />
                    </span>
                  </span>
                  <span className="text-right font-heading font-extrabold tabular-nums text-ink">
                    {formatGuaraniesGs(s.totalAmount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={
          detail
            ? t("femme.commissions.settlement.subtitle", {
                id: detail.settlement.id,
                from: formatParaguayDate(detail.settlement.periodFrom + "T12:00:00", dateLocale),
                to: formatParaguayDate(detail.settlement.periodTo + "T12:00:00", dateLocale),
              })
            : ""
        }
        className="max-w-xl"
      >
        {detail && (
          <div className="flex flex-col gap-2" data-testid="my-settlement-detail">
            <div className="flex items-center justify-between gap-3">
              <SettlementStatusBadge status={detail.settlement.status} />
              <b className="font-heading text-xl tabular-nums text-ink">{formatGuaraniesGs(detail.settlement.totalAmount)}</b>
            </div>
            <ul>
              {detail.entries.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 border-t border-line py-2 text-sm first:border-t-0">
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">
                      {e.itemName ?? e.note ?? t(`femme.commissions.reason.${e.reasonCode}`)}
                    </span>
                    <span className="block text-ink-3">
                      {formatGuaraniesGs(e.baseAmount)} × {formatPercent(e.percentApplied)}
                      {e.fixedToProfessional && e.fixedAmount !== 0
                        ? ` · ${t("femme.commissions.my.includesProductCost", { amount: formatGuaraniesGs(e.fixedAmount) })}`
                        : ""}
                      {e.retentionAmount !== 0
                        ? ` · ${t("femme.commissions.my.retentionLine", { amount: formatGuaraniesGs(e.retentionAmount) })}`
                        : ""}
                    </span>
                  </span>
                  <b className="tabular-nums">{formatGuaraniesGs(e.commissionAmount)}</b>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}
