import { useTranslation } from "react-i18next";
import { Input, Label } from "@design-system";
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
    <div className="flex flex-col gap-3">
      <h3 className="font-heading text-xs font-extrabold uppercase tracking-wider text-primary">
        {t("femme.billing.invoice.linesSection")}
      </h3>
      <div className="flex flex-col">
        {lines.map((line, idx) => {
          const net = Math.max(
            0,
            lineGross(line, taxExemptReceiver) - lineDiscountAmount(line, taxExemptReceiver),
          );
          return (
            <div
              key={`${linesKey}-${idx}`}
              className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 first:pt-0"
            >
              <div className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-2.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-[13px] font-extrabold text-primary-fg"
                >
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <ServiceSearchField
                    id={`billing-line-svc-${idx}`}
                    value={line.pickedService}
                    onChange={(svc) => handleServiceChange(idx, svc)}
                    label={t("femme.billing.invoice.lineServiceLabel")}
                    labelSrOnly
                    placeholder={t("femme.billing.invoice.lineServicePlaceholder")}
                    invalid={!!errors[idx]?.service}
                    errorDescribedById={`line-svc-err-${idx}`}
                  />
                  <FieldValidationError id={`line-svc-err-${idx}`}>
                    {errors[idx]?.service}
                  </FieldValidationError>
                </div>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onChange(lines.filter((_, i) => i !== idx))}
                    aria-label={t("femme.billing.invoice.removeLine")}
                    className="size-11 shrink-0 rounded-lg text-base text-ink-3 hover:bg-bg hover:text-danger"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-end gap-x-2 gap-y-1 pl-8">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`line-qty-${idx}`} className="text-xs font-semibold text-ink-3">
                    {t("femme.billing.invoice.lineQuantity")}
                  </Label>
                  <Input
                    id={`line-qty-${idx}`}
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(e) => updateField(idx, "quantity", e.target.value)}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <Label htmlFor={`line-price-${idx}`} className="text-xs font-semibold text-ink-3">
                    {t("femme.billing.invoice.lineUnitPrice")}
                  </Label>
                  <Input
                    id={`line-price-${idx}`}
                    inputMode="numeric"
                    value={line.unitPrice}
                    onChange={(e) => updateField(idx, "unitPrice", e.target.value)}
                    placeholder={t("femme.billing.invoice.lineUnitPricePlaceholder")}
                    aria-invalid={!!errors[idx]?.unitPrice}
                    aria-describedby={errors[idx]?.unitPrice ? `line-price-err-${idx}` : undefined}
                  />
                </div>
                <b className="whitespace-nowrap pb-2.5 text-right font-heading tabular-nums text-ink">
                  {formatDecimalGs(net)}
                </b>
              </div>
              <div className="pl-8">
                <FieldValidationError id={`line-disc-amt-err-${idx}`}>
                  {errors[idx]?.discountValue}
                </FieldValidationError>
                <FieldValidationError id={`line-price-err-${idx}`}>
                  {errors[idx]?.unitPrice}
                </FieldValidationError>
                {line.discountEnabled && line.discountValue && (
                  <p
                    data-testid={`line-discounted-total-${idx}`}
                    className="text-sm font-medium tabular-nums text-success"
                  >
                    {t("femme.billing.invoice.lineDiscountedTotal")}: {formatDecimalGs(net)}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 pl-8">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={line.discountEnabled}
                    onChange={() =>
                      setLine(idx, { discountEnabled: !line.discountEnabled, discountValue: "" })
                    }
                    id={`line-disc-toggle-${idx}`}
                    className="size-4 accent-primary"
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
                      className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm"
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
                      className="w-28"
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="min-h-11 w-fit px-1 text-sm font-bold text-primary underline underline-offset-4"
        onClick={() => onChange([...lines, emptyInvoiceLine()])}
      >
        + {t("femme.billing.invoice.addLine")}
      </button>
    </div>
  );
}
