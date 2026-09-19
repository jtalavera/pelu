import { useTranslation } from "react-i18next";
import { Text } from "@design-system";
import { useDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal } from "../lib/formatMoney";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";
import type { CashMovementType, CashSessionDetail } from "../api/cashSessions";

function capitalizeSnake(s: string): string {
  if (!s) return "";
  return s
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

function movementTypeKey(type: CashMovementType): string {
  switch (type) {
    case "MANUAL_IN":
      return "ManualIn";
    case "MANUAL_OUT":
      return "ManualOut";
    case "TIP_WITHDRAWAL_OUT":
      return "TipWithdrawal";
  }
}

/**
 * Shared metrics/payment-breakdown/movements block, reused for the live open-session view, the
 * just-closed summary, and the historical detail modal (issue #259).
 */
export function CashSessionSummaryCard({ detail }: { detail: CashSessionDetail }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const diff = detail.cashDifference !== null ? parseFloat(detail.cashDifference) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm max-w-sm">
        <span className="text-[rgb(var(--color-muted-foreground))]">
          {t("femme.billing.close.totalInvoiced")}
        </span>
        <span className="text-right">{formatAmountDecimal(detail.totalInvoiced)}</span>
        <span className="text-[rgb(var(--color-muted-foreground))]">
          {t("femme.billing.close.invoiceCount")}
        </span>
        <span className="text-right">{detail.invoiceCount}</span>
        <span className="text-[rgb(var(--color-muted-foreground))]">
          {t(
            detail.isOpen
              ? "femme.billing.session.liveExpectedCash"
              : "femme.billing.close.expectedCash",
          )}
        </span>
        <span className="text-right" data-testid="cash-summary-expected-cash">
          {formatAmountDecimal(detail.expectedCashAmount)}
        </span>
        {detail.countedCashAmount !== null && (
          <>
            <span className="text-[rgb(var(--color-muted-foreground))]">
              {t("femme.billing.close.countedCash")}
            </span>
            <span className="text-right">{formatAmountDecimal(detail.countedCashAmount)}</span>
          </>
        )}
        {diff !== null && (
          <>
            <span
              className={`font-semibold ${diff < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600"}`}
            >
              {t("femme.billing.close.difference")}
            </span>
            <span
              className={`text-right font-semibold ${diff < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600"}`}
            >
              {diff >= 0 ? "+" : ""}
              {formatAmountDecimal(detail.cashDifference as string)}
            </span>
          </>
        )}
      </div>

      {(detail.paymentSummary ?? []).length > 0 && (
        <div className="pt-3" style={{ borderTop: "var(--border-default)" }}>
          <Text className="font-medium text-sm mb-1">
            {t("femme.billing.close.paymentBreakdown")}
          </Text>
          <div className="flex flex-col gap-1">
            {(detail.paymentSummary ?? []).map((ps, i) => (
              <div key={i} className="flex justify-between text-sm max-w-xs">
                <span>{t(`femme.billing.invoice.paymentMethod${capitalizeSnake(ps.method)}`)}</span>
                <span>{formatAmountDecimal(ps.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pt-3" style={{ borderTop: "var(--border-default)" }}>
        <Text className="font-medium text-sm mb-1">{t("femme.billing.movements.title")}</Text>
        {(detail.movements ?? []).length === 0 ? (
          <Text variant="muted" className="text-sm">
            {t("femme.billing.movements.emptyToday")}
          </Text>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left text-xs uppercase text-[var(--color-ink-3)]">
                    {t("femme.billing.movements.colTime")}
                  </th>
                  <th className="px-2 py-1 text-left text-xs uppercase text-[var(--color-ink-3)]">
                    {t("femme.billing.movements.colType")}
                  </th>
                  <th className="px-2 py-1 text-right text-xs uppercase text-[var(--color-ink-3)]">
                    {t("femme.billing.movements.colAmount")}
                  </th>
                  <th className="px-2 py-1 text-left text-xs uppercase text-[var(--color-ink-3)]">
                    {t("femme.billing.movements.colReason")}
                  </th>
                  <th className="px-2 py-1 text-left text-xs uppercase text-[var(--color-ink-3)]">
                    {t("femme.billing.movements.colCreatedBy")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(detail.movements ?? []).map((m) => (
                  <tr key={m.id} style={{ borderTop: "var(--border-default)" }}>
                    <td className="px-2 py-1">{formatParaguayDateTime(m.createdAt, dateLocale)}</td>
                    <td className="px-2 py-1">
                      {t(`femme.billing.movements.type${movementTypeKey(m.type)}`)}
                    </td>
                    <td className="px-2 py-1 text-right">{formatAmountDecimal(m.amount)}</td>
                    <td className="px-2 py-1">{m.reason ?? "—"}</td>
                    <td className="px-2 py-1">{m.createdByEmail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
