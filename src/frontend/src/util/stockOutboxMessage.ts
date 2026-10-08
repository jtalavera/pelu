import type { TFunction } from "i18next";
import type { StockOutboxMessage, StockOutboxRow } from "../api/stock";

/**
 * Turns one history entry of a Stock delivery (a code + parameters stored by the backend) into
 * the sentence the support user reads. `formatDate` renders the ISO instants carried in params.
 */
export function formatStockOutboxMessage(
  t: TFunction,
  formatDate: (iso: string | null) => string,
  message: StockOutboxMessage,
): string {
  const params = message.params ?? {};
  const code =
    message.code === "DELIVERED" && params.items != null ? "DELIVERED_CATALOG" : message.code;
  return t(`femme.platform.stock.msg.${code}`, {
    ...params,
    reason: params.reason
      ? t(`femme.platform.stock.reason.${params.reason}`, {
          defaultValue: t("femme.platform.stock.reason.UNKNOWN"),
        })
      : "",
    nextAttemptAt: typeof params.nextAttemptAt === "string" ? formatDate(params.nextAttemptAt) : "",
    defaultValue: message.code,
  });
}

/** A delivery can be retried/discarded when it FAILED, or is PENDING after a failed attempt. */
export function isStockOutboxActionable(row: Pick<StockOutboxRow, "status" | "attemptCount">) {
  return row.status === "FAILED" || (row.status === "PENDING" && row.attemptCount > 0);
}
