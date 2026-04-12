import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { listAppointments, type Appointment } from "../api/appointments";
import { useMe } from "../hooks/useMe";
import { ListSearchField } from "../components/ListSearchField";
import { StatusBadge } from "../components/StatusBadge";
import { getDateLocale } from "../i18n/dateLocale";
import { filterByListQuery } from "../util/matchesListQuery";

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
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Paraguayan guaraníes: thousands separator + currency prefix (product default). */
function fmtMoneyGs(v: string | number, numberLocale: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return "Gs. —";
  }
  return `Gs. ${Math.round(n).toLocaleString(numberLocale)}`;
}

function fmtCount(n: number, numberLocale: string): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 0 }).format(n);
}

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

const AVATAR_PALETTE = [
  { bg: "var(--color-rose-md)",  color: "var(--color-rose-dk)"  },
  { bg: "var(--color-mauve-md)", color: "var(--color-mauve-dk)" },
  { bg: "var(--color-stone-md)", color: "var(--color-ink-2)"    },
];

function hashStr(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return h;
}

function avatarColor(name: string) {
  return AVATAR_PALETTE[hashStr(name) % AVATAR_PALETTE.length];
}

function getInitials(name: string): string {
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

function buildCalGrid(year: number, month: number): { day: number; current: boolean }[] {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  const cells: { day: number; current: boolean }[] = [];
  const prevLast = new Date(year, month, 0).getDate();
  for (let i = first.getDay() - 1; i >= 0; i--) cells.push({ day: prevLast - i, current: false });
  for (let d = 1; d <= last.getDate(); d++) cells.push({ day: d, current: true });
  const rem = cells.length % 7;
  if (rem > 0) for (let d = 1; d <= 7 - rem; d++) cells.push({ day: d, current: false });
  return cells;
}

const POLL_MS = 60_000;

// ─── Shared card style ────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "var(--color-white)",
  borderRadius: "var(--radius-xl)",
  border: "var(--border-default)",
  padding: 16,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  iconBg,
  icon,
  value,
  label,
  delta,
  deltaPositive = false,
}: {
  iconBg: string;
  icon: React.ReactNode;
  value: string;
  label: string;
  delta?: string;
  deltaPositive?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--color-white)",
        borderRadius: "var(--radius-lg)",
        border: "var(--border-default)",
        padding: 14,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "var(--radius-md)",
          background: iconBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 10,
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 20, fontWeight: 500, color: "var(--color-ink)", lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 3 }}>{label}</div>
      {delta && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "2px 7px",
            borderRadius: "var(--radius-pill)",
            fontSize: 10,
            fontWeight: 500,
            marginTop: 6,
            background: deltaPositive ? "var(--color-success-lt)" : "var(--color-stone)",
            color: deltaPositive ? "var(--color-success)" : "var(--color-ink-3)",
          }}
        >
          {delta}
        </div>
      )}
    </div>
  );
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const MoneyIcon = ({ c }: { c: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const CalIcon = ({ c }: { c: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const TrendIcon = ({ c }: { c: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);

const UsersIcon = ({ c }: { c: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { me } = useMe();
  const navigate = useNavigate();

  const [data, setData]               = useState<DashboardResponse | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [todayAppts, setTodayAppts]   = useState<Appointment[]>([]);
  const [calMonth, setCalMonth]       = useState(() => new Date());
  const [alertDismissed, setAlertDismissed] = useState(false);
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

  // ── Calendar helpers ──────────────────────────────────────────────────────
  const calYear     = calMonth.getFullYear();
  const calMonthIdx = calMonth.getMonth();
  const calCells    = useMemo(() => buildCalGrid(calYear, calMonthIdx), [calYear, calMonthIdx]);
  const todayDay    = now.getDate();
  const todayMonth  = now.getMonth();
  const todayYear   = now.getFullYear();

  const locale = getDateLocale(i18n);
  const numberLocale = locale.startsWith("es") ? "es-PY" : "en-US";

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(calMonth);

  const DOW = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(
          new Date(2024, 0, 7 + i),
        ),
      ),
    [locale],
  );

  // ── Greeting ──────────────────────────────────────────────────────────────
  const hour = now.getHours();
  const greetingKey =
    hour < 12 ? "greetingMorning" : hour < 19 ? "greetingAfternoon" : "greetingEvening";
  const userName = me?.email.split("@")[0] ?? "";

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

  return (
    <div>
      {/* ── 1. PAGE HEADER ── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 500, color: "var(--color-ink)" }}>
            {t(`femme.dashboard.${greetingKey}`)}
            {userName ? `, ${userName}` : ""}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
            {dateLabel} · {timeLabel}
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate("/app/calendar")}
          style={{
            background: "var(--color-rose)",
            color: "var(--color-on-primary)",
            border: "none",
            borderRadius: "var(--radius-md)",
            padding: "8px 16px",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {t("femme.dashboard.newAppointment")}
        </button>
      </div>

      {/* ── 2. FISCAL ALERT ── */}
      {fiscalAlert && (
        <div
          style={{
            background: "var(--color-warning-lt)",
            borderRadius: "var(--radius-md)",
            padding: "10px 14px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--color-warning)",
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1, fontSize: 12, color: "var(--color-warning)" }}>
            {t(`femme.dashboard.alerts.${fiscalAlert.messageKey}`, {
              defaultValue: fiscalAlert.message,
            })}
          </span>
          <button
            type="button"
            aria-label={t("femme.dashboard.fiscalAlertDismiss")}
            onClick={() => setAlertDismissed(true)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-warning)",
              fontSize: 18,
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── 3. METRICS ── */}
      <div
        className="mb-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <MetricCard
          iconBg="var(--color-rose-lt)"
          icon={<MoneyIcon c="var(--color-rose)" />}
          value={fmtMoneyGs(data.revenueDay.collected, numberLocale)}
          label={t("femme.dashboard.metricRevenueDay")}
          delta={`${t("femme.dashboard.invoiced")}: ${fmtMoneyGs(data.revenueDay.invoiced, numberLocale)}`}
        />
        <MetricCard
          iconBg="var(--color-mauve-lt)"
          icon={<CalIcon c="var(--color-mauve)" />}
          value={String(a.total)}
          label={t("femme.dashboard.metricApptToday")}
          delta={
            a.pending > 0 ? `${a.pending} ${t("femme.dashboard.metricPending")}` : undefined
          }
        />
        <MetricCard
          iconBg="var(--color-success-lt)"
          icon={<TrendIcon c="var(--color-success)" />}
          value={fmtMoneyGs(data.revenueWeek.collected, numberLocale)}
          label={t("femme.dashboard.metricRevenueWeek")}
          delta={`${t("femme.dashboard.invoiced")}: ${fmtMoneyGs(data.revenueWeek.invoiced, numberLocale)}`}
        />
        <MetricCard
          iconBg="var(--color-stone-md)"
          icon={<UsersIcon c="var(--color-ink-3)" />}
          value={fmtCount(data.clientsThisMonth, numberLocale)}
          label={t("femme.dashboard.metricClientsMonth")}
        />
      </div>

      {/* ── 4. TWO-COLUMN GRID (stack on narrow viewports) ── */}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
        {/* LEFT: Today's appointments */}
        <div style={{ ...cardStyle, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-ink)" }}>
              {t("femme.dashboard.todayAppointments")}
            </span>
            <Link
              to="/app/calendar"
              style={{ fontSize: 11, color: "var(--color-rose)", textDecoration: "none" }}
            >
              {t("femme.dashboard.viewAgenda")}
            </Link>
          </div>

          <div style={{ marginBottom: 10 }}>
            <ListSearchField
              id="dashboard-appt-filter"
              value={apptListQuery}
              onChange={setApptListQuery}
              label={t("femme.listFilter.label")}
              placeholder={t("femme.listFilter.placeholder")}
            />
          </div>

          {todayAppts.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--color-ink-3)", padding: "12px 0" }}>
              {t("femme.dashboard.noAppts")}
            </div>
          ) : visibleTodayAppts.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--color-ink-3)", padding: "12px 0" }}>
              {t("femme.listFilter.noMatches")}
            </div>
          ) : (
            visibleTodayAppts.map((appt, idx) => {
              const ac = avatarColor(appt.professionalName);
              const isLast = idx === visibleTodayAppts.length - 1;
              return (
                <div
                  key={appt.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 0",
                    borderBottom: isLast ? "none" : "0.5px solid var(--color-stone)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: "var(--color-ink)",
                      minWidth: 34,
                      flexShrink: 0,
                    }}
                  >
                    {fmtTime(appt.startAt, locale)}
                  </span>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "var(--radius-pill)",
                      background: ac.bg,
                      color: ac.color,
                      fontSize: 9,
                      fontWeight: 500,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {getInitials(appt.professionalName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: "var(--color-ink)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {appt.clientName ?? t("femme.calendar.detail.occasionalClient")}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--color-ink-3)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {appt.serviceName} · {appt.professionalName}
                    </div>
                  </div>
                  <StatusBadge status={appt.status} />
                </div>
              );
            })
          )}
        </div>

        {/* RIGHT column */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* Mini calendar */}
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <button
                type="button"
                aria-label={t("femme.calendar.prev")}
                onClick={() =>
                  setCalMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
                }
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-ink-2)",
                  fontSize: 16,
                  lineHeight: 1,
                  padding: "2px 6px",
                }}
              >
                ‹
              </button>
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-ink)" }}>
                {monthLabel}
              </span>
              <button
                type="button"
                aria-label={t("femme.calendar.next")}
                onClick={() =>
                  setCalMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
                }
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-ink-2)",
                  fontSize: 16,
                  lineHeight: 1,
                  padding: "2px 6px",
                }}
              >
                ›
              </button>
            </div>

            {/* Day-of-week headers */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 1,
                marginBottom: 4,
              }}
            >
              {DOW.map((d, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 9,
                    fontWeight: 500,
                    color: "var(--color-ink-3)",
                    textAlign: "center",
                    padding: "2px 0",
                  }}
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}>
              {calCells.map((cell, i) => {
                const isToday =
                  cell.current &&
                  cell.day === todayDay &&
                  calMonthIdx === todayMonth &&
                  calYear === todayYear;

                return (
                  <div
                    key={i}
                    style={{
                      fontSize: 10,
                      textAlign: "center",
                      padding: "4px 2px",
                      borderRadius: 5,
                      cursor: cell.current ? "pointer" : "default",
                      fontWeight: isToday ? 500 : 400,
                      background: isToday ? "var(--color-rose)" : "transparent",
                      color: isToday
                        ? "var(--color-on-primary)"
                        : cell.current
                          ? "var(--color-ink-2)"
                          : "var(--color-stone-md)",
                    }}
                  >
                    {cell.day}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Occupancy */}
          <div style={cardStyle}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--color-ink)",
                marginBottom: 12,
              }}
            >
              {t("femme.dashboard.occupancyTitle")}
            </div>

            {occupancy.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--color-ink-3)" }}>
                {t("femme.dashboard.noAppts")}
              </div>
            ) : (
              occupancy.map((prof) => {
                const ac = avatarColor(prof.name);
                return (
                  <div
                    key={prof.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "var(--radius-pill)",
                        background: ac.bg,
                        color: ac.color,
                        fontSize: 8,
                        fontWeight: 500,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {getInitials(prof.name)}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--color-ink)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {prof.name}
                    </div>
                    <div
                      style={{ fontSize: 10, color: "var(--color-ink-3)", flexShrink: 0 }}
                    >
                      {prof.count} {t("femme.dashboard.occupancyUnit")}
                    </div>
                    <div
                      style={{
                        width: 60,
                        height: 3,
                        background: "var(--color-stone-md)",
                        borderRadius: 2,
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          background: "var(--color-rose)",
                          borderRadius: 2,
                          width: `${(prof.count / maxOccupancy) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
