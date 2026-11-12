import { femmeJson, femmePostJson } from "./femmeClient";

/**
 * One tip of an invoice. `ISSUANCE` tips were entered on the comprobante (collected with its
 * payments: no payment method of their own, not voidable from here); `LATE` tips were left after
 * the invoice was issued (own payment method, entered the open cash register, voidable by the
 * salon administrator while that register is open).
 */
export type InvoiceTipItem = {
  source: "ISSUANCE" | "LATE";
  id: number | null;
  professionalId: number;
  professionalName: string;
  amount: number | string;
  paymentMethod: string | null;
  cardBrand: string | null;
  cardBrandOtherDescription: string | null;
  createdAt: string | null;
  createdByName: string | null;
  voided: boolean;
  voidReason: string | null;
  voidedByName: string | null;
  cashSessionOpen: boolean;
};

export type InvoiceTips = {
  invoiceId: number;
  invoiceStatus: string;
  items: InvoiceTipItem[];
  /** Sum of the tips that are not voided. */
  total: number | string;
  /** The cash register new tips would enter, if one is open. */
  openCashSessionId: number | null;
  openCashSessionOpenedAt: string | null;
};

export type LateTipInput = {
  professionalId: number;
  amount: number;
  paymentMethod: string;
  cardBrand?: string | null;
  cardBrandOtherDescription?: string | null;
};

export function getInvoiceTips(invoiceId: number): Promise<InvoiceTips> {
  return femmeJson<InvoiceTips>(`/api/invoices/${invoiceId}/tips`);
}

/** Saves all the tips together (or none) in the cash register that is open right now. */
export function addInvoiceTips(invoiceId: number, tips: LateTipInput[]): Promise<InvoiceTips> {
  return femmePostJson<InvoiceTips>(`/api/invoices/${invoiceId}/tips`, { tips });
}

/** Salon administrator only; the reason is mandatory. Returns the invoice's tips, updated. */
export function voidLateTip(id: number, reason: string): Promise<InvoiceTips> {
  return femmePostJson<InvoiceTips>(`/api/propinas/late/${id}/void`, { reason });
}
