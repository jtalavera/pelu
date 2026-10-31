import { useTranslation } from "react-i18next";
import type { CashMovement, CashMovementType } from "../api/cashSessions";
import { useDateLocale } from "../i18n/dateLocale";
import { formatSignedGs } from "../lib/formatMoney";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";

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
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span
        className={`font-semibold tabular-nums ${outgoing ? "text-danger" : "text-success"}`}
        data-testid="cash-movement-amount"
      >
        {formatSignedGs(outgoing ? -amount : amount, !outgoing)}
      </span>
    </div>
  );
}
