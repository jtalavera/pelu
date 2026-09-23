import { useTranslation } from "react-i18next";
import { Button, Heading, Input, Label, Select, Text } from "@design-system";
import { FieldValidationError } from "../FieldValidationError";
import { formatAmountDecimal } from "../../lib/formatMoney";
import { maskMoneyInput, parseMaskedMoney } from "../../lib/moneyInputMask";
import {
  CARD_BRANDS,
  CARD_PAYMENT_METHODS,
  PAYMENT_METHODS,
  emptyInvoicePayment,
  snakeToPascal,
  type InvoicePaymentForm,
} from "./invoiceFormShared";

/**
 * Issue #175: the payment-methods editor + the subtotal / discount / total / remaining summary.
 * Fully controlled. Same DOM ids (`pay-method-*`, `pay-amount-*`, `pay-card-brand-*`, …) as
 * `NewInvoiceTab`.
 */
export function InvoicePaymentsEditor({
  payments,
  onChange,
  errors,
  subtotal,
  discountAmount,
  total,
}: {
  payments: InvoicePaymentForm[];
  onChange: (next: InvoicePaymentForm[]) => void;
  errors: Record<number, string>;
  subtotal: number;
  discountAmount: number;
  total: number;
}) {
  const { t } = useTranslation();

  const assigned = payments.reduce((acc, p) => acc + parseMaskedMoney(p.amount), 0);
  const remaining = total - assigned;

  function updatePayment(idx: number, field: keyof InvoicePaymentForm, value: string) {
    const next = field === "amount" ? maskMoneyInput(value) : value;
    onChange(
      payments.map((p, i) => {
        if (i !== idx) return p;
        const updated = { ...p, [field]: next };
        if (field === "method" && !CARD_PAYMENT_METHODS.has(next)) {
          updated.cardBrand = "";
          updated.cardBrandOtherDescription = "";
        }
        if (field === "cardBrand" && next !== "OTHER") {
          updated.cardBrandOtherDescription = "";
        }
        return updated;
      }),
    );
  }

  function addPayment() {
    const used = new Set(payments.map((p) => p.method));
    const nextMethod = PAYMENT_METHODS.find((m) => !used.has(m));
    if (!nextMethod) return;
    onChange([...payments, emptyInvoicePayment(nextMethod)]);
  }

  return (
    <div className="flex flex-col gap-4">
      <Heading as="h3" className="text-base">
        {t("femme.billing.invoice.paymentsSection")}
      </Heading>

      <div className="flex flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <span className="text-[rgb(var(--color-muted-foreground))]">
            {t("femme.billing.invoice.subtotal")}
          </span>
          <span>{formatAmountDecimal(subtotal.toFixed(2))}</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between">
            <span className="text-[rgb(var(--color-muted-foreground))]">
              {t("femme.billing.invoice.discount")}
            </span>
            <span>-{formatAmountDecimal(discountAmount.toFixed(2))}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold">
          <span>{t("femme.billing.invoice.total")}</span>
          <span>{formatAmountDecimal(total.toFixed(2))}</span>
        </div>
        <div
          className={`flex justify-between ${
            Math.abs(remaining) > 0.01 ? "text-red-600 dark:text-red-400" : "text-emerald-600"
          }`}
        >
          <span>{t("femme.billing.invoice.remaining")}</span>
          <span>{formatAmountDecimal(remaining.toFixed(2))}</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {payments.map((payment, idx) => {
          const amountNum = parseMaskedMoney(payment.amount);
          const amountIsInvalid = !Number.isFinite(amountNum) || amountNum <= 0;
          const isCard = CARD_PAYMENT_METHODS.has(payment.method);
          const cardError = !amountIsInvalid && errors[idx] ? errors[idx] : undefined;
          return (
            <div key={idx} className="flex flex-wrap gap-2 items-start">
              <div className="flex-1 min-w-[160px]">
                <Label htmlFor={`pay-method-${idx}`}>
                  {t("femme.billing.invoice.paymentMethod")}
                </Label>
                <Select
                  id={`pay-method-${idx}`}
                  value={payment.method}
                  onChange={(e) => updatePayment(idx, "method", e.target.value)}
                  className="mt-1 w-full"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option
                      key={m}
                      value={m}
                      disabled={payments.some((p, i) => i !== idx && p.method === m)}
                    >
                      {t(`femme.billing.invoice.paymentMethod${snakeToPascal(m)}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex-1 min-w-[120px]">
                <Label htmlFor={`pay-amount-${idx}`}>
                  {t("femme.billing.invoice.paymentAmount")}
                </Label>
                <Input
                  id={`pay-amount-${idx}`}
                  inputMode="numeric"
                  value={payment.amount}
                  onChange={(e) => updatePayment(idx, "amount", e.target.value)}
                  placeholder={t("femme.billing.invoice.paymentAmountPlaceholder")}
                  className="mt-1 w-full"
                  aria-invalid={amountIsInvalid && !!errors[idx]}
                  aria-describedby={
                    idx === 0
                      ? "pay-amount-0-hint"
                      : amountIsInvalid && errors[idx]
                        ? `pay-amount-err-${idx}`
                        : undefined
                  }
                />
                {idx === 0 ? (
                  <Text id="pay-amount-0-hint" variant="muted" className="mt-1 text-sm">
                    {t("femme.billing.invoice.paymentAmountFirstRowHint")}
                  </Text>
                ) : (
                  <FieldValidationError id={`pay-amount-err-${idx}`}>
                    {amountIsInvalid ? errors[idx] : undefined}
                  </FieldValidationError>
                )}
              </div>
              {isCard && (
                <div className="flex-1 min-w-[160px]">
                  <Label htmlFor={`pay-card-brand-${idx}`}>
                    {t("femme.billing.invoice.cardBrandLabel")}
                  </Label>
                  <Select
                    id={`pay-card-brand-${idx}`}
                    value={payment.cardBrand}
                    onChange={(e) => updatePayment(idx, "cardBrand", e.target.value)}
                    className="mt-1 w-full"
                    aria-invalid={!!cardError}
                    aria-describedby={cardError ? `pay-card-brand-err-${idx}` : undefined}
                  >
                    <option value="" disabled>
                      {t("femme.billing.invoice.cardBrandPlaceholder")}
                    </option>
                    {CARD_BRANDS.map((brand) => (
                      <option key={brand} value={brand}>
                        {t(`femme.billing.invoice.cardBrand${snakeToPascal(brand)}`)}
                      </option>
                    ))}
                  </Select>
                  <FieldValidationError id={`pay-card-brand-err-${idx}`}>
                    {cardError}
                  </FieldValidationError>
                </div>
              )}
              {isCard && payment.cardBrand === "OTHER" && (
                <div className="flex-1 min-w-[160px]">
                  <Label htmlFor={`pay-card-brand-other-${idx}`}>
                    {t("femme.billing.invoice.cardBrandOtherDescriptionLabel")}
                  </Label>
                  <Input
                    id={`pay-card-brand-other-${idx}`}
                    value={payment.cardBrandOtherDescription}
                    onChange={(e) =>
                      updatePayment(idx, "cardBrandOtherDescription", e.target.value)
                    }
                    placeholder={t("femme.billing.invoice.cardBrandOtherDescriptionPlaceholder")}
                    className="mt-1 w-full"
                  />
                </div>
              )}
              {payments.length > 1 && (
                <div className="flex items-end pb-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange(payments.filter((_, i) => i !== idx))}
                    aria-label={t("femme.billing.invoice.removePayment")}
                  >
                    ×
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-fit"
        onClick={addPayment}
        disabled={payments.length >= PAYMENT_METHODS.length}
      >
        {t("femme.billing.invoice.addPayment")}
      </Button>
    </div>
  );
}
