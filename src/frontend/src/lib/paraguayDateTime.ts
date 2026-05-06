/**
 * Helpers to display server timestamps converted to Paraguay local time
 * (`America/Asuncion`, GMT-3 with no DST since 2024 — the IANA DB still ships
 * America/Asuncion, which the platform uses authoritatively).
 *
 * The backend stores `issued_at` (and other timestamps) in UTC. The UI is
 * required to *display* invoice times in Paraguay local time so cashiers see
 * the wall-clock time when the invoice was emitted — see HU-14.
 */

const TIMEZONE = "America/Asuncion";

const DATE_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};

const TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

/**
 * Format a timestamp using the active locale, but always anchored to Paraguay
 * time. `iso` may be a Date, an ISO-8601 string or a number (epoch ms).
 */
export function formatParaguayDateTime(
  iso: string | number | Date,
  locale: string,
): string {
  const date = toDate(iso);
  if (!date) return String(iso);
  try {
    return new Intl.DateTimeFormat(locale, DATE_TIME_FORMAT_OPTIONS).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", DATE_TIME_FORMAT_OPTIONS).format(date);
  }
}

/** Date only, Paraguay zone. */
export function formatParaguayDate(
  iso: string | number | Date,
  locale: string,
): string {
  const date = toDate(iso);
  if (!date) return String(iso);
  try {
    return new Intl.DateTimeFormat(locale, DATE_FORMAT_OPTIONS).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", DATE_FORMAT_OPTIONS).format(date);
  }
}

/** Time only (24h), Paraguay zone. */
export function formatParaguayTime(
  iso: string | number | Date,
  locale: string,
): string {
  const date = toDate(iso);
  if (!date) return String(iso);
  try {
    return new Intl.DateTimeFormat(locale, TIME_FORMAT_OPTIONS).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", TIME_FORMAT_OPTIONS).format(date);
  }
}

function toDate(iso: string | number | Date): Date | null {
  if (iso instanceof Date) return Number.isFinite(iso.getTime()) ? iso : null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

export const PARAGUAY_TIMEZONE = TIMEZONE;
