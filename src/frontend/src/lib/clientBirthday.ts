/**
 * HU-69: client birthday helpers — same rules as the backend (`ClientBirthday.java`): day and month
 * together, optional year (not in the future, >= 1900), and 29/02 celebrated on 28/02 in common
 * years.
 */

export const BIRTHDAY_MIN_YEAR = 1900;

export type BirthdayParts = { day: number | null; month: number | null; year: number | null };

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(month: number, year: number | null): number {
  if (month === 2) return year == null || isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Parses the year text field: "" → null, anything non-numeric → NaN (invalid). */
export function parseBirthdayYear(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return /^\d{4}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export function isValidBirthday(b: BirthdayParts, today: Date = new Date()): boolean {
  const { day, month, year } = b;
  if (day == null && month == null) return year == null;
  if (day == null || month == null) return false;
  if (year != null) {
    if (Number.isNaN(year) || year < BIRTHDAY_MIN_YEAR || year > today.getFullYear()) return false;
  }
  if (day < 1 || day > daysInMonth(month, year)) return false;
  if (year != null) {
    const date = new Date(year, month - 1, day);
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (date > todayStart) return false;
  }
  return true;
}

/** True when `date` (local) is the day this birthday is celebrated. */
export function isBirthdayOn(day: number | null, month: number | null, date: Date): boolean {
  if (day == null || month == null) return false;
  const y = date.getFullYear();
  const celebratedDay = month === 2 && day === 29 && !isLeap(y) ? 28 : day;
  return date.getMonth() + 1 === month && date.getDate() === celebratedDay;
}

/** Current age, or null without year. */
export function ageOn(b: BirthdayParts, today: Date = new Date()): number | null {
  if (b.year == null || b.day == null || b.month == null) return null;
  let age = today.getFullYear() - b.year;
  const hadBirthday =
    today.getMonth() + 1 > b.month ||
    (today.getMonth() + 1 === b.month && today.getDate() >= b.day) ||
    isBirthdayOn(b.day, b.month, today);
  if (!hadBirthday) age -= 1;
  return age;
}

/** "15 de agosto" / "August 15" (+ year when known) in the UI language. */
export function formatBirthday(b: BirthdayParts, locale: string): string {
  if (b.day == null || b.month == null) return "";
  const date = new Date(b.year ?? 2000, b.month - 1, b.day);
  const opts: Intl.DateTimeFormatOptions =
    b.year != null
      ? { day: "numeric", month: "long", year: "numeric" }
      : { day: "numeric", month: "long" };
  return new Intl.DateTimeFormat(locale, opts).format(date);
}

/** Month names for the select, in the UI language. */
export function monthNames(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { month: "long" });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2000, i, 1)));
}
