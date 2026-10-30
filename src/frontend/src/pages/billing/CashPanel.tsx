import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Text } from "@design-system";
import type { CashMovementType, CashSession, CashSessionDetail } from "../../api/cashSessions";
import { CashSessionSummaryCard } from "../../components/CashSessionSummaryCard";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { capitalize } from "./billingShared";

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

/** One folded line of the cash screens: label, optional counter badge, chevron. */
function Disclosure({
  id,
  label,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        data-testid={`cash-section-${id}`}
        onClick={onToggle}
        className="flex min-h-12 w-full items-center justify-between gap-3 text-left font-bold text-ink"
      >
        <span>{label}</span>
        <span className="flex items-center gap-2.5 text-ink-3">
          {count !== undefined && (
            <span
              className={`inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full px-2 text-[13px] font-extrabold ${
                count > 0 ? "bg-primary-lt text-primary" : "bg-line text-ink-3"
              }`}
            >
              {count}
            </span>
          )}
          <span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>
            ⌄
          </span>
        </span>
      </button>
      {open ? (
        <div id={`${id}-body`} className="pb-3 text-sm">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-ink-3">{label}</span>
      <span className="min-w-0 break-words text-right font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

/**
 * Open cash register, minimalist: one number (the cash that should be in the drawer), a one-line
 * summary of the day, and everything else folded.
 */
export function CashPanelSummary({
  session,
  detail,
}: {
  session: CashSession;
  detail: CashSessionDetail | null;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [open, setOpen] = useState<"methods" | "movements" | "opening" | null>(null);
  const toggle = (k: "methods" | "movements" | "opening") => setOpen((o) => (o === k ? null : k));
  const movements = detail?.movements ?? [];
  const methods = detail?.paymentSummary ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-success">
        <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
        {t("femme.billing.cash.openSince", { when: formatParaguayDateTime(session.openedAt, dateLocale) })}
      </div>

      {detail && (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-ink-3">{t("femme.billing.cash.expectedLabel")}</span>
          <span
            className="font-heading text-4xl font-extrabold tabular-nums text-ink"
            data-testid="cash-summary-expected-cash"
          >
            {formatGuaraniesGs(detail.expectedCashAmount)}
          </span>
          <span className="text-sm tabular-nums text-ink-3" data-testid="cash-panel-day-line">
            {t("femme.billing.cash.invoicedLine", {
              count: detail.invoiceCount,
              amount: formatGuaraniesGs(detail.totalInvoiced),
            })}
          </span>
        </div>
      )}

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
                label={t(`femme.billing.invoice.paymentMethod${capitalize(m.method)}`)}
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
            movements.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-3 py-1.5">
                <span className="min-w-0">
                  <span className="font-semibold text-ink">
                    {t(`femme.billing.movements.type${movementTypeKey(m.type)}`)}
                  </span>
                  <span className="block break-words text-ink-3">
                    {formatParaguayDateTime(m.createdAt, dateLocale)}
                    {m.reason ? ` · ${m.reason}` : ""}
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-ink">{formatGuaraniesGs(m.amount)}</span>
              </div>
            ))
          )}
        </Disclosure>
        <Disclosure
          id="opening"
          label={t("femme.billing.cash.openingData")}
          open={open === "opening"}
          onToggle={() => toggle("opening")}
        >
          <Row label={t("femme.billing.session.metricOpenedBy")} value={session.openedByEmail} />
          <Row
            label={t("femme.billing.session.metricOpeningAmount")}
            value={formatGuaraniesGs(session.openingCashAmount)}
          />
        </Disclosure>
      </div>
    </div>
  );
}

/** Difference between counted and expected cash, as a short plain-language verdict. */
export function cashVerdict(
  t: (k: string, o?: Record<string, unknown>) => string,
  diff: number,
): { text: string; balanced: boolean } {
  if (diff === 0) return { text: t("femme.billing.cash.balanced"), balanced: true };
  const amount = formatGuaraniesGs(Math.abs(diff));
  return {
    text:
      diff > 0
        ? t("femme.billing.cash.surplusAmount", { amount })
        : t("femme.billing.cash.shortageAmount", { amount }),
    balanced: false,
  };
}

/**
 * Summary shown after closing the register: the verdict first, the numbers one tap away.
 * Replaces the old full-page block of metrics.
 */
export function CashClosedSummary({
  detail,
  onDismiss,
}: {
  detail: CashSessionDetail;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [open, setOpen] = useState(false);
  const diff = detail.cashDifference !== null ? parseFloat(detail.cashDifference) : 0;
  const verdict = cashVerdict(t as never, diff);

  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-6" data-testid="billing-close-result">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className={`flex size-12 shrink-0 items-center justify-center rounded-full text-xl font-extrabold ${
            verdict.balanced ? "bg-success-lt text-success" : "bg-warning-lt text-warning"
          }`}
        >
          {verdict.balanced ? "✓" : "!"}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[22px] font-extrabold leading-tight text-ink">
            {t("femme.billing.cash.closedNotice")}
          </h2>
          <p className="text-sm text-ink-3">
            {detail.closedAt ? formatParaguayDateTime(detail.closedAt, dateLocale) : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 min-w-11 px-0"
          aria-label={t("femme.billing.cash.dismiss")}
          data-testid="billing-close-result-dismiss"
          onClick={onDismiss}
        >
          ✕
        </Button>
      </div>
      <div>
        <div
          className={`font-heading text-xl font-extrabold ${verdict.balanced ? "text-ink" : "text-warning"}`}
          data-testid="billing-close-verdict"
        >
          {verdict.text}
        </div>
        <div className="text-sm tabular-nums text-ink-3">
          {t("femme.billing.cash.closedInvoicedLine", {
            count: detail.invoiceCount,
            amount: formatGuaraniesGs(detail.totalInvoiced),
          })}
        </div>
      </div>
      <div className="border-t border-line">
        <button
          type="button"
          aria-expanded={open}
          data-testid="billing-close-result-toggle"
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-12 w-full items-center justify-between text-left font-bold text-ink"
        >
          {t("femme.billing.cash.viewDetail")}
          <span aria-hidden className={`text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}>
            ⌄
          </span>
        </button>
        {open ? (
          <div className="flex flex-col gap-3 pb-2" data-testid="billing-close-result-detail">
            <div className="text-sm text-ink-3">
              {t("femme.billing.close.closedBy")}: {detail.closedByEmail}
            </div>
            <CashSessionSummaryCard detail={detail} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
