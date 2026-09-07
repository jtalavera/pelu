import { useTranslation } from "react-i18next";
import { Button, Heading, Input, Label } from "@design-system";
import { ServiceSearchField, type SalonServiceOption } from "../ServiceSearchField";
import { FieldValidationError } from "../FieldValidationError";
import { formatDecimalGs } from "../../lib/formatMoney";
import { maskMoneyInput } from "../../lib/moneyInputMask";
import {
  emptyInvoiceLine,
  lineDiscountAmount,
  lineGross,
  type InvoiceLineForm,
} from "./invoiceFormShared";

/**
 * Issue #175: the service-lines editor (service search, quantity, unit price, per-line discount).
 * Fully controlled — `lines` state lives in the parent. Same DOM ids (`billing-line-svc-*`,
 * `line-qty-*`, `line-price-*`, …) as `NewInvoiceTab` so existing selectors keep working after a
 * future migration.
 */
export function InvoiceLinesEditor({
  lines,
  onChange,
  errors,
  taxExemptReceiver,
  linesKey = 0,
}: {
  lines: InvoiceLineForm[];
  onChange: (next: InvoiceLineForm[]) => void;
  errors: Record<number, Record<string, string>>;
  taxExemptReceiver: boolean;
  linesKey?: number;
}) {
  const { t } = useTranslation();

  const setLine = (idx: number, patch: Partial<InvoiceLineForm>) =>
    onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  function handleServiceChange(idx: number, service: SalonServiceOption | null) {
    if (service) {
      setLine(idx, {
        pickedService: service,
        serviceId: String(service.id),
        description: service.name,
        unitPrice: maskMoneyInput(String(Number(service.priceMinor) || 0)),
      });
    } else {
      setLine(idx, { pickedService: null, serviceId: "" });
    }
  }

  function updateField(
    idx: number,
    field: "quantity" | "unitPrice" | "discountValue",
    value: string,
  ) {
    const line = lines[idx];
    let next = value;
    if (field === "unitPrice" || (field === "discountValue" && line.discountType === "FIXED")) {
      next = maskMoneyInput(value);
    }
    setLine(idx, { [field]: next } as Partial<InvoiceLineForm>);
  }

  return (
    <div className="flex flex-col gap-4">
      <Heading as="h3" className="text-base">
        {t("femme.billing.invoice.linesSection")}
      </Heading>
      <div className="flex flex-col gap-3">
        {lines.map((line, idx) => (
          <div
            key={`${linesKey}-${idx}`}
            className="grid grid-cols-12 gap-2 items-start border border-[rgb(var(--color-border))] rounded p-3"
          >
            <div className="col-span-12 sm:col-span-5">
              <ServiceSearchField
                id={`billing-line-svc-${idx}`}
                value={line.pickedService}
                onChange={(svc) => handleServiceChange(idx, svc)}
                label={t("femme.billing.invoice.lineServiceLabel")}
                placeholder={t("femme.billing.invoice.lineServicePlaceholder")}
                invalid={!!errors[idx]?.service}
                errorDescribedById={`line-svc-err-${idx}`}
              />
              <FieldValidationError id={`line-svc-err-${idx}`}>
                {errors[idx]?.service}
              </FieldValidationError>
            </div>
            <div className="col-span-4 sm:col-span-2">
              <Label htmlFor={`line-qty-${idx}`}>{t("femme.billing.invoice.lineQuantity")}</Label>
              <Input
                id={`line-qty-${idx}`}
                type="number"
                min="1"
                value={line.quantity}
                onChange={(e) => updateField(idx, "quantity", e.target.value)}
                className="mt-1 w-full"
              />
            </div>
            <div className="col-span-5 sm:col-span-3">
              <Label htmlFor={`line-price-${idx}`}>
                {t("femme.billing.invoice.lineUnitPrice")}
              </Label>
              <Input
                id={`line-price-${idx}`}
                inputMode="numeric"
                value={line.unitPrice}
                onChange={(e) => updateField(idx, "unitPrice", e.target.value)}
                placeholder={t("femme.billing.invoice.lineUnitPricePlaceholder")}
                className="mt-1 w-full"
                aria-invalid={!!errors[idx]?.unitPrice}
                aria-describedby={errors[idx]?.unitPrice ? `line-price-err-${idx}` : undefined}
              />
              <FieldValidationError id={`line-disc-amt-err-${idx}`}>
                {errors[idx]?.discountValue}
              </FieldValidationError>
              <FieldValidationError id={`line-price-err-${idx}`}>
                {errors[idx]?.unitPrice}
              </FieldValidationError>
              {line.discountEnabled && line.discountValue && (
                <p
                  data-testid={`line-discounted-total-${idx}`}
                  className="mt-1 text-sm font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
                >
                  {t("femme.billing.invoice.lineDiscountedTotal")}:{" "}
                  {formatDecimalGs(
                    Math.max(
                      0,
                      lineGross(line, taxExemptReceiver) -
                        lineDiscountAmount(line, taxExemptReceiver),
                    ),
                  )}
                </p>
              )}
            </div>
            <div className="col-span-9 sm:col-span-1 flex min-h-9 w-full items-end justify-center">
              <span className="w-full text-center text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">
                {formatDecimalGs(
                  Math.max(
                    0,
                    lineGross(line, taxExemptReceiver) -
                      lineDiscountAmount(line, taxExemptReceiver),
                  ),
                )}
              </span>
            </div>
            <div className="col-span-3 sm:col-span-1 flex items-end justify-end">
              {lines.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(lines.filter((_, i) => i !== idx))}
                  aria-label={t("femme.billing.invoice.removeLine")}
                >
                  ×
                </Button>
              )}
            </div>
            <div className="col-span-12 flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[rgb(var(--color-ink-2))]">
                <input
                  type="checkbox"
                  checked={line.discountEnabled}
                  onChange={() =>
                    setLine(idx, { discountEnabled: !line.discountEnabled, discountValue: "" })
                  }
                  id={`line-disc-toggle-${idx}`}
                />
                {t("femme.billing.invoice.lineDiscountToggle")}
              </label>
              {line.discountEnabled && (
                <>
                  <select
                    value={line.discountType}
                    onChange={(e) =>
                      setLine(idx, {
                        discountType: e.target.value as "FIXED" | "PERCENT",
                        discountValue: "",
                      })
                    }
                    aria-label={t("femme.billing.invoice.lineDiscountType")}
                    className="rounded border border-[rgb(var(--color-border))] bg-[rgb(var(--color-white))] px-2 py-1 text-xs"
                  >
                    <option value="PERCENT">{t("femme.billing.invoice.discountTypePercent")}</option>
                    <option value="FIXED">{t("femme.billing.invoice.discountTypeFixed")}</option>
                  </select>
                  <Input
                    id={`line-disc-val-${idx}`}
                    inputMode={line.discountType === "FIXED" ? "numeric" : "decimal"}
                    value={line.discountValue}
                    onChange={(e) => updateField(idx, "discountValue", e.target.value)}
                    placeholder="0"
                    aria-label={t("femme.billing.invoice.lineDiscountValue")}
                    aria-invalid={!!errors[idx]?.discountValue}
                    aria-describedby={
                      errors[idx]?.discountValue ? `line-disc-amt-err-${idx}` : undefined
                    }
                    className="w-24"
                  />
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-fit"
        onClick={() => onChange([...lines, emptyInvoiceLine()])}
      >
        {t("femme.billing.invoice.addLine")}
      </Button>
    </div>
  );
}
