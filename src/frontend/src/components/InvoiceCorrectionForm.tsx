import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Modal, Spinner, Text } from "@design-system";
import { femmeJson, femmePostJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { validateRuc } from "../lib/validateRuc";
import { isValidEmail } from "../lib/validateEmail";
import { maskMoneyInput, parseMaskedMoney } from "../lib/moneyInputMask";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";
import { useDateLocale } from "../i18n/dateLocale";
import { InvoiceClientFields } from "./invoice/InvoiceClientFields";
import type { InvoiceClientFieldsValue } from "./invoice/InvoiceClientFields";
import { InvoiceLinesEditor } from "./invoice/InvoiceLinesEditor";
import { InvoicePaymentsEditor } from "./invoice/InvoicePaymentsEditor";
import {
  CARD_PAYMENT_METHODS,
  SIFEN_CLIENT_IDENTIFICATION_THRESHOLD,
  computeInvoiceTotals,
  emptyInvoiceLine,
  emptyInvoicePayment,
  type InvoiceLineForm,
  type InvoicePaymentForm,
} from "./invoice/invoiceFormShared";
import type { InvoiceDetail } from "./InvoiceDetailModal";

type ClientProfile = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  ruc: string | null;
  identityDocumentNumber?: string | null;
  identityDocumentType?: string | null;
  taxpayerType?: string | null;
};

/**
 * Issue #175: modal to correct a SIFEN-rejected invoice's client / lines / discount / payments and
 * resend it under the same CDC. Reuses the shared {@link InvoiceClientFields} / {@link
 * InvoiceLinesEditor} / {@link InvoicePaymentsEditor} editors. Prefilled from the rejected
 * invoice's current data so the user only fixes what SIFEN complained about.
 */
export function InvoiceCorrectionForm({
  invoiceId,
  onClose,
  onResent,
}: {
  invoiceId: number;
  onClose: () => void;
  onResent: () => void;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Issue #190: header data shown read-only above the client section + the SIFEN resend-window check.
  const [invoiceNumberFormatted, setInvoiceNumberFormatted] = useState("");
  const [issuedAt, setIssuedAt] = useState<string | null>(null);
  const [correctResendDeadlineAt, setCorrectResendDeadlineAt] = useState<string | null>(null);

  const [clientFields, setClientFields] = useState<InvoiceClientFieldsValue>({
    selection: null,
    email: "",
    displayName: "",
    identityDocumentType: "RUC",
    identityDocumentNumber: "",
    taxpayerType: "PERSONA_FISICA",
  });
  const [lines, setLines] = useState<InvoiceLineForm[]>([emptyInvoiceLine()]);
  const [payments, setPayments] = useState<InvoicePaymentForm[]>([emptyInvoicePayment()]);
  const [discountType, setDiscountType] = useState("NONE");
  const [discountValue, setDiscountValue] = useState("");

  const [clientEmailError, setClientEmailError] = useState<string | null>(null);
  const [globalErrors, setGlobalErrors] = useState<string[]>([]);
  const [lineErrors, setLineErrors] = useState<Record<number, Record<string, string>>>({});
  const [paymentErrors, setPaymentErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const detail = await femmeJson<InvoiceDetail>(`/api/invoices/${invoiceId}`);
        let clientProfile: ClientProfile | null = null;
        if (detail.clientId != null) {
          clientProfile = await femmeJson<ClientProfile>(`/api/clients/${detail.clientId}`);
        }
        if (cancelled) return;
        prefill(detail, clientProfile);
      } catch {
        if (!cancelled) setLoadError(t("femme.billing.history.detail.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  function prefill(detail: InvoiceDetail, clientProfile: ClientProfile | null) {
    setInvoiceNumberFormatted(detail.invoiceNumberFormatted);
    setIssuedAt(detail.issuedAt);
    setCorrectResendDeadlineAt(detail.sifenCorrectResendDeadlineAt ?? null);
    const docType =
      detail.clientIdentityDocumentTypeOverride ?? (detail.clientRucOverride ? "RUC" : "RUC");
    const docNumber =
      docType === "RUC"
        ? (detail.clientRucOverride ?? "")
        : (detail.clientIdentityDocumentOverride ?? "");
    setClientFields({
      selection: clientProfile
        ? {
            type: "client",
            client: {
              id: clientProfile.id,
              fullName: clientProfile.fullName,
              phone: clientProfile.phone,
              email: clientProfile.email,
              ruc: clientProfile.ruc,
              identityDocumentNumber: clientProfile.identityDocumentNumber,
              identityDocumentType: clientProfile.identityDocumentType,
              taxpayerType: clientProfile.taxpayerType,
            },
          }
        : detail.clientId == null
          ? { type: "occasional" }
          : null,
      email: detail.recipientEmail ?? detail.clientEmail ?? "",
      displayName: detail.clientDisplayName ?? "",
      identityDocumentType: docType,
      identityDocumentNumber: docNumber,
      taxpayerType: detail.clientTaxpayerTypeOverride ?? "PERSONA_FISICA",
    });

    setLines(
      detail.lines.length > 0
        ? detail.lines.map((l) => ({
            serviceId: l.serviceId != null ? String(l.serviceId) : "",
            description: l.description,
            quantity: String(l.quantity),
            unitPrice: maskMoneyInput(String(Math.round(Number(l.unitPrice)))),
            pickedService:
              l.serviceId != null
                ? {
                    id: l.serviceId,
                    categoryId: 0,
                    categoryName: "",
                    categoryAccentKey: "",
                    name: l.description,
                    priceMinor: String(Math.round(Number(l.unitPrice))),
                    durationMinutes: 0,
                    active: true,
                  }
                : null,
            discountEnabled: !!l.discountType && l.discountType !== "NONE",
            discountType: l.discountType === "FIXED" ? "FIXED" : "PERCENT",
            discountValue:
              l.discountType === "FIXED"
                ? maskMoneyInput(String(Math.round(Number(l.discountValue ?? 0))))
                : (l.discountValue ?? ""),
          }))
        : [emptyInvoiceLine()],
    );

    setPayments(
      detail.payments.length > 0
        ? detail.payments.map((p) => ({
            method: p.method,
            amount: maskMoneyInput(String(Math.round(Number(p.amount)))),
            cardBrand: p.cardBrand ?? "",
            cardBrandOtherDescription: p.cardBrandOtherDescription ?? "",
          }))
        : [emptyInvoicePayment()],
    );

    setDiscountType(detail.discountType && detail.discountType !== "NONE" ? detail.discountType : "NONE");
    setDiscountValue(
      detail.discountType === "FIXED"
        ? maskMoneyInput(String(Math.round(Number(detail.discountValue ?? 0))))
        : (detail.discountValue ?? ""),
    );
  }

  const taxExemptReceiver = clientFields.identityDocumentType === "TARJETA_DIPLOMATICA";
  const totals = useMemo(
    () => computeInvoiceTotals(lines, discountType, discountValue, taxExemptReceiver),
    [lines, discountType, discountValue, taxExemptReceiver],
  );

  // Issue #174 AC-02: keep the first payment amount aligned with the Total.
  const otherPaymentsTotal = payments
    .slice(1)
    .reduce((acc, p) => acc + parseMaskedMoney(p.amount), 0);
  useEffect(() => {
    if (totals.total <= 0) return;
    setPayments((prev) => {
      if (prev.length === 0) return prev;
      const others = prev.slice(1).reduce((acc, p) => acc + parseMaskedMoney(p.amount), 0);
      const fill = Math.max(0, totals.total - others);
      const nextAmount = fill > 0 ? maskMoneyInput(fill.toFixed(0)) : "";
      if (prev[0].amount === nextAmount) return prev;
      return prev.map((p, i) => (i === 0 ? { ...p, amount: nextAmount } : p));
    });
  }, [totals.total, otherPaymentsTotal]);

  function validate(): boolean {
    const newLineErrors: Record<number, Record<string, string>> = {};
    const newPaymentErrors: Record<number, string> = {};
    const errors: string[] = [];

    lines.forEach((l, i) => {
      const fieldErrs: Record<string, string> = {};
      if (!l.serviceId.trim()) {
        fieldErrs.service = t("femme.billing.invoice.lineServiceRequired");
      }
      const price = parseMaskedMoney(l.unitPrice);
      if (!Number.isFinite(price) || price < 0 || l.unitPrice.trim() === "") {
        fieldErrs.unitPrice = t("femme.billing.invoice.lineUnitPriceInvalid");
      }
      if (l.discountEnabled && l.discountValue.trim() !== "") {
        const dv =
          l.discountType === "FIXED"
            ? parseMaskedMoney(l.discountValue)
            : parseFloat(l.discountValue.replace(",", ".")) || 0;
        if (l.discountType === "PERCENT" && dv > 100) {
          fieldErrs.discountValue = t("femme.billing.invoice.discountPercentTooHigh");
        }
      }
      if (Object.keys(fieldErrs).length > 0) newLineErrors[i] = fieldErrs;
    });

    payments.forEach((p, i) => {
      const amount = parseMaskedMoney(p.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        newPaymentErrors[i] = t("femme.billing.invoice.paymentAmountInvalid");
        return;
      }
      if (CARD_PAYMENT_METHODS.has(p.method) && !p.cardBrand.trim()) {
        newPaymentErrors[i] = t("femme.billing.invoice.cardBrandRequired");
      } else if (
        CARD_PAYMENT_METHODS.has(p.method) &&
        p.cardBrand === "OTHER" &&
        !p.cardBrandOtherDescription.trim()
      ) {
        newPaymentErrors[i] = t("femme.billing.invoice.cardBrandOtherDescriptionRequired");
      }
    });

    const assigned = payments.reduce((acc, p) => acc + parseMaskedMoney(p.amount), 0);
    if (Math.abs(assigned - totals.total) > 0.01) {
      errors.push(t("femme.apiErrors.PAYMENT_SUM_MISMATCH"));
    }

    const isRuc = clientFields.identityDocumentType === "RUC";
    const isInnominado = clientFields.identityDocumentType === "INNOMINADO";
    const numberTrim = isInnominado ? "" : clientFields.identityDocumentNumber.trim();
    if (isRuc && numberTrim && !validateRuc(numberTrim)) {
      errors.push(t("femme.clients.rucInvalid"));
    }
    if (isRuc && numberTrim && !clientFields.displayName.trim()) {
      errors.push(t("femme.billing.invoice.clientDisplayNameRequiredWithRuc"));
    }
    if (totals.total >= SIFEN_CLIENT_IDENTIFICATION_THRESHOLD && (isInnominado || !numberTrim)) {
      errors.push(t("femme.billing.invoice.clientIdentificationRequiredThreshold"));
    }
    if (taxExemptReceiver && !numberTrim) {
      errors.push(t("femme.billing.invoice.diplomaticCardNumberRequired"));
    }

    let newEmailError: string | null = null;
    const emailTrim = clientFields.email.trim();
    if (!isInnominado && !emailTrim) {
      newEmailError = t("femme.billing.invoice.clientEmailRequired");
    } else if (emailTrim && !isValidEmail(emailTrim)) {
      newEmailError = t("femme.clients.emailInvalid");
    }

    setLineErrors(newLineErrors);
    setPaymentErrors(newPaymentErrors);
    setGlobalErrors(errors);
    setClientEmailError(newEmailError);
    return (
      Object.keys(newLineErrors).length === 0 &&
      Object.keys(newPaymentErrors).length === 0 &&
      errors.length === 0 &&
      newEmailError === null
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    const isInnominado = clientFields.identityDocumentType === "INNOMINADO";
    const isRuc = clientFields.identityDocumentType === "RUC";
    const numberTrim = isInnominado ? "" : clientFields.identityDocumentNumber.trim();

    const payload = {
      clientId:
        clientFields.selection?.type === "client" ? clientFields.selection.client.id : null,
      clientDisplayName: clientFields.displayName.trim() || null,
      clientRucOverride: isRuc ? numberTrim || null : null,
      clientIdentityDocumentOverride: !isRuc && !isInnominado ? numberTrim || null : null,
      clientIdentityDocumentTypeOverride: numberTrim ? clientFields.identityDocumentType : null,
      clientTaxpayerTypeOverride: isRuc && numberTrim ? clientFields.taxpayerType : null,
      email: clientFields.email.trim() || null,
      discountType: discountType !== "NONE" ? discountType : null,
      discountValue:
        discountType !== "NONE" && discountValue
          ? discountType === "FIXED"
            ? parseMaskedMoney(discountValue)
            : parseFloat(discountValue)
          : null,
      lines: lines.map((l) => ({
        serviceId: l.serviceId ? parseInt(l.serviceId, 10) : null,
        description: (l.pickedService?.name ?? l.description).trim(),
        quantity: parseInt(l.quantity, 10) || 1,
        unitPrice: parseMaskedMoney(l.unitPrice),
        discountType: l.discountEnabled && l.discountValue ? l.discountType : null,
        discountValue:
          l.discountEnabled && l.discountValue
            ? l.discountType === "FIXED"
              ? parseMaskedMoney(l.discountValue)
              : parseFloat(l.discountValue.replace(",", "."))
            : null,
      })),
      payments: payments.map((p) => ({
        method: p.method,
        amount: parseMaskedMoney(p.amount),
        cardBrand: CARD_PAYMENT_METHODS.has(p.method) ? p.cardBrand : null,
        cardBrandOtherDescription:
          CARD_PAYMENT_METHODS.has(p.method) && p.cardBrand === "OTHER"
            ? p.cardBrandOtherDescription
            : null,
      })),
    };

    setSubmitting(true);
    try {
      await femmePostJson(`/api/invoices/${invoiceId}/sifen/correct-and-resend`, payload);
      onResent();
    } catch (err) {
      setSubmitError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setSubmitting(false);
    }
  }

  // Issue #190: past SIFEN's 72h transmission window a resend is transmitted extemporaneously and
  // very likely rejected — warn, but never block (the user can still try, or void the number).
  const windowExpired =
    correctResendDeadlineAt != null &&
    Date.now() > new Date(correctResendDeadlineAt).getTime();

  return (
    <Modal
      open
      onClose={onClose}
      title={
        invoiceNumberFormatted
          ? t("femme.billing.history.detail.sifen.correctResendTitleWithNumber", {
              number: invoiceNumberFormatted,
            })
          : t("femme.billing.history.detail.sifen.correctResendTitle")
      }
      className="max-w-4xl"
    >
      <div className="flex flex-col gap-4">
        <Text variant="muted" className="text-sm">
          {t("femme.billing.history.detail.sifen.correctResendExplanation")}
        </Text>
        <Text variant="muted" className="text-sm" data-testid="sifen-correct-resend-window-hint">
          {t("femme.billing.history.detail.sifen.correctResendWindowHint")}
        </Text>

        {loading && (
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <Text>{t("femme.billing.history.detail.loading")}</Text>
          </div>
        )}
        {loadError && (
          <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
            {loadError}
          </Alert>
        )}

        {!loading && !loadError && (
          <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-6">
            {globalErrors.map((err, i) => (
              <Alert key={i} variant="destructive" title={t("femme.billing.errorTitle")}>
                {err}
              </Alert>
            ))}
            {submitError && (
              <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
                {submitError}
              </Alert>
            )}

            {windowExpired && (
              <Alert
                variant="warning"
                title={t("femme.billing.history.detail.sifen.correctResendWindowExpiredTitle")}
                data-testid="sifen-correct-resend-window-expired"
              >
                {t("femme.billing.history.detail.sifen.correctResendWindowExpiredWarning", {
                  date: issuedAt ? formatParaguayDateTime(issuedAt, dateLocale) : "",
                })}
              </Alert>
            )}

            {/* Issue #190: emission date, read-only, above the client section. */}
            {issuedAt && (
              <div className="text-sm" data-testid="sifen-correct-resend-emission-date">
                <span className="font-medium">
                  {t("femme.billing.history.detail.sifen.correctResendEmissionDateLabel")}:{" "}
                </span>
                {formatParaguayDateTime(issuedAt, dateLocale)}
              </div>
            )}

            <Card className="p-4 flex flex-col gap-4">
              <InvoiceClientFields
                value={clientFields}
                onChange={(v) => {
                  setClientFields(v);
                  setClientEmailError(null);
                }}
                emailError={clientEmailError}
              />
            </Card>

            <Card className="p-4">
              <InvoiceLinesEditor
                lines={lines}
                onChange={setLines}
                errors={lineErrors}
                taxExemptReceiver={taxExemptReceiver}
              />
            </Card>

            <Card className="p-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm sm:max-w-xs">
                <span className="font-medium">{t("femme.billing.invoice.discountType")}</span>
                <select
                  id="correction-discount-type"
                  value={discountType}
                  onChange={(e) => {
                    setDiscountType(e.target.value);
                    setDiscountValue("");
                  }}
                  className="rounded border border-[rgb(var(--color-border))] bg-[rgb(var(--color-white))] px-2 py-2"
                >
                  <option value="NONE">{t("femme.billing.invoice.discountTypeNone")}</option>
                  <option value="FIXED">{t("femme.billing.invoice.discountTypeFixed")}</option>
                  <option value="PERCENT">{t("femme.billing.invoice.discountTypePercent")}</option>
                </select>
              </label>
              {discountType !== "NONE" && (
                <label className="flex flex-col gap-1 text-sm sm:max-w-xs">
                  <span className="font-medium">{t("femme.billing.invoice.discountValue")}</span>
                  <input
                    id="correction-discount-value"
                    inputMode={discountType === "FIXED" ? "numeric" : "decimal"}
                    value={discountValue}
                    onChange={(e) =>
                      setDiscountValue(
                        discountType === "FIXED" ? maskMoneyInput(e.target.value) : e.target.value,
                      )
                    }
                    placeholder="0"
                    className="rounded border border-[rgb(var(--color-border))] bg-[rgb(var(--color-white))] px-2 py-2"
                  />
                </label>
              )}
            </Card>

            <Card className="p-4">
              <InvoicePaymentsEditor
                payments={payments}
                onChange={setPayments}
                errors={paymentErrors}
                subtotal={totals.subtotal}
                discountAmount={totals.discountAmount}
                total={totals.total}
              />
            </Card>

            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={submitting}
                data-testid="sifen-correct-resend-confirm-button"
              >
                {submitting
                  ? t("femme.billing.history.detail.sifen.correctResendSubmitting")
                  : t("femme.billing.history.detail.sifen.correctResendSubmit")}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                {t("femme.billing.history.detail.close")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
