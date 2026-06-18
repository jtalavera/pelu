/**
 * Paraguay (es-PY): thousands separator is `.` (point); decimals use `,` when shown.
 * All Gs. / monetary display in the app uses this locale so formatting stays consistent
 * in every screen (independent of UI language).
 */
export const FEMME_MONEY_LOCALE = "es-PY";

const integerFormatter = new Intl.NumberFormat(FEMME_MONEY_LOCALE, {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** Integer amounts (e.g. guaraníes without centavos in labels). */
export function formatIntegerGs(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return integerFormatter.format(Math.round(n));
}

/**
 * Money amounts, integer-only (no decimals, rounded to nearest whole Gs.).
 * Named "Decimal" for historical reasons; decimals are intentionally suppressed.
 */
export function formatDecimalGs(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return integerFormatter.format(Math.round(n));
}

/**
 * Parses API/form string or number and returns integer Gs. formatting, or "—" / raw fallback.
 * Use for all non-prefixed monetary values in forms and detail views.
 */
export function formatAmountDecimal(
  v: string | number | null | undefined,
  missing: string = "—",
): string {
  if (v === null || v === undefined) return missing;
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return formatDecimalGs(n);
}

/** Guaraníes with `Gs. ` prefix and integer grouping. */
export function formatGuaraniesGs(v: string | number | null | undefined): string {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return "Gs. —";
  }
  return `Gs. ${integerFormatter.format(Math.round(n))}`;
}
