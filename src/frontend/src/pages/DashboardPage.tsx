import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Spinner, Text, Toast } from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { billingStateForAppointment } from "../lib/appointmentBilling";
import { listAppointments, type Appointment } from "../api/appointments";
import { listServiceRecordsPaged, type ServiceRecordListItem } from "../api/serviceRecords";
import { ServiceRecordDetailModal } from "../components/ServiceRecordDetailModal";
import { BirthdaysCard } from "../components/BirthdaysCard";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useMe } from "../hooks/useMe";
import { ListSearchField } from "../components/ListSearchField";
import { StatusBadge } from "../components/StatusBadge";
import { getDateLocale } from "../i18n/dateLocale";
import { formatGuaraniesGs, formatAmountDecimal } from "../lib/formatMoney";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";
import { filterByListQuery } from "../util/matchesListQuery";
import { useTour } from "../tour/useTour";
import { dashboardSteps } from "../tour/steps/dashboard";

// ─── Types ────────────────────────────────────────────────────────────────────

type DashboardResponse = {
  appointmentsToday: {
    total: number;
    pending: number;
    confirmed: number;
    inProgress: number;
    completed: number;
  };
  revenueDay: { invoiced: string | number; collected: string | number };
  revenueWeek: { invoiced: string | number; collected: string | number };
  /** Distinct registered clients with ≥1 completed-type appointment in the current calendar month (tenant TZ). */
  clientsThisMonth: number;
  fiscalAlerts: Array<{ severity: string; messageKey: string; message: string }>;
  /**
   * Issue #216 · "Panel de clientes inactivos" — active clients with at least one `COMPLETED`
   * appointment whose most recent one is `inactiveClientsThresholdDays`+ days old (clients who
   * never had a completed visit are excluded entirely — issue #216 follow-up), ordered by days of
   * inactivity descending, capped to the top N (see `DashboardService.INACTIVE_CLIENTS_LIMIT`) —
   * "Ver todas" links to the full paginated list.
   */
  inactiveClients: Array<{
    clientId: number;
    fullName: string;
    phone: string | null;
    daysSinceLastVisit: number;
    lastVisitAt: string;
  }>;
  /** `DashboardService.INACTIVE_CLIENT_THRESHOLD_DAYS` — returned so the frontend never hardcodes it. */
  inactiveClientsThresholdDays: number;
  /**
   * Issue #219 · "Dashboard: fundamentos de gráficos + tendencia de facturación" — daily invoiced
   * (`ISSUED`) revenue over the trailing `revenueTrendDays`-day window, oldest first, one point per
   * calendar day (business timezone) with no gaps (a day with no invoices is `0`, not omitted).
   */
  revenueTrend: Array<{ date: string; invoiced: string | number }>;
  /** `DashboardService.REVENUE_TREND_DAYS` — returned so the frontend never hardcodes it. */
  revenueTrendDays: number;
  /**
   * Issue #220 · "Dashboard: gráfico de servicios más vendidos" — top services by invoiced
   * (`ISSUED`) revenue over the same trailing `revenueTrendDays`-day window as `revenueTrend`,
   * ordered by revenue descending, capped server-side (see `DashboardService.TOP_SERVICES_LIMIT`).
   */
  topServices: Array<{ serviceName: string; revenue: string | number }>;
  /**
   * Issue #221 · "Dashboard: gráfico de mezcla de medios de pago" — invoiced (`ISSUED`) revenue by
   * `PaymentMethod` over the same trailing `revenueTrendDays`-day window as `revenueTrend`/
   * `topServices`, ordered by amount descending, including every payment method actually present
   * in the window (no fixed/hardcoded subset, capped server-side to nothing).
   */
  paymentMethodMix: Array<{ method: string; amount: string | number }>;
  /**
   * Issue #222 · "Dashboard: gráfico de turnos por día de semana" — appointment counts by day of
   * week (business timezone) over the same trailing `revenueTrendDays`-day window as the sibling
   * charts, counting only `PENDING`/`CONFIRMED`/`IN_PROGRESS`/`COMPLETED` appointments (excludes
   * `CANCELLED`/`NO_SHOW` — see `DashboardService.buildAppointmentsByDayOfWeek`). Always exactly 7
   * entries, Monday first, zero-filled for a day with no countable appointments.
   */
  appointmentsByDayOfWeek: Array<{ dayOfWeek: string; count: number | string }>;
  // `revenueTrend`/`revenueTrendDays`/`topServices`/`paymentMethodMix` are also part of this
  // `/api/dashboard` response, but only consumed by `DashboardsPage.tsx` now.
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const POLL_MS = 60_000;

type MoreKey = "records" | "occupancy" | "birthdays" | "inactive";

const APPT_STATUS_TEXT: Record<string, string> = {
  PENDING: "text-warning",
  CONFIRMED: "text-success",
  IN_PROGRESS: "text-primary",
  COMPLETED: "text-primary",
};

// ─── Shared card style ────────────────────────────────────────────────────────
// `cardStyle` itself now lives in `components/charts/chartTheme.ts` (single source of truth,
// also used by `ChartCard` — see issue #219 code review) — imported below, not redefined here.

const inactiveClientsThStyle: React.CSSProperties = {
  textAlign: "left",
  fontSize: 10,
  fontWeight: 500,
  color: "var(--color-ink-3)",
  padding: "0 8px 8px 0",
  borderBottom: "0.5px solid var(--color-stone)",
};

const inactiveClientsTdStyle: React.CSSProperties = {
  padding: "8px 8px 8px 0",
  color: "var(--color-ink)",
  whiteSpace: "nowrap",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { me } = useMe();
  const navigate = useNavigate();
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR");
  const tourRole =
    !guidedTourEnabled
      ? undefined
      : me?.role === "PROFESSIONAL"
        ? "PROFESSIONAL"
        : "ADMIN";
  useTour("dashboard", dashboardSteps, tourRole, guidedTourEnabled);

  const [data, setData]               = useState<DashboardResponse | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [todayAppts, setTodayAppts]   = useState<Appointment[]>([]);
  const [todayServiceRecords, setTodayServiceRecords] = useState<ServiceRecordListItem[]>([]);
  const [selectedServiceRecordId, setSelectedServiceRecordId] = useState<number | null>(null);
  const [recordNotice, setRecordNotice] = useState<"updated" | "voided" | null>(null);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [openMore, setOpenMore] = useState<MoreKey | null>(null);
  const [birthdaysCount, setBirthdaysCount] = useState<number | null>(0);
  const [chargingId, setChargingId] = useState<number | null>(null);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [now, setNow]                 = useState(() => new Date());
  const [apptListQuery, setApptListQuery] = useState("");

  const todayStr = useMemo(() => toLocalDateStr(now), [now]);

  /** Local calendar day bounds as ISO instants (API requires Instant.parse, not YYYY-MM-DD). */
  const todayRangeIso = useMemo(() => {
    const [y, m, d] = todayStr.split("-").map((x) => parseInt(x, 10));
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const end = new Date(y, m - 1, d, 23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }, [todayStr]);

  // ── Polling dashboard aggregates ──────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await femmeJson<DashboardResponse>("/api/dashboard", { json: false });
      setData(res);
      setError(null);
    } catch {
      setError(t("femme.dashboard.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // ── Clock tick (every minute) ─────────────────────────────────────────────
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);

  // ── Today's appointments (for list + occupancy) ───────────────────────────
  useEffect(() => {
    listAppointments(todayRangeIso.from, todayRangeIso.to)
      .then(setTodayAppts)
      .catch(() => setTodayAppts([]));
  }, [todayRangeIso.from, todayRangeIso.to]);

  // ── Today's fichas de servicio (any status), newest first ─────────────────
  const loadTodayServiceRecords = useCallback(() => {
    listServiceRecordsPaged({ from: todayRangeIso.from, to: todayRangeIso.to, size: 100 })
      .then((page) => setTodayServiceRecords(Array.isArray(page?.content) ? page.content : []))
      .catch(() => setTodayServiceRecords([]));
  }, [todayRangeIso.from, todayRangeIso.to]);

  useEffect(() => {
    loadTodayServiceRecords();
    const id = window.setInterval(loadTodayServiceRecords, POLL_MS);
    return () => window.clearInterval(id);
  }, [loadTodayServiceRecords]);

  // Grouped by status (Open, Closed, Voided), newest first within each group, shown in a grid
  // capped at 12 with a "Más" button that reveals more of the already-fetched records in place.
  const SERVICE_RECORD_STATUS_RANK: Record<string, number> = { OPEN: 0, CLOSED: 1, VOIDED: 2 };
  const DASHBOARD_SERVICE_RECORDS_CAP = 12;
  const [visibleServiceRecordCount, setVisibleServiceRecordCount] = useState(
    DASHBOARD_SERVICE_RECORDS_CAP,
  );
  useEffect(() => {
    setVisibleServiceRecordCount(DASHBOARD_SERVICE_RECORDS_CAP);
  }, [todayRangeIso.from]);
  const sortedTodayServiceRecords = useMemo(() => {
    return [...todayServiceRecords].sort((a, b) => {
      const rankDiff =
        (SERVICE_RECORD_STATUS_RANK[a.status] ?? 99) - (SERVICE_RECORD_STATUS_RANK[b.status] ?? 99);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [todayServiceRecords]);
  const visibleTodayServiceRecords = sortedTodayServiceRecords.slice(
    0,
    visibleServiceRecordCount,
  );
  const hasMoreTodayServiceRecords = sortedTodayServiceRecords.length > visibleServiceRecordCount;

  // ── Occupancy by professional ─────────────────────────────────────────────
  const occupancy = useMemo(() => {
    const map = new Map<number, { id: number; name: string; count: number }>();
    for (const a of todayAppts) {
      const e = map.get(a.professionalId);
      if (e) e.count++;
      else
        map.set(a.professionalId, {
          id: a.professionalId,
          name: a.professionalName,
          count: 1,
        });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [todayAppts]);

  const maxOccupancy = occupancy.length > 0 ? Math.max(...occupancy.map((o) => o.count)) : 1;

  const visibleTodayAppts = useMemo(
    () =>
      filterByListQuery(todayAppts, apptListQuery, (a) => [
        a.clientName ?? "",
        a.professionalName,
        a.serviceName,
        a.status,
      ]),
    [todayAppts, apptListQuery],
  );

  const locale = getDateLocale(i18n);

  /**
   * "Cobrar" on a turno: opens Facturación with the client and the booked service already loaded
   * (the same prefill channel the fichas use), so the only thing left is "¿Cómo paga?".
   */
  async function chargeAppointment(appt: Appointment) {
    setChargingId(appt.id);
    setChargeError(null);
    try {
      navigate("/app/billing", { state: await billingStateForAppointment(appt) });
    } catch {
      setChargeError(t("femme.dashboard.home.chargeError"));
    } finally {
      setChargingId(null);
    }
  }

  // ── Greeting ──────────────────────────────────────────────────────────────
  const hour = now.getHours();
  const greetingKey =
    hour < 12 ? "greetingMorning" : hour < 19 ? "greetingAfternoon" : "greetingEvening";
  const userName = me?.fullName?.trim() || (me?.email.split("@")[0] ?? "");

  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
  const timeLabel = now.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // ── Fiscal alert (first non-blocking, dismissable) ────────────────────────
  const fiscalAlert = !alertDismissed
    ? (data?.fiscalAlerts.find((a) => a.severity !== "blocking") ?? null)
    : null;

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) {
    return (
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
    );
  }

  if (error || !data) {
    return (
      <Alert variant="destructive" title={t("femme.dashboard.error")}>
        {error}
      </Alert>
    );
  }

  const a = data.appointmentsToday;
  const inactiveClients = Array.isArray(data.inactiveClients) ? data.inactiveClients : [];
  // Defensive fallback only for a stale frontend build talking to a newer/older backend
  // (see auto-reload-on-stale-build) — the real value always comes from the server response,
  // never hardcoded as the source of truth.
  const inactiveClientsThresholdDays = data.inactiveClientsThresholdDays ?? 60;

  const occupancyOpenKey = openMore;
  const moreSections: Array<{ key: MoreKey; label: string; count: number | null; body: React.ReactNode }> = [
    {
      key: "records",
      label: t("femme.dashboard.home.moreRecords"),
      count: todayServiceRecords.length,
      body: (
        <div>
          {todayServiceRecords.length === 0 ? (
            <div className="py-2 text-sm text-ink-3">{t("femme.serviceRecords.dashboard.empty")}</div>
          ) : (
            <div
              data-testid="dashboard-service-records-grid"
              className="grid grid-cols-1 gap-2 py-2 sm:grid-cols-2"
            >
              {visibleTodayServiceRecords.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  data-testid="dashboard-service-record-card"
                  onClick={() => setSelectedServiceRecordId(r.id)}
                  className="flex min-h-11 flex-col items-start gap-1 rounded-card border border-line bg-surface p-3 text-left"
                >
                  <span className="w-full truncate text-sm font-semibold text-ink">{r.clientFullName}</span>
                  <span className="text-xs text-ink-3">
                    {formatParaguayDateTime(r.createdAt, locale)} · {formatAmountDecimal(r.totalAmount)}
                  </span>
                  <StatusBadge status={r.status} />
                </button>
              ))}
              {hasMoreTodayServiceRecords && (
                <button
                  type="button"
                  data-testid="dashboard-service-records-more"
                  onClick={() => setVisibleServiceRecordCount((c) => c + DASHBOARD_SERVICE_RECORDS_CAP)}
                  className="min-h-11 rounded-card border border-line bg-surface p-3 text-sm font-semibold text-primary"
                >
                  {t("femme.serviceRecords.dashboard.showMore")}
                </button>
              )}
            </div>
          )}
          <Link
            to="/app/service-records"
            state={{ activeTab: "history" }}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary"
          >
            {t("femme.serviceRecords.dashboard.viewHistory")}
          </Link>
        </div>
      ),
    },
    {
      key: "occupancy",
      label: t("femme.dashboard.home.moreOccupancy"),
      count: null,
      body: (
        <div data-tour="dashboard-occupancy" className="flex flex-col py-1">
          {occupancy.length === 0 ? (
            <div className="py-2 text-sm text-ink-3">{t("femme.dashboard.noAppts")}</div>
          ) : (
            occupancy.map((prof) => (
              <div key={prof.id} className="flex min-h-11 items-center gap-3 border-t border-line first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{prof.name}</span>
                <span className="text-xs text-ink-3">
                  {prof.count} {t("femme.dashboard.occupancyUnit")}
                </span>
                <span className="h-2 w-24 shrink-0 rounded bg-line">
                  <span
                    className="block h-full rounded bg-primary"
                    style={{ width: `${(prof.count / maxOccupancy) * 100}%` }}
                  />
                </span>
              </div>
            ))
          )}
        </div>
      ),
    },
    {
      key: "birthdays",
      label: t("femme.dashboard.home.moreBirthdays"),
      count: birthdaysCount,
      body: null, // rendered below (always mounted so the count is known while collapsed)
    },
    {
      key: "inactive",
      label: t("femme.dashboard.home.moreInactive"),
      count: inactiveClients.length,
      body: (
        <div data-testid="dashboard-inactive-clients">
          <div className="pb-1 text-xs text-ink-3">
            {t("femme.dashboard.inactiveClientsSubtitle", { days: inactiveClientsThresholdDays })}
          </div>
          {inactiveClients.length === 0 ? (
            <div className="py-2 text-sm text-ink-3">{t("femme.dashboard.inactiveClientsEmpty")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={inactiveClientsThStyle}>{t("femme.dashboard.inactiveClientsColClient")}</th>
                    <th style={inactiveClientsThStyle}>{t("femme.dashboard.inactiveClientsColPhone")}</th>
                    <th style={inactiveClientsThStyle}>{t("femme.dashboard.inactiveClientsColInactivity")}</th>
                  </tr>
                </thead>
                <tbody>
                  {inactiveClients.map((c) => {
                    const goToClientDetail = () => navigate(`/app/clients/${c.clientId}`);
                    return (
                      <tr
                        key={c.clientId}
                        data-testid="dashboard-inactive-client-row"
                        role="button"
                        tabIndex={0}
                        onClick={goToClientDetail}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            goToClientDetail();
                          }
                        }}
                        style={{ cursor: "pointer", borderBottom: "0.5px solid var(--color-stone)" }}
                      >
                        <td style={inactiveClientsTdStyle}>{c.fullName}</td>
                        <td style={inactiveClientsTdStyle}>{c.phone ?? "—"}</td>
                        <td style={inactiveClientsTdStyle}>
                          {t("femme.dashboard.inactiveClientsDaysValue", { days: c.daysSinceLastVisit })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {inactiveClients.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              data-testid="dashboard-inactive-clients-view-all"
              onClick={() => navigate("/app/inactive-clients")}
            >
              {t("femme.dashboard.inactiveClientsViewAll")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* ── 1. PAGE HEADER ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div data-tour="dashboard-greeting">
          <h1 className="font-heading text-2xl font-extrabold text-ink">
            {t(`femme.dashboard.${greetingKey}`)}
            {userName ? `, ${userName}` : ""}
          </h1>
          <div className="text-sm text-ink-3">
            {dateLabel} · {timeLabel}
          </div>
        </div>
        <Button
          data-tour="dashboard-new-appointment"
          type="button"
          variant="primary"
          className="min-h-11"
          onClick={() => navigate("/app/calendar")}
        >
          {t("femme.dashboard.newAppointment")}
        </Button>
      </div>

      {/* ── 2. FISCAL ALERT (one line) ── */}
      {fiscalAlert && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-card bg-warning-lt py-1 pl-4 pr-1 text-sm font-semibold text-warning"
        >
          <span className="min-w-0 flex-1">
            {t(`femme.dashboard.alerts.${fiscalAlert.messageKey}`, { defaultValue: fiscalAlert.message })}
          </span>
          <button
            type="button"
            aria-label={t("femme.dashboard.fiscalAlertDismiss")}
            onClick={() => setAlertDismissed(true)}
            className="min-h-11 min-w-11 text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}

      {/* ── 3. ONE-LINE SUMMARY ── */}
      <div data-tour="dashboard-metrics" data-testid="dashboard-summary" className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="font-heading text-xl font-extrabold tabular-nums text-ink" data-testid="dashboard-summary-appointments">
          {t("femme.dashboard.home.summaryAppointments", { count: a.total })}
        </span>
        <span aria-hidden className="text-line">|</span>
        <span className="font-heading text-xl font-extrabold tabular-nums text-ink" data-testid="dashboard-summary-collected">
          {t("femme.dashboard.home.summaryCollected", { amount: formatGuaraniesGs(data.revenueDay.collected) })}
        </span>
      </div>

      {/* ── 4. TODAY'S APPOINTMENTS ── */}
      <Card data-tour="dashboard-appt-list" className="p-0">
        <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-4 sm:px-5">
          <h2 className="font-heading text-lg font-extrabold text-ink">{t("femme.dashboard.todayAppointments")}</h2>
          <Link
            data-tour="dashboard-view-agenda"
            to="/app/calendar"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary"
          >
            {t("femme.dashboard.viewAgenda")}
          </Link>
        </div>

        {todayAppts.length > 0 && (
          <div data-tour="dashboard-appt-filter" className="px-4 pb-2 sm:px-5">
            <ListSearchField
              id="dashboard-appt-filter"
              value={apptListQuery}
              onChange={setApptListQuery}
              label={t("femme.listFilter.label")}
              placeholder={t("femme.listFilter.placeholder")}
            />
          </div>
        )}

        {todayAppts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 pb-6 pt-4 text-center">
            <p className="text-ink-3">{t("femme.dashboard.noAppts")}</p>
            <Button type="button" variant="primary" onClick={() => navigate("/app/calendar")}>
              {t("femme.dashboard.newAppointment")}
            </Button>
          </div>
        ) : visibleTodayAppts.length === 0 ? (
          <div className="px-5 pb-5 pt-2 text-sm text-ink-3">{t("femme.listFilter.noMatches")}</div>
        ) : (
          <ul className="flex flex-col px-2 pb-2 sm:px-3" data-testid="dashboard-appointments">
            {visibleTodayAppts.map((appt) => {
              const goToApptDetail = () =>
                navigate("/app/calendar", {
                  state: { selectedDate: toLocalDateStr(new Date(appt.startAt)), openAppointmentId: appt.id },
                });
              const canCharge = appt.status !== "CANCELLED" && appt.status !== "NO_SHOW";
              return (
                <li
                  key={appt.id}
                  data-testid="dashboard-appointment-row"
                  className="grid grid-cols-[44px_minmax(0,1fr)_100px] items-center gap-x-2.5 gap-y-0.5 border-t border-line px-1 py-3 first:border-t-0 sm:grid-cols-[52px_minmax(0,1fr)_116px] sm:gap-x-3 sm:px-3"
                >
                  <span className="col-start-1 row-span-2 row-start-1 font-heading text-[17px] font-extrabold tabular-nums text-ink">
                    {fmtTime(appt.startAt, locale)}
                  </span>
                  <button
                    type="button"
                    aria-label={t("femme.dashboard.openAppointmentDetail", {
                      client: appt.clientName ?? t("femme.calendar.detail.occasionalClient"),
                    })}
                    onClick={goToApptDetail}
                    className="col-start-2 row-start-1 min-w-0 self-end break-words text-left font-semibold text-ink"
                  >
                    {appt.clientName ?? t("femme.calendar.detail.occasionalClient")}
                    {appt.status === "IN_PROGRESS" && (
                      <span className="ml-1.5 whitespace-nowrap text-[11px] font-extrabold uppercase tracking-wider text-primary">
                        · {t("femme.dashboard.home.nowTag")}
                      </span>
                    )}
                  </button>
                  <div className="col-start-2 row-start-2 min-w-0 self-start break-words text-sm text-ink-3">
                    <span className={`font-semibold ${APPT_STATUS_TEXT[appt.status] ?? "text-ink-3"}`}>
                      {t(`femme.status.${appt.status}`, { defaultValue: appt.status })}
                    </span>{" "}
                    · {appt.serviceName} · {appt.professionalName}
                  </div>
                  <div className="col-start-3 row-span-2 row-start-1">
                    {canCharge && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        className="min-h-11 w-full px-2"
                        data-testid="dashboard-appointment-charge"
                        disabled={chargingId === appt.id}
                        onClick={() => void chargeAppointment(appt)}
                      >
                        {t("femme.dashboard.home.charge")}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {chargeError && (
          <div role="alert" className="px-5 pb-4 text-sm text-danger">
            {chargeError}
          </div>
        )}
      </Card>

      {/* ── 5. MORE FOR TODAY (collapsed) ── */}
      <Card className="p-0" data-testid="dashboard-more">
        <h2 className="px-4 pb-1 pt-4 font-heading text-[15px] font-extrabold text-ink-2 sm:px-5">
          {t("femme.dashboard.home.moreTitle")}
        </h2>
        {moreSections.map((sec) => {
          const open = occupancyOpenKey === sec.key;
          return (
            <div key={sec.key} className="border-t border-line first:border-t-0">
              <button
                type="button"
                data-testid={`dashboard-more-${sec.key}`}
                aria-expanded={open}
                onClick={() => setOpenMore(open ? null : sec.key)}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left sm:px-5"
              >
                <span className="font-semibold text-ink">{sec.label}</span>
                <span className="flex items-center gap-2.5 text-ink-3">
                  {sec.count !== null && (
                    <span
                      className={`inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full px-2 text-[13px] font-extrabold ${
                        sec.count > 0 ? "bg-primary-lt text-primary" : "bg-line text-ink-3"
                      }`}
                    >
                      {sec.count}
                    </span>
                  )}
                  <span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>
                    ⌄
                  </span>
                </span>
              </button>
              {sec.key === "birthdays" ? (
                <div hidden={!open} className="px-4 pb-3 sm:px-5">
                  <BirthdaysCard embedded onLoaded={setBirthdaysCount} />
                </div>
              ) : (
                open && <div className="px-4 pb-3 sm:px-5">{sec.body}</div>
              )}
            </div>
          );
        })}
      </Card>

      {selectedServiceRecordId !== null && (
        <ServiceRecordDetailModal
          serviceRecordId={selectedServiceRecordId}
          onClose={() => setSelectedServiceRecordId(null)}
          onChanged={(kind) => {
            void loadTodayServiceRecords();
            setRecordNotice(kind);
          }}
        />
      )}
      <Toast
        open={recordNotice !== null}
        onOpenChange={(o) => {
          if (!o) setRecordNotice(null);
        }}
        variant="success"
        duration={4000}
        data-testid="dashboard-record-toast"
      >
        {recordNotice === "voided"
          ? t("femme.serviceRecords.voidedSuccess")
          : t("femme.serviceRecords.updatedSuccess")}
      </Toast>
    </div>
  );
}
