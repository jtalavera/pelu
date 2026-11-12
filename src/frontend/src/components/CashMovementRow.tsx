import { useTranslation } from "react-i18next";
import type { CashLateTip, CashMovement, CashMovementType } from "../api/cashSessions";
import { useDateLocale } from "../i18n/dateLocale";
import { formatGuaraniesGs, formatSignedGs } from "../lib/formatMoney";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";
import { capitalize as capitalizeSnake } from "../pages/billing/billingShared";

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

/** Manual cash-in adds to the drawer; manual cash-out and tip withdrawals take cash out. */
export const isOutgoingMovement = (type: CashMovementType) => type !== "MANUAL_IN";

/**
 * One cash movement as a compact row: type, then `date · reason · who`, and the amount on the
 * right — negative and red for cash going out, positive and green for cash coming in.
 */
export function CashMovementRow({ movement, showUser = false }: { movement: CashMovement; showUser?: boolean }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const outgoing = isOutgoingMovement(movement.type);
  const amount = Number(movement.amount);
  return (
    <div className="flex items-start justify-between gap-3 py-1.5" data-testid="cash-movement-row">
      <span className="min-w-0">
        <span className="font-semibold text-ink">{t(`femme.billing.movements.type${movementTypeKey(movement.type)}`)}</span>
        <span className="block break-words text-ink-3">
          {[
            formatParaguayDateTime(movement.createdAt, dateLocale),
            movement.reason,
            showUser ? movement.createdByEmail : null,
            movement.afterClose ? t("femme.billing.movements.afterClose") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span
        className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${outgoing ? "text-danger" : "text-success"}`}
        data-testid="cash-movement-amount"
      >
        {formatSignedGs(outgoing ? -amount : amount, !outgoing)}
      </span>
    </div>
  );
}

/** One entry of a register's «Movimientos»: a manual/tip-withdrawal movement or a late tip (HU-73). */
export type CashEntry =
  | { kind: "movement"; key: string; at: string; movement: CashMovement }
  | { kind: "lateTip"; key: string; at: string; tip: CashLateTip };

/** Movements and late tips of a register, oldest first. */
export function mergeCashEntries(movements: CashMovement[], lateTips: CashLateTip[]): CashEntry[] {
  const entries: CashEntry[] = [
    ...movements.map((m): CashEntry => ({ kind: "movement", key: `m-${m.id}`, at: m.createdAt, movement: m })),
    ...lateTips.map((tip): CashEntry => ({ kind: "lateTip", key: `t-${tip.id}`, at: tip.createdAt, tip })),
  ];
  return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/**
 * A tip left after the invoice was issued, as a register row: «Propina cobrada» (or «anulada»),
 * who it is for and the invoice, then how it was paid. Only cash tips move the drawer, so only
 * those show a «+» amount; voided ones are struck through and count nowhere.
 */
export function CashLateTipRow({ tip, showUser = false }: { tip: CashLateTip; showUser?: boolean }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const amount = Number(tip.amount);
  const inCash = tip.paymentMethod === "CASH";
  const method = t(`femme.billing.invoice.paymentMethod${capitalizeSnake(tip.paymentMethod)}`);
  const brand = tip.cardBrand ? t(`femme.billing.invoice.cardBrand${capitalizeSnake(tip.cardBrand)}`) : null;
  return (
    <div
      className="flex items-start justify-between gap-3 py-1.5"
      data-testid="cash-late-tip-row"
      data-voided={tip.voided ? "true" : "false"}
    >
      <span className="min-w-0">
        <span className={`font-semibold ${tip.voided ? "text-ink-3" : "text-ink"}`}>
          {tip.voided
            ? t("femme.billing.movements.typeLateTipVoided")
            : t("femme.billing.movements.typeLateTip")}
          {" · "}
          {tip.professionalName} · #{tip.invoiceNumberFormatted}
        </span>
        <span className="block break-words text-ink-3">
          {[
            [method, brand].filter(Boolean).join(" · "),
            formatParaguayDateTime(tip.createdAt, dateLocale),
            showUser ? tip.createdByEmail : null,
            tip.voided && tip.voidReason ? `«${tip.voidReason}»` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span
        className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${
          tip.voided ? "text-ink-3 line-through" : inCash ? "text-success" : "text-ink"
        }`}
        data-testid="cash-late-tip-amount"
      >
        {formatSignedGs(amount, inCash && !tip.voided)}
      </span>
    </div>
  );
}

/**
 * «Incluyen las propinas cobradas después de emitir: efectivo 10.000, …» — what part of the
 * per-method totals are late tips (voided ones excluded). Null when there are none.
 */
export function lateTipsMethodsNote(
  lateTips: CashLateTip[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const byMethod = new Map<string, number>();
  for (const tip of lateTips) {
    if (tip.voided) continue;
    byMethod.set(tip.paymentMethod, (byMethod.get(tip.paymentMethod) ?? 0) + Number(tip.amount));
  }
  if (byMethod.size === 0) return null;
  const parts = Array.from(byMethod, ([method, total]) => {
    const label = t(`femme.billing.invoice.paymentMethod${capitalizeSnake(method)}`).toLowerCase();
    return `${label} ${formatGuaraniesGs(total)}`;
  }).join(", ");
  return t("femme.billing.cash.lateTipsNote", { parts });
}
