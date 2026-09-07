import { parseMaskedMoney } from "../../lib/moneyInputMask";
import type { SalonServiceOption } from "../ServiceSearchField";

/**
 * Issue #175: shared building blocks for the comprobante form and the new "Corregir y reenviar"
 * form. The line/payment/client editors live in this folder; `NewInvoiceTab` keeps its own copies
 * for now and can migrate to these incrementally.
 */

export type InvoiceLineForm = {
  serviceId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  pickedService: SalonServiceOption | null;
  discountEnabled: boolean;
  discountType: "FIXED" | "PERCENT";
  discountValue: string;
};

export type InvoicePaymentForm = {
  method: string;
  amount: string;
  cardBrand: string;
  cardBrandOtherDescription: string;
};

export const PAYMENT_METHODS = [
  "CASH",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "TRANSFER",
  "OTHER",
] as const;

export const CARD_PAYMENT_METHODS = new Set(["DEBIT_CARD", "CREDIT_CARD"]);

// SIFEN Manual Técnico V150, E7.1.1/gPagTarCD — mandatory card brand for card payments (issue #170).
export const CARD_BRANDS = [
  "VISA",
  "MASTERCARD",
  "AMEX",
  "MAESTRO",
  "PANAL",
  "CABAL",
  "OTHER",
] as const;

export const IDENTITY_DOCUMENT_TYPE_OPTIONS = [
  { value: "RUC", labelKey: "femme.clients.identityDocumentTypeRuc" },
  { value: "CEDULA_PARAGUAYA", labelKey: "femme.clients.identityDocumentTypeCedulaParaguaya" },
  { value: "PASAPORTE", labelKey: "femme.clients.identityDocumentTypePasaporte" },
  { value: "CEDULA_EXTRANJERA", labelKey: "femme.clients.identityDocumentTypeCedulaExtranjera" },
  { value: "CARNET_RESIDENCIA", labelKey: "femme.clients.identityDocumentTypeCarnetResidencia" },
  { value: "TARJETA_DIPLOMATICA", labelKey: "femme.clients.identityDocumentTypeTarjetaDiplomatica" },
  { value: "OTRO", labelKey: "femme.clients.identityDocumentTypeOtro" },
  { value: "INNOMINADO", labelKey: "femme.clients.identityDocumentTypeInnominado" },
] as const;

/** SIFEN HU-02 AC-05: Gs. 7.000.000+ requires identifying the client. */
export const SIFEN_CLIENT_IDENTIFICATION_THRESHOLD = 7_000_000;

/** SNAKE_CASE → PascalCase, e.g. `DEBIT_CARD` → `DebitCard` (for the `paymentMethod*` i18n keys). */
export function snakeToPascal(s: string): string {
  if (!s) return "";
  return s
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

export const emptyInvoiceLine = (): InvoiceLineForm => ({
  serviceId: "",
  description: "",
  quantity: "1",
  unitPrice: "",
  pickedService: null,
  discountEnabled: false,
  discountType: "PERCENT",
  discountValue: "",
});

export const emptyInvoicePayment = (method = "CASH"): InvoicePaymentForm => ({
  method,
  amount: "",
  cardBrand: "",
  cardBrandOtherDescription: "",
});

// ─── Money math — mirrors InvoiceService.issueInvoice / rebuildLines exactly ──────────────────

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Issue #174 AC-01: a diplomatic-exoneration receiver's items are net of the included 10% IVA. */
export function effectiveUnitPrice(unitPriceMasked: string, taxExemptReceiver: boolean): number {
  const raw = parseMaskedMoney(unitPriceMasked);
  return taxExemptReceiver ? Math.round(raw / 1.1) : raw;
}

export function lineGross(line: InvoiceLineForm, taxExemptReceiver: boolean): number {
  return (parseFloat(line.quantity) || 0) * effectiveUnitPrice(line.unitPrice, taxExemptReceiver);
}

export function lineDiscountAmount(line: InvoiceLineForm, taxExemptReceiver: boolean): number {
  if (!line.discountEnabled || !line.discountValue) return 0;
  const gross = lineGross(line, taxExemptReceiver);
  const dv =
    line.discountType === "FIXED"
      ? parseMaskedMoney(line.discountValue)
      : parseFloat(line.discountValue.replace(",", ".")) || 0;
  if (line.discountType === "PERCENT") return round2((gross * dv) / 100);
  return Math.min(round2(dv), gross);
}

export type InvoiceTotals = {
  subtotal: number;
  perItemDiscountTotal: number;
  netSubtotal: number;
  globalDiscount: number;
  discountAmount: number;
  total: number;
};

export function computeInvoiceTotals(
  lines: InvoiceLineForm[],
  globalDiscountType: string,
  globalDiscountValue: string,
  taxExemptReceiver: boolean,
): InvoiceTotals {
  const subtotal = lines.reduce((acc, l) => acc + lineGross(l, taxExemptReceiver), 0);
  const perItemDiscountTotal = lines.reduce(
    (acc, l) => acc + lineDiscountAmount(l, taxExemptReceiver),
    0,
  );
  const netSubtotal = Math.max(0, subtotal - perItemDiscountTotal);

  let globalDiscount = 0;
  if (globalDiscountType === "FIXED") {
    globalDiscount = Math.min(parseMaskedMoney(globalDiscountValue), netSubtotal);
  } else if (globalDiscountType === "PERCENT") {
    globalDiscount = round2((netSubtotal * (parseFloat(globalDiscountValue) || 0)) / 100);
  }
  const discountAmount = perItemDiscountTotal + globalDiscount;
  const total = Math.max(0, subtotal - discountAmount);
  return { subtotal, perItemDiscountTotal, netSubtotal, globalDiscount, discountAmount, total };
}
