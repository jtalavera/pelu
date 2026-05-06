/**
 * Mask helpers for Guaraní money inputs (es-PY thousands separator: `.`).
 *
 * The mask is integer-only because invoices in Femme are emitted in whole
 * guaraníes. The strategy is:
 *
 * 1. Strip every non-digit character from the user input.
 * 2. Convert that string of digits to a number.
 * 3. Re-format using `Intl.NumberFormat("es-PY")` so the thousands separator
 *    is always the same (`1.234.567`).
 *
 * This keeps the API contract simple: the canonical *value* sent to the
 * backend is an integer (or stringified integer); the masked text is purely
 * presentational.
 */

const FORMATTER = new Intl.NumberFormat("es-PY", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** Returns the digit-only portion of `raw` (or empty string). */
export function moneyDigitsOnly(raw: string): string {
  return (raw ?? "").replace(/\D+/g, "");
}

/**
 * Returns the masked textual representation of `raw` (always digits-only re-grouped
 * with `.`). Empty input returns empty string.
 */
export function maskMoneyInput(raw: string): string {
  const digits = moneyDigitsOnly(raw);
  if (!digits) return "";
  return FORMATTER.format(Number(digits));
}

/**
 * Parses a masked money string back to a finite, non-negative number. Empty
 * input returns 0; if there are no digits it also returns 0. The function
 * never throws — invalid characters are simply ignored.
 */
export function parseMaskedMoney(raw: string): number {
  const digits = moneyDigitsOnly(raw);
  if (!digits) return 0;
  return Number(digits);
}
