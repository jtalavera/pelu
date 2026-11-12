import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "@design-system";
import type { CashSessionDetail } from "../api/cashSessions";
import { useDateLocale } from "../i18n/dateLocale";
import { formatGuaraniesGs, formatSignedGs } from "../lib/formatMoney";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";
import { Disclosure, Row } from "./CashDisclosure";
import { CashMovementRow } from "./CashMovementRow";

function capitalizeSnake(s: string): string {
  if (!s) return "";
  return s
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

type Section = "methods" | "movements" | "data";

/**
 * Minimalist cash-session detail, shared by the historical detail dialog and the just-closed summary:
 * the headline figures (expected cash while open; expected / counted / difference once closed), then
 * the payment methods, the movements (cash out shown negative) and the opening/closing data, folded.
 * `hideHero` drops the headline when the host already shows its own verdict.
 */
export function CashSessionSummaryCard({
  detail,
  hideHero = false,
}: {
  detail: CashSessionDetail;
  hideHero?: boolean;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [open, setOpen] = useState<Section | null>("movements");
  const toggle = (k: Section) => setOpen((o) => (o === k ? null : k));
  const diff = detail.cashDifference !== null ? parseFloat(detail.cashDifference) : null;
  const expected = Number(detail.expectedCashAmount);
  const methods = detail.paymentSummary ?? [];
  const movements = detail.movements ?? [];
  const dayLine = t("femme.billing.cash.invoicedLine", {
    count: detail.invoiceCount,
    amount: formatGuaraniesGs(detail.totalInvoiced),
  });

  return (
    <div className="flex flex-col gap-3" data-testid="cash-session-summary">
      {(!hideHero || !detail.isOpen) &&
        (detail.isOpen ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-ink-3">{t("femme.billing.session.liveExpectedCash")}</span>
            <span
              className={`font-heading text-3xl font-extrabold tabular-nums ${expected < 0 ? "text-danger" : "text-ink"}`}
              data-testid="cash-summary-expected-cash"
            >
              {formatSignedGs(detail.expectedCashAmount)}
            </span>
            <span className="text-sm text-ink-3">{dayLine}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm text-ink-3">{t("femme.billing.close.expectedCash")}</span>
                <b className="font-heading text-lg tabular-nums text-ink" data-testid="cash-summary-expected-cash">
                  {formatSignedGs(detail.expectedCashAmount)}
                </b>
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="text-sm text-ink-3">{t("femme.billing.close.countedCash")}</span>
                <b className="font-heading text-lg tabular-nums text-ink">
                  {detail.countedCashAmount !== null ? formatSignedGs(detail.countedCashAmount) : "—"}
                </b>
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="text-sm text-ink-3">{t("femme.billing.close.difference")}</span>
                <b
                  className={`font-heading text-lg tabular-nums ${
                    diff === null || diff === 0 ? "text-ink" : diff < 0 ? "text-danger" : "text-success"
                  }`}
                >
                  {diff === null ? "—" : formatSignedGs(diff, true)}
                </b>
              </div>
            </div>
            {hideHero ? null : <span className="text-sm text-ink-3">{dayLine}</span>}
          </div>
        ))}

      <div>
        <Disclosure
          id="methods"
          label={t("femme.billing.cash.methods")}
          open={open === "methods"}
          onToggle={() => toggle("methods")}
        >
          {methods.length === 0 ? (
            <Text variant="muted">{t("femme.billing.cash.noPayments")}</Text>
          ) : (
            methods.map((m, i) => (
              <Row
                key={i}
                label={t(`femme.billing.invoice.paymentMethod${capitalizeSnake(m.method)}`)}
                value={formatGuaraniesGs(m.total)}
              />
            ))
          )}
        </Disclosure>
        <Disclosure
          id="movements"
          label={t("femme.billing.movements.title")}
          count={movements.length}
          open={open === "movements"}
          onToggle={() => toggle("movements")}
        >
          {movements.length === 0 ? (
            <Text variant="muted">{t("femme.billing.movements.emptyToday")}</Text>
          ) : (
            movements.map((m) => <CashMovementRow key={m.id} movement={m} showUser />)
          )}
        </Disclosure>
        <Disclosure
          id="data"
          label={t("femme.billing.cashHistory.dataTitle")}
          open={open === "data"}
          onToggle={() => toggle("data")}
        >
          <Row label={t("femme.billing.session.metricOpenedAt")} value={formatParaguayDateTime(detail.openedAt, dateLocale)} />
          <Row label={t("femme.billing.session.metricOpenedBy")} value={detail.openedByEmail} />
          <Row label={t("femme.billing.session.metricOpeningAmount")} value={formatGuaraniesGs(detail.openingCashAmount)} />
          {detail.closedAt && (
            <>
              <Row label={t("femme.billing.close.closedAt")} value={formatParaguayDateTime(detail.closedAt, dateLocale)} />
              <Row label={t("femme.billing.close.closedBy")} value={detail.closedByEmail ?? "—"} />
            </>
          )}
        </Disclosure>
      </div>
    </div>
  );
}
