function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar date as `YYYY-MM-DD`. */
export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today (local) as `YYYY-MM-DD`. */
export function todayYmd(now: Date = new Date()): string {
  return toYmd(now);
}

/**
 * The same day one calendar month back (local), as `YYYY-MM-DD`: the default «Desde» of every
 * date-range search. Clamps to the last day of that month (31 de marzo → 28/29 de febrero).
 */
export function oneMonthAgoYmd(now: Date = new Date()): string {
  const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  return toYmd(
    new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), lastDayOfPrevMonth)),
  );
}

/** Default range of a search: one month back through today. */
export function defaultSearchRange(now: Date = new Date()): { from: string; to: string } {
  return { from: oneMonthAgoYmd(now), to: todayYmd(now) };
}

/** True when the `YYYY-MM-DD` date is older than one year before today (the ceiling of every search). */
export function isFromOlderThanOneYear(fromYmd: string, now: Date = new Date()): boolean {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const limit = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  return new Date(fy, fm - 1, fd) < limit;
}
