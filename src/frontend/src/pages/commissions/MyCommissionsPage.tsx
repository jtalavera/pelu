import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Modal, Spinner, Text } from "@design-system";
import { getMySettlement, getMySummary, type MySettlementDetail, type MySummary } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { useFeatureFlag, useFeatureFlagsState } from "../../hooks/useFeatureFlags";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDate, formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { SettlementStatusBadge, TableWrap, formatPercent, tdClass, thClass } from "./common";

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
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="my-commissions">
      <div>
        <div className="text-[15px] font-medium text-[var(--color-ink)]">{t("femme.commissions.my.title")}</div>
        <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">{t("femme.commissions.my.subtitle")}</div>
      </div>
      <Card className="grid gap-2 p-4 sm:grid-cols-3">
        <div>
          <Text variant="small">
            {period.from && period.to
              ? t("femme.commissions.my.currentPeriod", {
                  from: formatParaguayDate(period.from + "T12:00:00", dateLocale),
                  to: formatParaguayDate(period.to + "T12:00:00", dateLocale),
                })
              : t("femme.commissions.my.currentMonth")}
          </Text>
          <Text className="text-lg font-semibold" data-testid="my-commissions-total">
            {formatGuaraniesGs(summary.currentPeriodTotal)}
          </Text>
        </div>
        <div>
          <Text variant="small">{t("femme.commissions.kind.SERVICE")}</Text>
          <Text data-testid="my-commissions-services">{formatGuaraniesGs(summary.servicesTotal)}</Text>
        </div>
        <div>
          <Text variant="small">{t("femme.commissions.kind.PRODUCT")}</Text>
          <Text data-testid="my-commissions-products">{formatGuaraniesGs(summary.productsTotal)}</Text>
        </div>
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h3 className="text-base font-medium">{t("femme.commissions.my.entriesTitle")}</h3>
        {summary.currentPeriodEntries.length === 0 ? (
          <Text variant="muted">{t("femme.commissions.my.noEntries")}</Text>
        ) : (
          <TableWrap testId="my-commissions-entries">
            <thead>
              <tr>
                <th className={thClass}>{t("femme.commissions.history.date")}</th>
                <th className={thClass}>{t("femme.commissions.common.item")}</th>
                <th className={thClass}>{t("femme.commissions.common.itemKind")}</th>
                <th className={thClass}>{t("femme.commissions.settlement.base")}</th>
                <th className={`${thClass} text-right`}>{t("femme.commissions.settlement.baseAmount")}</th>
                <th className={`${thClass} text-right`}>%</th>
                <th className={`${thClass} text-right`}>{t("femme.commissions.settlement.commission")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.currentPeriodEntries.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className={tdClass}>{formatParaguayDateTime(e.accrualAt, dateLocale)}</td>
                  <td className={tdClass}>{e.itemName ?? e.note ?? t(`femme.commissions.reason.${e.reasonCode}`)}</td>
                  <td className={tdClass}>{e.itemKind ? t(`femme.commissions.kind.${e.itemKind}`) : ""}</td>
                  <td className={tdClass}>{e.baseType ? t(`femme.commissions.base.${e.baseType}`) : ""}</td>
                  <td className={`${tdClass} text-right`}>{formatGuaraniesGs(e.baseAmount)}</td>
                  <td className={`${tdClass} text-right`}>{formatPercent(e.percentApplied)}</td>
                  <td className={`${tdClass} text-right`}>{formatGuaraniesGs(e.commissionAmount)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h3 className="text-base font-medium">{t("femme.commissions.my.settlementsTitle")}</h3>
        {summary.settlements.length === 0 ? (
          <Text variant="muted">{t("femme.commissions.settlements.empty")}</Text>
        ) : (
          <TableWrap testId="my-commissions-settlements">
            <thead>
              <tr>
                <th className={thClass}>{t("femme.commissions.settlements.period")}</th>
                <th className={thClass}>{t("femme.commissions.common.status")}</th>
                <th className={`${thClass} text-right`}>{t("femme.commissions.common.total")}</th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody>
              {summary.settlements.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className={tdClass}>
                    {formatParaguayDate(s.periodFrom + "T12:00:00", dateLocale)} – {formatParaguayDate(s.periodTo + "T12:00:00", dateLocale)}
                  </td>
                  <td className={tdClass}>
                    <SettlementStatusBadge status={s.status} />
                  </td>
                  <td className={`${tdClass} text-right`}>{formatGuaraniesGs(s.totalAmount)}</td>
                  <td className={tdClass}>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void getMySettlement(s.id)
                          .then(setDetail)
                          .catch((err) => setError(translateApiError(err, t)))
                      }
                    >
                      {t("femme.commissions.settlements.open")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? t("femme.commissions.settlement.title", { id: detail.settlement.id, name: detail.settlement.professionalName }) : ""}
        className="max-w-3xl"
      >
        {detail && (
          <div className="flex flex-col gap-2" data-testid="my-settlement-detail">
            <TableWrap>
              <thead>
                <tr>
                  <th className={thClass}>{t("femme.commissions.common.item")}</th>
                  <th className={thClass}>{t("femme.commissions.settlement.base")}</th>
                  <th className={`${thClass} text-right`}>%</th>
                  <th className={`${thClass} text-right`}>{t("femme.commissions.settlement.commission")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.entries.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className={tdClass}>{e.itemName ?? e.note ?? t(`femme.commissions.reason.${e.reasonCode}`)}</td>
                    <td className={tdClass}>{e.baseType ? t(`femme.commissions.base.${e.baseType}`) : ""}</td>
                    <td className={`${tdClass} text-right`}>{formatPercent(e.percentApplied)}</td>
                    <td className={`${tdClass} text-right`}>{formatGuaraniesGs(e.commissionAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Text className="font-medium">
              {t("femme.commissions.common.total")}: {formatGuaraniesGs(detail.settlement.totalAmount)}
            </Text>
          </div>
        )}
      </Modal>
    </div>
  );
}
