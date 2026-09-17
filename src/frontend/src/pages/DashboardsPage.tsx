import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { getTipsReport, type TipReportProfessionalTotal } from "../api/propinas";
import { RevenueTrendChart } from "../components/charts/RevenueTrendChart";
import { TopServicesChart } from "../components/charts/TopServicesChart";
import { PaymentMethodMixChart } from "../components/charts/PaymentMethodMixChart";
import { AppointmentsByDayOfWeekChart } from "../components/charts/AppointmentsByDayOfWeekChart";
import { TipsByProfessionalChart } from "../components/charts/TipsByProfessionalChart";
import { getDateLocale } from "../i18n/dateLocale";
import { PARAGUAY_TIMEZONE } from "../lib/paraguayDateTime";

type DashboardsResponse = {
  revenueTrend: Array<{ date: string; invoiced: string | number }>;
  revenueTrendDays: number;
  topServices: Array<{ serviceName: string; revenue: string | number }>;
  paymentMethodMix: Array<{ method: string; amount: string | number }>;
  appointmentsByDayOfWeek: Array<{ dayOfWeek: string; count: number | string }>;
};

/**
 * Issue #222 code-review follow-up: `Y/M/D` of `date` as observed in `timeZone`, not the browser's
 * local timezone — used to compute the tips-by-professional window in the same *business* timezone
 * `DashboardService.revenueWindow` uses server-side, instead of a browser-local approximation
 * (which would shift the whole 30-day window by a day for part of each day whenever the viewer's
 * device timezone differs from `PARAGUAY_TIMEZONE`/`America/Asuncion`).
 */
function zonedYmd(date: Date, timeZone: string): { y: number; m: number; d: number } {
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
 * wall-clock time that guess actually renders as in `timeZone`, and correct by the difference. A
 * second pass is cheap insurance against a guess landing right on a DST transition (irrelevant for
 * `America/Asuncion` today — no DST since 2024, see `paraguayDateTime.ts` — but this helper makes
 * no zone-specific assumption).
 */
function zonedDateTimeToUtcMs(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  ms: number,
  timeZone: string,
): number {
  let guess = Date.UTC(y, m - 1, d, h, mi, s, ms);
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
    const diff = guess - observed;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

/**
 * Issue #220 follow-up — "Dashboards": dedicated screen for the dashboard's charts (revenue trend,
 * top services, payment method mix, appointments by day of week, tips by professional), split out
 * of `DashboardPage.tsx` so the main panel stays focused on today's operational snapshot. Reuses
 * the same `/api/dashboard` aggregate the main dashboard fetches — the chart data (`revenueTrend`/
 * `revenueTrendDays`/`topServices`/`paymentMethodMix`/`appointmentsByDayOfWeek`) already lives
 * there.
 *
 * Issue #223 — "Dashboard: gráfico de propinas por profesional" is the one exception: it adds no
 * new backend aggregation, so this page instead calls the already-existing
 * `GET /api/propinas/report` (`getTipsReport`) with a client-computed date range equivalent to the
 * same trailing window (`tipsWindowRangeIso` below), in the tenant's business timezone rather than
 * the browser's local one — see `zonedYmd`/`zonedDateTimeToUtcMs`.
 */
export default function DashboardsPage() {
  const { t, i18n } = useTranslation();
  const locale = getDateLocale(i18n);

  const [data, setData] = useState<DashboardsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tipsByProfessional, setTipsByProfessional] = useState<TipReportProfessionalTotal[]>([]);
  const [now] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    femmeJson<DashboardsResponse>("/api/dashboard", { json: false })
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError(t("femme.dashboard.error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  /**
   * Client-side equivalent of `DashboardService.revenueWindow` (business-timezone trailing window
   * ending today) — needed because `GET /api/propinas/report` takes an explicit `from`/`to`, unlike
   * the sibling charts' shared window (computed entirely server-side, opaque to the frontend).
   * `data?.revenueTrendDays` is read from the last `/api/dashboard` response (defaulting to the
   * server's current constant, 30, before that first response lands) so this window always matches
   * whatever the sibling charts are showing rather than a second hardcoded literal.
   */
  const tipsWindowRangeIso = useMemo(() => {
    const windowDays = data?.revenueTrendDays ?? 30;
    const today = zonedYmd(now, PARAGUAY_TIMEZONE);
    // Pure calendar-day arithmetic — `Date.UTC` normalizes a negative day-of-month correctly — no
    // zone conversion needed yet, this only walks back whole calendar days from "today in zone".
    const startCalendar = new Date(Date.UTC(today.y, today.m - 1, today.d - (windowDays - 1)));
    const startMs = zonedDateTimeToUtcMs(
      startCalendar.getUTCFullYear(),
      startCalendar.getUTCMonth() + 1,
      startCalendar.getUTCDate(),
      0,
      0,
      0,
      0,
      PARAGUAY_TIMEZONE,
    );
    const endMs = zonedDateTimeToUtcMs(today.y, today.m, today.d, 23, 59, 59, 999, PARAGUAY_TIMEZONE);
    return { from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString() };
  }, [now, data?.revenueTrendDays]);

  useEffect(() => {
    let cancelled = false;
    getTipsReport({ from: tipsWindowRangeIso.from, to: tipsWindowRangeIso.to })
      .then((r) => {
        if (!cancelled) {
          setTipsByProfessional(Array.isArray(r.professionalTotals) ? r.professionalTotals : []);
        }
      })
      .catch(() => {
        if (!cancelled) setTipsByProfessional([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tipsWindowRangeIso.from, tipsWindowRangeIso.to]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-ink)" }}>
          {t("femme.dashboardsPage.pageTitle")}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
          {t("femme.dashboardsPage.pageSubtitle")}
        </div>
      </div>

      {loading ? (
        <div
          style={{
            display: "flex",
            minHeight: "40vh",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          <Spinner size="lg" />
          <Text>{t("femme.dashboard.loading")}</Text>
        </div>
      ) : error || !data ? (
        <Alert variant="destructive" title={t("femme.dashboard.error")}>
          {error}
        </Alert>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <RevenueTrendChart
            data={Array.isArray(data.revenueTrend) ? data.revenueTrend : []}
            days={data.revenueTrendDays ?? 30}
            locale={locale}
          />

          <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <PaymentMethodMixChart
              data={Array.isArray(data.paymentMethodMix) ? data.paymentMethodMix : []}
              days={data.revenueTrendDays ?? 30}
            />
            <AppointmentsByDayOfWeekChart
              data={Array.isArray(data.appointmentsByDayOfWeek) ? data.appointmentsByDayOfWeek : []}
              days={data.revenueTrendDays ?? 30}
            />
          </div>

          <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <TopServicesChart
              data={Array.isArray(data.topServices) ? data.topServices : []}
              days={data.revenueTrendDays ?? 30}
            />
            <TipsByProfessionalChart data={tipsByProfessional} days={data.revenueTrendDays ?? 30} />
          </div>
        </div>
      )}
    </div>
  );
}
