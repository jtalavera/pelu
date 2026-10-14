import { useTranslation } from "react-i18next";
import { Alert } from "@design-system";
import type { StockAvailabilityItem } from "../api/stock";
import { formatStockQuantity } from "./useStockAvailability";

/**
 * HU-66: under an invoice line holding a product — "Disponible: N", and an amber, non-blocking
 * warning when the quantity requested (all lines of that product together) exceeds it.
 */
export function StockAvailabilityHint({
  item,
  requested,
  testId,
}: {
  item: StockAvailabilityItem | undefined;
  requested: number;
  testId: string;
}) {
  const { t } = useTranslation();
  if (!item || !item.mapped || item.available == null) return null;
  const available = Number(item.available);
  const formatted = formatStockQuantity(available);
  if (requested > available) {
    return (
      <Alert variant="warning" data-testid={`${testId}-warning`} className="py-2 text-xs">
        {t("femme.billing.stock.willGoNegative", { available: formatted })}
      </Alert>
    );
  }
  return (
    <p data-testid={testId} className="text-xs text-[var(--color-ink-3)]">
      {t("femme.billing.stock.available", { available: formatted })}
    </p>
  );
}
