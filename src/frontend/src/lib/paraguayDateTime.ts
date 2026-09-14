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

/**
 * `Y/M/D` of `date` as observed in `timeZone`, not the browser's local timezone. Extracted from
 * `DashboardPage.tsx` (issue #223 code-review follow-up, then reused by `PropinasPage.tsx`'s
 * identical pre-existing bug) so both compute the same business-timezone calendar day boundary
 * instead of each relying on the browser-local `Date` getters (which shift the boundary by a day
 * for part of each day whenever the viewer's device timezone differs from `PARAGUAY_TIMEZONE`).
 */
export function zonedYmd(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day) };
}

/**
 * Converts wall-clock date/time components *as they would read in `timeZone`* to the UTC instant
 * they denote — the "guess and correct" technique (no timezone-conversion library in this
 * frontend): treat the components as if they were already UTC to get a first guess, see what
 * wall-clock time that guess actually renders as in `timeZone`, and correct by the difference
 * *against the fixed target* (not the a moving guess — see below) each pass. A second pass is
 * cheap insurance against a guess landing right on a DST transition (irrelevant for
 * `America/Asuncion` today — no DST since 2024, see module doc above — but this helper makes no
 * zone-specific assumption).
 */
export function zonedDateTimeToUtcMs(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  ms: number,
  timeZone: string,
): number {
  // The target wall-clock components, reinterpreted as if they were UTC — a fixed point of
  // comparison for every pass below. Comparing each pass's `observed` reading against this fixed
  // `targetAsUtc` (rather than against the mutating `guess`) is what makes the loop converge:
  // once `guess` renders the correct wall-clock in `timeZone`, `observed` exactly equals
  // `targetAsUtc`, `diff` is 0, and the loop stops instead of re-applying the (still nonzero)
  // zone offset a second time.
  const targetAsUtc = Date.UTC(y, m - 1, d, h, mi, s, ms);
  let guess = targetAsUtc;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(guess));
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    const observed = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      map.hour === "24" ? 0 : Number(map.hour),
      Number(map.minute),
      Number(map.second),
      ms,
    );
    const diff = targetAsUtc - observed;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}
