import type { SalonServiceOption } from "../../components/ServiceSearchField";

// ─── Types ────────────────────────────────────────────────────────────────────

export type InvoiceLineForm = {
  serviceId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  pickedService: SalonServiceOption | null;
  discountEnabled: boolean;
  discountType: "FIXED" | "PERCENT";
  discountValue: string;
  /** HU-COM-10: professional / seller of the line ("" = none). */
  professionalId: string;
  /** UI only: the line's own "More options" (professional, discount) is unfolded. */
  optionsOpen?: boolean;
};

export type PaymentForm = {
  method: string;
  amount: string;
  cardBrand: string;
  cardBrandOtherDescription: string;
};

export function todayRangeIso(): { from: string; to: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** SIFEN HU-02 AC-05: Gs. 7.000.000+ requires identifying the client (RUC or identity document). */
export const SIFEN_CLIENT_IDENTIFICATION_THRESHOLD = 7_000_000;

export const PAYMENT_METHODS = [
  "CASH",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "TRANSFER",
  "OTHER",
] as const;

export const CARD_PAYMENT_METHODS = new Set(["DEBIT_CARD", "CREDIT_CARD"]);

// SIFEN Manual Técnico V150, E7.1.1/gPagTarCD — mandatory card brand when paying with
// Tarjeta de crédito/débito (issue #170).
export const CARD_BRANDS = [
  "VISA",
  "MASTERCARD",
  "AMEX",
  "MAESTRO",
  "PANAL",
  "CABAL",
  "OTHER",
] as const;

export function capitalize(s: string): string {
  if (!s) return "";
  return s
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

export function paymentMethodsLabel(
  summary: string | null | undefined,
  t: (key: string) => string,
): string {
  if (!summary?.trim()) return "—";
  return summary
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((m) => t(`femme.billing.invoice.paymentMethod${capitalize(m)}`))
    .join(" + ");
}

/** Local calendar date as `YYYY-MM-DD`. */
export function localTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Issue #174 AC-04: SIFEN's technical limits for a DE's emission date — backdated up to 720h
 * (30 days), future-dated up to 120h (5 days) from "now". Compared at day granularity here; the
 * backend re-checks it to the hour.
 */
export function issueDateOutOfRange(ymd: string): boolean {
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return true;
  const [y, m, d] = parts;
  const picked = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const min = new Date(today);
  min.setDate(min.getDate() - 30);
  const max = new Date(today);
  max.setDate(max.getDate() + 5);
  return picked < min || picked > max;
}

/** Issue #174 AC-06: default filter is one month back through today (was six months). */
export function getDefaultInvoiceHistoryDateRange(): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const fmtYmd = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return { from: fmtYmd(oneMonthAgo), to: fmtYmd(today) };
}

export function isFromOlderThan6Months(fromYmd: string): boolean {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const fromDate = new Date(fy, fm - 1, fd);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  sixMonthsAgo.setHours(0, 0, 0, 0);
  return fromDate < sixMonthsAgo;
}

export function localDateYmdToIsoStart(ymd: string): string {
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 0, 0, 0, 0).toISOString();
}

export function localDateYmdToIsoEnd(ymd: string): string {
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 23, 59, 59, 999).toISOString();
}

/** null = valid; otherwise an i18n key suffix under femme.billing.history.rangeError* */
export function invoiceHistoryRangeErrorKey(from: string, to: string): string | null {
  if (!from.trim() || !to.trim()) {
    return "incomplete";
  }
  if (from > to) {
    return "invalidOrder";
  }
  if (isFromOlderThan6Months(from)) {
    return "tooOld";
  }
  return null;
}
