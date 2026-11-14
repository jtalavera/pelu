import { TodayEmptyState } from "../components/TodayEmptyState";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Alert, Button, Card, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { AppointmentFichaAction } from "../components/AppointmentFichaAction";
import { SectionTitle } from "../components/SectionTitle";
import { ServiceRecordDetailModal } from "../components/ServiceRecordDetailModal";
import { listAppointments, type Appointment } from "../api/appointments";
import { AppointmentDetailModal } from "../components/AppointmentDetailModal";
import { AppointmentFormModal } from "../components/AppointmentFormModal";
import { InvoiceDetailModal } from "../components/InvoiceDetailModal";
import { TodayServiceRecords } from "../components/TodayServiceRecords";
import { NewServiceRecordModal } from "../components/NewServiceRecordModal";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useMe } from "../hooks/useMe";
import { ListSearchField } from "../components/ListSearchField";
import { getDateLocale } from "../i18n/dateLocale";
import { formatGuaraniesGs } from "../lib/formatMoney";
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

const APPT_STATUS_TEXT: Record<string, string> = {
  PENDING: "text-warning",
  CONFIRMED: "text-success",
  IN_PROGRESS: "text-primary",
  COMPLETED: "text-primary",
};

// ─── Shared card style ────────────────────────────────────────────────────────
// `cardStyle` itself now lives in `components/charts/chartTheme.ts` (single source of truth,
// also used by `ChartCard` — see issue #219 code review) — imported below, not redefined here.

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { me, loading: meLoading } = useMe();
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR");
  const tourRole =
    !guidedTourEnabled
      ? undefined
      : me?.role === "PROFESSIONAL"
        ? "PROFESSIONAL"
        : "ADMIN";

  const [data, setData]               = useState<DashboardResponse | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [todayAppts, setTodayAppts]   = useState<Appointment[]>([]);
  const [openRecordId, setOpenRecordId] = useState<number | null>(null);
  const [newApptOpen, setNewApptOpen] = useState(false);
  const [detailAppt, setDetailAppt] = useState<Appointment | null>(null);
  const [viewInvoiceId, setViewInvoiceId] = useState<number | null>(null);
  const [fichasKey, setFichasKey] = useState(0);
  const [newRecordOpen, setNewRecordOpen] = useState(false);
  const [now, setNow]                 = useState(() => new Date());
  const [apptListQuery, setApptListQuery] = useState("");
  const [chargedOpen, setChargedOpen] = useState(false);
  // First-load gates. Every block of the page (summary, agenda, fichas, birthdays, the user's name)
  // is fetched on its own and in parallel; the page is shown once, when all of them have answered,
  // instead of the blocks popping in one after the other ("0 turnos hoy" first, the agenda later).
  const [apptsLoaded, setApptsLoaded] = useState(false);
  const [fichasLoaded, setFichasLoaded] = useState(false);
  const failed = !loading && (error !== null || data === null);
  const ready = !failed && !loading && !meLoading && apptsLoaded && fichasLoaded;
  // The guided tour points at elements of the page: start it only once they are on screen.
  useTour("dashboard", dashboardSteps, tourRole, guidedTourEnabled && ready);

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
  const refreshAppointments = useCallback(() => {
    listAppointments(todayRangeIso.from, todayRangeIso.to)
      .then((list) => {
        setTodayAppts(list);
        setFichasKey((k) => k + 1);
      })
      .catch(() => setTodayAppts([]))
      .finally(() => setApptsLoaded(true));
  }, [todayRangeIso.from, todayRangeIso.to]);
  // Keep the open detail dialog in sync with the refreshed list (ficha created / assigned, polling).
  useEffect(() => {
    setDetailAppt((prev) => (prev ? (todayAppts.find((a) => a.id === prev.id) ?? prev) : prev));
  }, [todayAppts]);
  useEffect(() => {
    refreshAppointments();
    const id = window.setInterval(refreshAppointments, POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshAppointments]);

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

  // «Cobrado» = completed with an issued comprobante. Those wait folded; everything else (still to
  // attend, or completed but not charged yet) stays on view.
  const isChargedAppt = (a: Appointment) => a.status === "COMPLETED" && a.invoiceId != null;
  const pendingAppts = visibleTodayAppts.filter((a) => !isChargedAppt(a));
  const chargedAppts = visibleTodayAppts.filter(isChargedAppt);
  const searchingAppts = apptListQuery.trim() !== "";
  const chargedShown = chargedOpen || (searchingAppts && chargedAppts.length > 0);

  function renderApptRow(appt: Appointment, charged: boolean) {
    const goToApptDetail = () => setDetailAppt(appt);
    return (
      <li
        key={appt.id}
        data-testid="dashboard-appointment-row"
        className={`grid grid-cols-[44px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 border-t border-line px-1 py-3 first:border-t-0 sm:grid-cols-[52px_minmax(0,1fr)_auto] sm:gap-x-3 sm:px-3 ${charged ? "opacity-80" : ""}`}
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
          {appt.status === "COMPLETED" ? (
            <span
              data-testid={charged ? "dashboard-appointment-charged-tag" : "dashboard-appointment-uncharged-tag"}
              className={`ml-1.5 whitespace-nowrap rounded-full px-2 py-px text-[11px] font-extrabold ${
                charged ? "bg-success-lt text-success" : "bg-warning-lt text-warning"
              }`}
            >
              {charged
                ? `✓ ${t("femme.calendar.badge.charged")}`
                : `✓ ${t("femme.calendar.badge.completed")} · ${t("femme.dashboard.home.unchargedTag")}`}
            </span>
          ) : null}
        </button>
        <div className="col-start-2 row-start-2 min-w-0 self-start break-words text-sm text-ink-3">
          <span className={`font-semibold ${APPT_STATUS_TEXT[appt.status] ?? "text-ink-3"}`}>
            {t(`femme.status.${appt.status}`, { defaultValue: appt.status })}
          </span>{" "}
          · {appt.serviceName} · {appt.professionalName}
        </div>
        <div className="col-start-2 row-start-3 mt-2 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:mt-0">
          {!appt.serviceRecordId && appt.invoiceId != null ? (
            // Charged with no ficha (e.g. occasional client): the comprobante is the only link.
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11 w-full whitespace-nowrap px-3"
              data-testid="dashboard-appointment-invoice"
              onClick={() => setViewInvoiceId(appt.invoiceId ?? null)}
            >
              {t("femme.calendar.action.viewInvoice")}
            </Button>
          ) : null}
          <AppointmentFichaAction
            appt={appt}
            testIdPrefix="dashboard-appointment-ficha"
            className="w-full whitespace-nowrap px-3"
            onOpenRecord={setOpenRecordId}
            onChanged={refreshAppointments}
          />
        </div>
      </li>
    );
  }

  // The blocks below are always mounted (hidden until `ready`) so that all of their requests start
  // together; until the summary arrives they read neutral defaults that are never seen.
  const a = data?.appointmentsToday ?? { total: 0, pending: 0, confirmed: 0, inProgress: 0, completed: 0 };

  return (
    <>
    {failed ? (
      <Alert variant="destructive" title={t("femme.dashboard.error")}>
        {error}
      </Alert>
    ) : null}
    {!ready && !failed ? (
      <div
        data-testid="dashboard-loading"
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
    ) : null}
    <div hidden={!ready}>
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* ── 1. PAGE HEADER ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-heading text-2xl font-extrabold text-ink" data-testid="dashboard-title">
          {t("femme.dashboard.title")}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button
            data-tour="dashboard-new-appointment"
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() => setNewApptOpen(true)}
          >
            {t("femme.dashboard.newAppointment")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            data-testid="dashboard-new-service-record"
            onClick={() => setNewRecordOpen(true)}
          >
            {t("femme.dashboard.newServiceRecord")}
          </Button>
        </div>
      </div>

      {/* ── 3. ONE-LINE SUMMARY ── (only once the numbers are there: never a placeholder «0») */}
      {data ? (
      <div data-tour="dashboard-metrics" data-testid="dashboard-summary" className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="font-heading text-xl font-extrabold tabular-nums text-ink" data-testid="dashboard-summary-appointments">
          {t("femme.dashboard.home.summaryAppointments", { count: a.total })}
        </span>
        <span aria-hidden className="text-line">|</span>
        <span className="font-heading text-xl font-extrabold tabular-nums text-ink" data-testid="dashboard-summary-collected">
          {t("femme.dashboard.home.summaryCollected", { amount: formatGuaraniesGs(data?.revenueDay.collected ?? 0) })}
        </span>
      </div>
      ) : null}

      {/* ── 4. TODAY'S APPOINTMENTS ── */}
      <section data-tour="dashboard-appt-list" className="flex flex-col gap-2.5">
      <SectionTitle
        title={t("femme.dashboard.todayAppointments")}
        badge={pendingAppts.length > 0 ? pendingAppts.length : undefined}
        badgeTestId="dashboard-appointments-count"
        action={
          <Link
            data-tour="dashboard-view-agenda"
            to="/app/calendar"
            className="inline-flex min-h-11 items-center text-sm font-bold text-primary"
          >
            {t("femme.dashboard.viewAgenda")}
          </Link>
        }
      />
      <Card className="p-0">
        {todayAppts.length > 0 && <div className="h-3" aria-hidden="true" />}
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
          <TodayEmptyState
            message={t("femme.dashboard.noAppts")}
            actionLabel={t("femme.dashboard.newAppointment")}
            onAction={() => setNewApptOpen(true)}
            testId="dashboard-appointments-empty"
            actionTestId="dashboard-appointments-create-first"
          />
        ) : visibleTodayAppts.length === 0 ? (
          <div className="px-5 pb-5 pt-2 text-sm text-ink-3">{t("femme.listFilter.noMatches")}</div>
        ) : (
          <div className="px-2 pb-2 sm:px-3">
            {pendingAppts.length > 0 ? (
              <>
                <div
                  data-testid="dashboard-appointments-group"
                  className="px-1 pb-1 pt-1 text-[11.5px] font-extrabold uppercase tracking-wider text-ink-3 sm:px-3"
                >
                  {t("femme.dashboard.home.pendingGroup")}
                </div>
                <ul className="flex flex-col" data-testid="dashboard-appointments">
                  {pendingAppts.map((appt) => renderApptRow(appt, false))}
                </ul>
              </>
            ) : searchingAppts ? null : (
              <p className="px-1 py-2 text-sm text-ink-3 sm:px-3" data-testid="dashboard-appointments-all-done">
                {t("femme.dashboard.home.allAttended")}
              </p>
            )}

            {chargedAppts.length > 0 ? (
              <div className="border-t border-line" data-testid="dashboard-appointments-charged">
                <button
                  type="button"
                  data-testid="dashboard-appointments-charged-toggle"
                  aria-expanded={chargedShown}
                  onClick={() => setChargedOpen((v) => !v)}
                  className="flex min-h-12 w-full items-center gap-2.5 px-1 text-left text-sm font-bold text-ink sm:px-3"
                >
                  <span>{t("femme.dashboard.home.chargedTitle")}</span>
                  <span
                    data-testid="dashboard-appointments-charged-count"
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary-lt px-2 text-xs font-extrabold tabular-nums text-primary"
                  >
                    {chargedAppts.length}
                  </span>
                  <span className="text-xs font-semibold text-ink-3">
                    {t("femme.dashboard.home.chargedHint")}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`ml-auto text-ink-3 transition-transform ${chargedShown ? "rotate-180" : ""}`}
                  >
                    ⌄
                  </span>
                </button>
                {chargedShown ? (
                  <ul className="flex flex-col" data-testid="dashboard-appointments-charged-list">
                    {chargedAppts.map((appt) => renderApptRow(appt, true))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="mt-1 px-1 sm:px-3">
              <button
                type="button"
                data-testid="dashboard-appointments-add-row"
                onClick={() => setNewApptOpen(true)}
                className="flex min-h-11 w-full items-center gap-2 text-sm font-bold text-primary"
              >
                <span aria-hidden="true" className="text-lg leading-none">
                  +
                </span>
                {t("femme.dashboard.home.addAppointmentRow")}
              </button>
            </div>
          </div>
        )}
      </Card>
      </section>

      {/* ── 5. FICHAS DE HOY: eye-catching cards, the open ones first ── */}
      <TodayServiceRecords
        refreshKey={fichasKey}
        onNewRecord={() => setNewRecordOpen(true)}
        onLoaded={() => setFichasLoaded(true)}
      />
      <NewServiceRecordModal
        open={newRecordOpen}
        onClose={() => setNewRecordOpen(false)}
        onSaved={() => setFichasKey((k) => k + 1)}
      />
      <AppointmentDetailModal
        appointment={detailAppt}
        onClose={() => setDetailAppt(null)}
        onChanged={(updated) => {
          if (updated) setDetailAppt(updated);
          refreshAppointments();
        }}
      />
      <AppointmentFormModal
        open={newApptOpen}
        onClose={() => setNewApptOpen(false)}
        onSaved={() => refreshAppointments()}
      />
      {viewInvoiceId !== null ? (
        <InvoiceDetailModal
          invoiceId={viewInvoiceId}
          onClose={() => setViewInvoiceId(null)}
          onVoided={() => {
            setViewInvoiceId(null);
            refreshAppointments();
          }}
        />
      ) : null}
      {openRecordId !== null ? (
        <ServiceRecordDetailModal
          serviceRecordId={openRecordId}
          onClose={() => setOpenRecordId(null)}
          onChanged={() => {
            setFichasKey((k) => k + 1);
            refreshAppointments();
          }}
        />
      ) : null}

    </div>
    </div>
    </>
  );
}
