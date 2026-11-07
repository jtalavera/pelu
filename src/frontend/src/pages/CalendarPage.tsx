import { withDisplayNames } from "../lib/professionalDisplay";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Spinner } from "@design-system";
import { useTour } from "../tour/useTour";
import { calendarSteps } from "../tour/steps/calendar";
import { Appointment, CALENDAR_GRID_STATUSES, listAppointments } from "../api/appointments";
import { layoutWithOverflow } from "../calendar/calendarAppointmentLayout";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { AppointmentDetailModal } from "../components/AppointmentDetailModal";
import { AppointmentFormModal } from "../components/AppointmentFormModal";
import { getDateLocale } from "../i18n/dateLocale";
import { findQueryMatch, matchesListQuery } from "../util/matchesListQuery";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useMe } from "../hooks/useMe";
import { isPinSession } from "../auth/sharedDevice";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

// ── Calendar constants ────────────────────────────────────────────────────────
// Week grid hour range: one hour before the first turno of the week to one hour after the last one
// (08:00–18:00 when the week is empty), always within 07–21.
const DEFAULT_START = 8;
const DEFAULT_END = 18;
const MIN_HOUR = 7;
const MAX_HOUR = 21;
const PX_PER_HOUR = 64;
const PX_PER_HALF_HOUR = PX_PER_HOUR / 2;
/** Below this day-column width the week grid scrolls sideways instead of squeezing the cards. */
const MIN_DAY_COL_PX = 120;
/** At most this many turnos are drawn side by side; the rest of a group go into a «+N» chip. */
const MAX_SIDE_BY_SIDE = 2;
/** Height reserved under the anchor card for the «+N» chip. */
const MORE_CHIP_H = 20;

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function formatLocalYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function appointmentTopPx(startAt: string, gridStart: number): number {
  const d = new Date(startAt);
  const hours = d.getHours() + d.getMinutes() / 60;
  return Math.max(0, (hours - gridStart) * PX_PER_HOUR);
}

function appointmentHeightPx(durationMinutes: number): number {
  return Math.max(20, (durationMinutes / 60) * PX_PER_HOUR);
}

function isSameDay(isoString: string, day: Date): boolean {
  const d = new Date(isoString);
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  );
}

// ── Professional color palette for calendar blocks ────────────────────────────
// Solid blocks in the four brand colors (teal, durazno, celeste, rosa), as in the brand's agenda
// mockups; the left border is a darker shade of the fill (dotted when the appointment is PENDING).
// Same values in light and dark mode: the pastels and the teal all hold their contrast on both.
const PROF_COLORS = [
  { bg: "rgb(var(--fb-teal))",    border: "#0A545B", color: "rgb(var(--fb-lino))"  },
  { bg: "rgb(var(--fb-durazno))", border: "#D9976F", color: "rgb(var(--fb-tinta))" },
  { bg: "rgb(var(--fb-celeste))", border: "#7FA3C0", color: "rgb(var(--fb-tinta))" },
  { bg: "rgb(var(--fb-rosa))",    border: "#D9708F", color: "rgb(var(--fb-tinta))" },
] as const;

type ProfColor = (typeof PROF_COLORS)[number];

function profColor(professionalId: number, professionals: Professional[]): ProfColor {
  const idx = professionals.findIndex((p) => p.id === professionalId);
  return PROF_COLORS[(idx === -1 ? 0 : idx) % PROF_COLORS.length];
}

// ── Status icons of the week grid ─────────────────────────────────────────────
type GlyphKind = "COMPLETED_CHARGED" | "COMPLETED" | "IN_PROGRESS" | "CONFIRMED" | "PENDING";

/** Round 18px icon: filled green ✓ charged, amber ✓ completed (not charged), ● in progress, green ✓ confirmed, dashed ◔ pending. */
function StatusGlyph({ kind }: { kind: GlyphKind }) {
  const size = 18;
  const check = (
    <path d="M5 9.5l2.7 2.7L13 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  );
  if (kind === "COMPLETED_CHARGED") {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" style={{ color: "rgb(var(--fb-on-primary))" }}>
        <circle cx="9" cy="9" r="9" fill="rgb(var(--fb-success))" />
        {check}
      </svg>
    );
  }
  if (kind === "COMPLETED") {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" style={{ color: "rgb(var(--fb-warning))" }}>
        <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
        {check}
      </svg>
    );
  }
  if (kind === "IN_PROGRESS") {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r="9" fill="rgb(var(--fb-primary))" />
        <circle cx="9" cy="9" r="3.2" fill="rgb(var(--fb-on-primary))" />
      </svg>
    );
  }
  if (kind === "CONFIRMED") {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" style={{ color: "rgb(var(--fb-success))" }}>
        <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
        {check}
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" style={{ color: "rgb(var(--fb-ink-3))" }}>
      <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2.5" />
      <path d="M9 9V4.5A4.5 4.5 0 0 1 13.5 9Z" fill="currentColor" />
    </svg>
  );
}

function StatusIcon({
  status,
  charged,
  apptId,
  label,
  doneLabel,
}: {
  status: string;
  charged: boolean;
  apptId: number;
  label: string;
  doneLabel: string;
}) {
  if (status === "COMPLETED") {
    return (
      <span
        role="img"
        data-testid={`calendar-done-badge-${apptId}`}
        data-charged={charged ? "true" : "false"}
        aria-label={doneLabel}
        title={doneLabel}
        style={{ display: "inline-flex" }}
      >
        <StatusGlyph kind={charged ? "COMPLETED_CHARGED" : "COMPLETED"} />
      </span>
    );
  }
  if (status === "CONFIRMED") {
    return (
      <span role="img" data-testid={`confirmed-check-${apptId}`} aria-label={label} title={label} style={{ display: "inline-flex" }}>
        <StatusGlyph kind="CONFIRMED" />
      </span>
    );
  }
  if (status === "IN_PROGRESS" || status === "PENDING") {
    return (
      <span role="img" data-testid={`status-icon-${apptId}`} data-status={status} aria-label={label} title={label} style={{ display: "inline-flex" }}>
        <StatusGlyph kind={status} />
      </span>
    );
  }
  return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type ProfSchedule = { dayOfWeek: number; startTime: string; endTime: string; active: boolean };
type Professional = { id: number; fullName: string; displayName?: string | null; active: boolean; schedules?: ProfSchedule[] };

// ── Main component ────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const locale = getDateLocale(i18n);
  const { me } = useMe();
  // HU-66: no guided tour on a shared device's PIN session (it keeps no per-user state).
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR") && !isPinSession();
  const tourRole =
    !guidedTourEnabled
      ? undefined
      : me?.role === "PROFESSIONAL"
        ? "PROFESSIONAL"
        : "ADMIN";
  useTour("calendar", calendarSteps, tourRole, guidedTourEnabled);

  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Agenda redesign: the day is the main view and the cursor is the day being looked at; the week is
  // the same agenda as a grid, one tap away (`?view=week` also opens it directly).
  const [cursor, setCursor] = useState<Date>(() => {
    const selectedDate = (location.state as { selectedDate?: string } | null)?.selectedDate;
    if (selectedDate) {
      const d = new Date(selectedDate + "T00:00:00");
      if (!isNaN(d.getTime())) return d;
    }
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  });
  const [view, setView] = useState<"day" | "week">(searchParams.get("view") === "week" ? "week" : "day");
  const weekStartMs = startOfWeek(cursor).getTime();
  const weekStart = useMemo(() => new Date(weekStartMs), [weekStartMs]);
  const [pendingOpenApptId, setPendingOpenApptId] = useState<number | null>(
    () => (location.state as { openAppointmentId?: number } | null)?.openAppointmentId ?? null,
  );
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<number | null>(null);
  // Search by client or service: filters the day list and dims the non-matching blocks of the week.
  const [searchQuery, setSearchQuery] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Detail modal (shared with Inicio: AppointmentDetailModal owns its actions and sub-dialogs)
  const [detailAppt, setDetailAppt] = useState<Appointment | null>(null);

  // New appointment modal (editing happens from the detail modal)
  const [formOpen, setFormOpen] = useState(false);
  const [formInitialDate, setFormInitialDate] = useState<string | undefined>(undefined);
  const [formInitialHour, setFormInitialHour] = useState<number | undefined>(undefined);

  // Week grid «+N» chip: the overlap group whose list is open.
  const [morePop, setMorePop] = useState<{ dayKey: string; anchorId: number } | null>(null);
  useEffect(() => {
    if (!morePop) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-more-pop], [data-testid='calendar-more-chip']")) setMorePop(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMorePop(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [morePop]);
  const [hoveredApptId, setHoveredApptId] = useState<number | null>(null);
  const [dayGridHover, setDayGridHover] = useState<{
    colKey: (typeof DAY_KEYS)[number];
    slot: number;
  } | null>(null);
  // Mobile single-day view (AC-9)
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Load professionals and services once
  useEffect(() => {
    femmeJson<Professional[]>("/api/professionals")
      .then((profs) => {
        const active = withDisplayNames(profs).filter((p) => p.active);
        setProfessionals(active);
        if (me?.role === "PROFESSIONAL" && me.professionalId != null) {
          setSelectedProfessionalId(me.professionalId);
        }
      })
      .catch(() => {});
  }, [me?.role, me?.professionalId]);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const from = weekStart.toISOString();
      const to = addDays(weekStart, 7).toISOString();
      const appts = await listAppointments(from, to, selectedProfessionalId);
      setAppointments(appts);
    } catch (err) {
      setPageError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setLoading(false);
    }
  }, [weekStart, selectedProfessionalId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAppointments();
  }, [fetchAppointments]);

  // Deep-link support: open a specific appointment's detail modal when navigated here
  // (e.g. from the Panel principal's today's-turnos list) once it's loaded for the week.
  useEffect(() => {
    if (pendingOpenApptId == null) return;
    const appt = appointments.find((a) => a.id === pendingOpenApptId);
    if (appt) {
      setDetailAppt(appt);
      setPendingOpenApptId(null);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [appointments, pendingOpenApptId, navigate, location.pathname]);

  // ── Navigation ──────────────────────────────────────────────────────────────
  const activeView: "day" | "week" = isMobile ? "day" : view;
  const stepDays = activeView === "week" ? 7 : 1;
  const goPrev = () => setCursor((c) => addDays(c, -stepDays));
  const goNext = () => setCursor((c) => addDays(c, stepDays));
  const goToday = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    setCursor(now);
  };

  // ── Week days ───────────────────────────────────────────────────────────────
  const weekDays = DAY_KEYS.map((key, i) => ({
    key,
    label: t(`femme.calendar.days.${key}`),
    date: addDays(weekStart, i),
  }));

  const isToday = (date: Date) => {
    const now = new Date();
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  };

  // ── Appointment click → detail ──────────────────────────────────────────────
  const openDetail = (appt: Appointment) => {
    setDetailAppt(appt);
  };

  // After the turno's ficha is created / assigned the list reloads: keep the open detail in sync.
  useEffect(() => {
    setDetailAppt((prev) => (prev ? (appointments.find((a) => a.id === prev.id) ?? prev) : prev));
  }, [appointments]);

  const closeDetail = () => setDetailAppt(null);

  /** The detail dialog changed the turno (status, edit, ficha): keep the grid and the dialog in sync. */
  const onDetailChanged = (updated?: Appointment, kind?: "status" | "edited") => {
    if (!updated) {
      void fetchAppointments();
      return;
    }
    setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setDetailAppt(updated);
    if (kind === "edited") {
      // Show the day of the turno that was just saved.
      const savedDay = new Date(updated.startAt);
      savedDay.setHours(0, 0, 0, 0);
      setCursor(savedDay);
    }
  };

  // ── New appointment ─────────────────────────────────────────────────────────
  const openNewForm = (date?: Date, hour?: number) => {
    setFormInitialDate(formatLocalYmd(date ?? cursor));
    setFormInitialHour(hour);
    setFormOpen(true);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const longDateLabel = (() => {
    const l = cursor.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
    return l.charAt(0).toUpperCase() + l.slice(1);
  })();
  const weekLabel = `${formatDate(weekStart, locale)} – ${formatDate(addDays(weekStart, 6), locale)}`;
  const rangeLabel = activeView === "week" ? weekLabel : longDateLabel;
  // Same appointments the grid shows (cancelled and no-shows are not listed).
  const fullDayList = appointments
    .filter((a) => isSameDay(a.startAt, cursor) && CALENDAR_GRID_STATUSES.includes(a.status))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const searching = searchQuery.trim() !== "";
  /** The search looks at the client (or «Cliente ocasional») and the service of the turno. */
  const clientLabelOf = (a: Appointment) => a.clientName ?? t("femme.calendar.detail.occasionalClient");
  const matchesSearch = (a: Appointment) =>
    matchesListQuery(clientLabelOf(a), searchQuery) || matchesListQuery(a.serviceName, searchQuery);
  const dayList = searching ? fullDayList.filter(matchesSearch) : fullDayList;
  const weekAppts = appointments.filter((a) => CALENDAR_GRID_STATUSES.includes(a.status));
  const weekMatchCount = searching ? weekAppts.filter(matchesSearch).length : weekAppts.length;
  // Week grid: per-day layout (at most two turnos side by side) and hour range.
  const weekDayData = weekDays.map(({ date }) => {
    const appts = appointments
      .filter((a) => isSameDay(a.startAt, date))
      .filter((a) => CALENDAR_GRID_STATUSES.includes(a.status));
    const { layout, groups } = layoutWithOverflow(appts, MAX_SIDE_BY_SIDE);
    const hidden = new Set<number>();
    for (const g of groups) for (const m of g.members) if (!layout.has(m.id)) hidden.add(m.id);
    return { appts: appts.filter((a) => !hidden.has(a.id)), total: appts.length, layout, groups };
  });
  let gridStart = DEFAULT_START;
  let gridEnd = DEFAULT_END;
  if (weekAppts.length > 0) {
    gridStart = MAX_HOUR;
    gridEnd = MIN_HOUR;
    for (const a of weekAppts) {
      const s = new Date(a.startAt);
      const startMin = s.getHours() * 60 + s.getMinutes();
      gridStart = Math.min(gridStart, Math.floor(startMin / 60) - 1);
      gridEnd = Math.max(gridEnd, Math.ceil((startMin + a.durationMinutes) / 60) + 1);
    }
  }
  gridStart = Math.max(MIN_HOUR, gridStart);
  gridEnd = Math.min(MAX_HOUR, Math.max(gridEnd, gridStart + 4));
  gridStart = Math.min(gridStart, gridEnd - 4);
  const totalHours = gridEnd - gridStart;
  const gridHeight = totalHours * PX_PER_HOUR;
  const slotsPerDay = totalHours * 2;
  const weekGridColumns = `52px repeat(${weekDays.length}, minmax(0, 1fr))`;
  const weekGridMinWidth = 52 + weekDays.length * MIN_DAY_COL_PX;
  /** The text with the part that matches the search highlighted. */
  const highlight = (text: string) => {
    const range = searching ? findQueryMatch(text, searchQuery) : null;
    if (!range) return text;
    return (
      <>
        {text.slice(0, range[0])}
        <mark className="rounded bg-warning-lt px-px text-inherit">{text.slice(range[0], range[1])}</mark>
        {text.slice(range[1])}
      </>
    );
  };
  const visibleDays = weekDays;
  const selectedProfessionalName =
    professionals.find((p) => p.id === selectedProfessionalId)?.fullName ?? null;

  const STATUS_TEXT: Record<string, string> = {
    PENDING: "text-warning",
    CONFIRMED: "text-success",
    IN_PROGRESS: "text-primary",
    COMPLETED: "text-ink-3",
  };

  const navBtn =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-line bg-surface text-lg leading-none text-ink-2 hover:bg-primary-lt";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {/* ── Page topbar ── */}
      <div data-tour="calendar-header" className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-extrabold text-ink">{t("femme.calendar.title")}</h1>
        <Button
          data-tour="calendar-new-appointment"
          type="button"
          variant="primary"
          className="min-h-11 sm:h-11 sm:min-h-11"
          onClick={() => openNewForm()}
        >
          {t("femme.calendar.newAppointment")}
        </Button>
      </div>

      {/* Navigation + Day | Week */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div data-tour="calendar-week-nav" className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            aria-label={activeView === "week" ? t("femme.calendar.prev") : t("femme.calendar.prevDay")}
            className={navBtn}
          >
            ‹
          </button>
          <Button
            data-tour="calendar-today"
            type="button"
            variant="outline"
            className="min-h-11 sm:h-11 sm:min-h-11"
            onClick={goToday}
          >
            {t("femme.calendar.today")}
          </Button>
          <button
            type="button"
            onClick={goNext}
            aria-label={activeView === "week" ? t("femme.calendar.next") : t("femme.calendar.nextDay")}
            className={navBtn}
          >
            ›
          </button>
          <span className="min-w-0 truncate font-heading text-lg font-extrabold text-ink" data-testid="calendar-range-label">
            {rangeLabel}
          </span>
        </div>
        <div
          data-tour="calendar-search"
          className="relative order-last w-full sm:order-none sm:w-auto sm:max-w-sm sm:flex-1"
        >
          <label htmlFor="calendar-search" className="sr-only">
            {t("femme.calendar.search.label")}
          </label>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            id="calendar-search"
            data-testid="calendar-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("femme.calendar.search.placeholder")}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            className="h-11 w-full rounded-full border-[1.5px] border-line bg-bg pl-[42px] pr-11 text-sm text-ink placeholder:text-ink-3 focus:border-primary focus:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-search-cancel-button]:hidden"
          />
          {searching && (
            <button
              type="button"
              data-testid="calendar-search-clear"
              aria-label={t("femme.calendar.search.clear")}
              onClick={() => setSearchQuery("")}
              className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-lg text-ink-3 hover:bg-primary-lt"
            >
              ×
            </button>
          )}
        </div>
        {!isMobile && (
          <div
            role="tablist"
            aria-label={t("femme.calendar.views.label")}
            data-tour="calendar-views"
            className="grid min-w-[200px] grid-cols-2 gap-1 rounded-2xl bg-primary-lt p-1"
          >
            {(["day", "week"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                data-testid={`calendar-view-${v}`}
                onClick={() => setView(v)}
                className={`min-h-10 rounded-xl text-sm font-bold ${
                  view === v ? "bg-surface text-primary shadow" : "text-ink-2"
                }`}
              >
                {t(`femme.calendar.views.${v}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Professional filter (chips) — also for the professional role (issue #38 follow-up): they can
          browse every agenda, but only modify their own appointments. */}
      <div data-tour="calendar-prof-filter" className="flex gap-2 overflow-x-auto pb-0.5" role="group" aria-label={t("femme.calendar.filterByProfessional")}>
        <button
          type="button"
          aria-pressed={selectedProfessionalId === null}
          data-testid="calendar-prof-chip-all"
          onClick={() => setSelectedProfessionalId(null)}
          className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-bold ${
            selectedProfessionalId === null
              ? "border-primary bg-primary-lt text-primary"
              : "border-line bg-surface text-ink"
          }`}
        >
          {t("femme.calendar.allProfessionals")}
        </button>
        {professionals.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={selectedProfessionalId === p.id}
            data-testid={`calendar-prof-chip-${p.id}`}
            onClick={() => setSelectedProfessionalId(p.id)}
            className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-bold ${
              selectedProfessionalId === p.id
                ? "border-primary bg-primary-lt text-primary"
                : "border-line bg-surface text-ink"
            }`}
          >
            {p.fullName}
          </button>
        ))}
      </div>

      {/* Week strip: jump between the days of the week, with how busy each one is */}
      {activeView === "day" && (
        <div className="grid grid-cols-7 gap-1.5" data-testid="calendar-week-strip">
          {weekDays.map(({ key, label, date }) => {
            const n = appointments.filter(
              (a) => isSameDay(a.startAt, date) && CALENDAR_GRID_STATUSES.includes(a.status),
            ).length;
            const selected = formatLocalYmd(cursor) === formatLocalYmd(date);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                data-testid={`calendar-strip-${key}`}
                onClick={() => setCursor(new Date(date.getFullYear(), date.getMonth(), date.getDate()))}
                className={`flex min-h-16 flex-col items-center gap-0.5 rounded-2xl border px-0.5 py-2 ${
                  selected ? "border-primary bg-primary text-primary-fg" : "border-line bg-surface text-ink"
                }`}
              >
                <small className={`text-[11px] font-bold uppercase tracking-wider ${selected ? "opacity-85" : "text-ink-3"}`}>
                  {label}
                </small>
                <b className="font-heading text-lg tabular-nums">{date.getDate()}</b>
                {isToday(date) && (
                  <span aria-hidden className={`h-[3px] w-4 rounded ${selected ? "bg-primary-fg" : "bg-primary"}`} />
                )}
                <i className={`text-[11px] not-italic ${selected ? "opacity-85" : "text-ink-3"}`}>
                  {n > 0 ? t("femme.calendar.count", { count: n }) : t("femme.calendar.free")}
                </i>
              </button>
            );
          })}
        </div>
      )}

      {/* How many turnos match the search */}
      {searching && !loading && (
        <p data-testid="calendar-search-count" aria-live="polite" className="text-sm tabular-nums text-ink-3">
          {activeView === "week"
            ? t("femme.calendar.search.countWeek", { shown: weekMatchCount, total: weekAppts.length })
            : t("femme.calendar.search.countDay", { shown: dayList.length, total: fullDayList.length })}
        </p>
      )}

      {/* Errors */}
      {pageError && (
        <Alert variant="destructive">
          <p>{pageError}</p>
        </Alert>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
          <Spinner size="lg" />
        </div>
      )}

      {/* ── Day list ── */}
      {!loading && activeView === "day" && (
        <section
          data-tour="calendar-grid"
          className="rounded-card border border-line bg-surface shadow-sm"
          data-testid="calendar-day-list"
        >
          {dayList.length === 0 && searching && fullDayList.length > 0 ? (
            <div
              data-testid="calendar-search-empty"
              className="flex flex-col items-center gap-1 px-5 py-8 text-center text-ink-3"
            >
              <p className="font-heading text-base font-extrabold text-ink">
                {t("femme.calendar.search.noMatchesTitle")}
              </p>
              <p>{t("femme.calendar.search.noMatchesBody", { term: searchQuery.trim() })}</p>
              <Button type="button" variant="outline" className="mt-2 min-h-11" onClick={() => setSearchQuery("")}>
                {t("femme.calendar.search.reset")}
              </Button>
            </div>
          ) : dayList.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-5 py-8 text-center text-ink-3">
              <p>
                {selectedProfessionalName
                  ? t("femme.calendar.emptyDayFor", { name: selectedProfessionalName })
                  : t("femme.calendar.emptyDay")}
              </p>
              <Button type="button" variant="primary" className="min-h-11" onClick={() => openNewForm()}>
                {t("femme.calendar.newAppointment")}
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col px-2 py-1">
              {dayList.map((appt) => {
                const start = new Date(appt.startAt);
                const time = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
                const clientLabel = appt.clientName ?? t("femme.calendar.detail.occasionalClient");
                return (
                  <li key={appt.id} className="border-t border-line first:border-t-0">
                    <button
                      type="button"
                      data-testid={`calendar-appt-${appt.id}`}
                      onClick={() => openDetail(appt)}
                      aria-label={`${clientLabel} – ${appt.serviceName}${appt.clientBirthdayOnDay ? ` – ${t("femme.calendar.clientBirthday")}` : ""}`}
                      className={`grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-2 py-3 text-left hover:bg-bg ${
                        appt.status === "COMPLETED" ? "opacity-80" : ""
                      }`}
                    >
                      <span className="col-start-1 row-span-2 row-start-1 font-heading text-[17px] font-extrabold tabular-nums text-ink">
                        {time}
                      </span>
                      <span className="col-start-2 row-start-1 min-w-0 self-end break-words font-semibold text-ink">
                        {highlight(clientLabel)}
                        {appt.status === "IN_PROGRESS" && (
                          <span className="ml-1.5 whitespace-nowrap text-[11px] font-extrabold uppercase tracking-wider text-primary">
                            · {t("femme.calendar.now")}
                          </span>
                        )}
                        {appt.clientBirthdayOnDay && (
                          <span
                            data-testid={`birthday-badge-${appt.id}`}
                            role="img"
                            aria-label={t("femme.calendar.clientBirthday")}
                            title={t("femme.calendar.clientBirthday")}
                            className="ml-1.5 whitespace-nowrap text-[11px] font-extrabold uppercase tracking-wider text-primary"
                          >
                            🎂
                          </span>
                        )}
                        {appt.status === "COMPLETED" && (
                          <span
                            data-testid={`calendar-done-badge-${appt.id}`}
                            data-charged={appt.invoiceId != null ? "true" : "false"}
                            className={`ml-1.5 whitespace-nowrap rounded-full px-2 py-px text-[11px] font-extrabold ${
                              appt.invoiceId != null
                                ? "bg-success-lt text-success"
                                : "border border-line bg-page text-ink-2"
                            }`}
                          >
                            ✓ {t(appt.invoiceId != null ? "femme.calendar.badge.charged" : "femme.calendar.badge.completed")}
                          </span>
                        )}
                      </span>
                      <span className="col-start-2 row-start-2 min-w-0 self-start break-words text-sm text-ink-3">
                        {appt.status !== "COMPLETED" && (
                          <span className={`font-semibold ${STATUS_TEXT[appt.status] ?? "text-ink-3"}`}>
                            {t(`femme.calendar.status.${appt.status}`)}
                          </span>
                        )}
                        {appt.status === "CONFIRMED" && (
                          <span aria-hidden data-testid={`confirmed-check-${appt.id}`} className="ml-1 text-success">
                            ✓
                          </span>
                        )}
                        {appt.reminderSentAt && (
                          <span
                            data-testid={`reminder-sent-badge-${appt.id}`}
                            title={t("femme.calendar.detail.reminderSent")}
                            className="ml-1"
                          >
                            ·{" "}
                            <span aria-hidden>🔔</span>
                          </span>
                        )}{" "}
                        {appt.status !== "COMPLETED" ? "· " : ""}
                        {highlight(appt.serviceName)} · {appt.professionalName}
                      </span>
                      <span aria-hidden className="col-start-3 row-span-2 row-start-1 text-xl text-ink-3">
                        ›
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ── Calendar grid (week) ── */}
      {!loading && activeView === "week" && (
        <div data-tour="calendar-grid">
          <div
            style={{
              background: "var(--color-white)",
              borderRadius: "var(--radius-xl)",
              border: "var(--border-default)",
              overflow: "hidden",
            }}
          >
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: weekGridMinWidth }}>
                {/* Day header row */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: weekGridColumns,
                    borderBottom: "var(--border-default)",
                  }}
                >
                  <div
                    style={{
                      borderRight: "var(--border-default)",
                      background: "var(--color-stone)",
                    }}
                  />
                  {visibleDays.map(({ key, label, date }, dayIdx) => {
                    const today = isToday(date);
                    const count = weekDayData[dayIdx].total;
                    return (
                      <div
                        key={key}
                        data-testid={`calendar-day-head-${key}`}
                        style={{
                          padding: "8px 6px",
                          textAlign: "center",
                          fontSize: 11,
                          color: "var(--color-ink-3)",
                          background: "var(--color-stone)",
                          borderRight: dayIdx < visibleDays.length - 1 ? "var(--border-default)" : "none",
                        }}
                      >
                        <div
                          style={{
                            textTransform: "uppercase",
                            fontSize: 9,
                            letterSpacing: "0.06em",
                            marginBottom: 4,
                          }}
                        >
                          {label}
                        </div>
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: today ? "var(--color-rose)" : "transparent",
                            color: today ? "var(--color-on-primary)" : "var(--color-ink)",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: today ? 500 : 400,
                            fontSize: 12,
                            lineHeight: 1,
                          }}
                        >
                          {date.getDate()}
                        </div>
                        <div style={{ fontSize: 10, marginTop: 2 }}>
                          {count > 0 ? t("femme.calendar.count", { count }) : t("femme.calendar.free")}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Scrollable time grid */}
                <div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: weekGridColumns,
                      height: gridHeight,
                    }}
                  >
                    {/* Hour labels */}
                    <div style={{ position: "relative", borderRight: "var(--border-default)" }}>
                      {Array.from({ length: totalHours }).map((_, i) => {
                        const hour = gridStart + i;
                        return (
                          <div
                            key={hour}
                            style={{
                              position: "absolute",
                              top: i * PX_PER_HOUR,
                              right: 10,
                              transform: "translateY(-50%)",
                              fontSize: 11,
                              color: "var(--color-ink-3)",
                              textAlign: "right",
                              paddingTop: 8,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {String(hour).padStart(2, "0")}:00
                          </div>
                        );
                      })}
                    </div>

                    {/* Day columns */}
                    {visibleDays.map(({ key, date }, dayIdx) => {
                      const { appts: dayAppts, layout: overlapLayout, groups: overflowGroups } = weekDayData[dayIdx];
                      const today = isToday(date);
                      return (
                        <div
                          key={key}
                          data-testid={`calendar-day-col-${key}`}
                          data-today={today ? "true" : undefined}
                          onMouseMove={(e) => {
                            const col = e.currentTarget as HTMLDivElement;
                            const relY = e.clientY - col.getBoundingClientRect().top;
                            const slot = Math.min(
                              slotsPerDay - 1,
                              Math.max(0, Math.floor(relY / PX_PER_HALF_HOUR)),
                            );
                            setDayGridHover({ colKey: key, slot });
                          }}
                          onMouseLeave={() => {
                            setDayGridHover((h) => (h?.colKey === key ? null : h));
                          }}
                          style={{
                            position: "relative",
                            height: gridHeight,
                            borderLeft: "var(--border-default)",
                            background: today ? "var(--color-rose-lt)" : undefined,
                            overflow: "visible",
                            zIndex: 0,
                          }}
                        >
                          {/* Hour lines */}
                          {Array.from({ length: totalHours }).map((_, i) => (
                            <div
                              key={i}
                              style={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                top: i * PX_PER_HOUR,
                                borderTop: "var(--border-default)",
                              }}
                            />
                          ))}
                          {/* Half-hour dashed lines */}
                          {Array.from({ length: totalHours }).map((_, i) => (
                            <div
                              key={`h${i}`}
                              style={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                top: i * PX_PER_HOUR + PX_PER_HOUR / 2,
                                borderTop: "0.5px dashed var(--color-stone-md)",
                              }}
                            />
                          ))}

                          {dayGridHover?.colKey === key ? (
                            <div
                              data-testid="calendar-hover-slot"
                              style={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                top: dayGridHover.slot * PX_PER_HALF_HOUR,
                                height: PX_PER_HALF_HOUR,
                                background: "var(--color-rose-lt)",
                                zIndex: 1,
                                pointerEvents: "none",
                              }}
                              aria-hidden
                            />
                          ) : null}
                          {/* Click-to-create overlay */}
                          <button
                            type="button"
                            style={{
                              position: "absolute",
                              inset: 0,
                              width: "100%",
                              zIndex: 0,
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                            }}
                            onClick={(e) => {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const relY = e.clientY - rect.top;
                              const hour = Math.floor(relY / PX_PER_HOUR) + gridStart;
                              openNewForm(date, hour);
                            }}
                            aria-label={t("femme.calendar.newAppointment")}
                          />

                          {/* Appointment blocks: clean cards, the professional's colour is the left stripe */}
                          {dayAppts.map((appt) => {
                            const top = appointmentTopPx(appt.startAt, gridStart);
                            const minBlockH = appointmentHeightPx(appt.durationMinutes);
                            const pc = profColor(appt.professionalId, professionals);
                            const slot = overlapLayout.get(appt.id) ?? { col: 0, slotCount: 1 };
                            const { col, slotCount } = slot;
                            const leftPct = (col / slotCount) * 100;
                            const widthPct = 100 / slotCount;
                            const hovered = hoveredApptId === appt.id;
                            const isAnchor = overflowGroups.some((g) => g.anchorId === appt.id);
                            const cardH = isAnchor ? Math.max(24, minBlockH - MORE_CHIP_H - 2) : minBlockH;
                            const done = appt.status === "COMPLETED";
                            const charged = done && appt.invoiceId != null;
                            const dimmed = searching && !matchesSearch(appt);
                            const start = new Date(appt.startAt);
                            const timeLabel = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
                            const clientLabel = clientLabelOf(appt);
                            return (
                              <button
                                key={appt.id}
                                type="button"
                                data-testid={`calendar-appt-${appt.id}`}
                                data-done={done ? (charged ? "charged" : "completed") : undefined}
                                data-dimmed={dimmed ? "true" : undefined}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDetail(appt);
                                }}
                                onMouseEnter={() => setHoveredApptId(appt.id)}
                                onMouseLeave={() => setHoveredApptId(null)}
                                style={{
                                  position: "absolute",
                                  left: `${leftPct}%`,
                                  width: `calc(${widthPct}% - 4px)`,
                                  marginLeft: 2,
                                  top,
                                  height: hovered ? "auto" : cardH,
                                  minHeight: cardH,
                                  zIndex: hovered ? 60 : 10,
                                  opacity: dimmed && !hovered ? 0.3 : 1,
                                  transition: "opacity 0.15s",
                                  borderRadius: "var(--radius-md)",
                                  padding: "4px 6px 4px 7px",
                                  fontSize: 12,
                                  cursor: "pointer",
                                  background: "rgb(var(--fb-surface))",
                                  border: "1px solid rgb(var(--fb-border))",
                                  borderLeft: `4px solid ${pc.border}`,
                                  color: "rgb(var(--fb-ink))",
                                  textAlign: "left",
                                  overflow: hovered ? "visible" : "hidden",
                                  boxShadow: hovered ? "0 10px 28px rgba(0, 0, 0, 0.18)" : undefined,
                                }}
                                aria-label={`${clientLabel} – ${appt.serviceName}${appt.clientBirthdayOnDay ? ` – ${t("femme.calendar.clientBirthday")}` : ""}`}
                              >
                                <span
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 4,
                                    marginBottom: 2,
                                  }}
                                >
                                  <span style={{ fontSize: 11, fontWeight: 600, color: "rgb(var(--fb-ink-2))" }}>
                                    {timeLabel}
                                  </span>
                                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                    {appt.clientBirthdayOnDay && (
                                      <span
                                        role="img"
                                        data-testid={`birthday-badge-${appt.id}`}
                                        aria-label={t("femme.calendar.clientBirthday")}
                                        title={t("femme.calendar.clientBirthday")}
                                        style={{ fontSize: 11, lineHeight: "12px" }}
                                      >
                                        🎂
                                      </span>
                                    )}
                                    {appt.reminderSentAt && (
                                      <span
                                        data-testid={`reminder-sent-badge-${appt.id}`}
                                        title={t("femme.calendar.detail.reminderSent")}
                                        style={{
                                          width: 12,
                                          height: 12,
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          opacity: 0.85,
                                        }}
                                      >
                                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                          <path
                                            d="M8 1.5c-.6 0-1 .45-1 1v.55C4.9 3.5 3.5 5.35 3.5 7.5v2.5L2 12h12l-1.5-2V7.5c0-2.15-1.4-4-3.5-4.45V2.5c0-.55-.45-1-1-1Z"
                                            stroke="currentColor"
                                            strokeWidth="1.1"
                                            strokeLinejoin="round"
                                          />
                                          <path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                                        </svg>
                                      </span>
                                    )}
                                    <StatusIcon
                                      status={appt.status}
                                      charged={charged}
                                      apptId={appt.id}
                                      label={t(`femme.calendar.status.${appt.status}`)}
                                      doneLabel={t(charged ? "femme.calendar.badge.charged" : "femme.calendar.badge.completed")}
                                    />
                                  </span>
                                </span>
                                <p style={{ margin: 0, fontWeight: 700, fontSize: 12.5, lineHeight: 1.25, wordBreak: "break-word" }}>
                                  {highlight(clientLabel)}
                                </p>
                                <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.25, color: "rgb(var(--fb-ink-3))", wordBreak: "break-word" }}>
                                  {highlight(appt.serviceName)} · {appt.professionalName}
                                </p>
                              </button>
                            );
                          })}

                          {/* «+N»: the turnos of a crowded hour that do not fit side by side */}
                          {overflowGroups.map((g) => {
                            const anchor = g.members.find((m) => m.id === g.anchorId)!;
                            const anchorH = Math.max(24, appointmentHeightPx(anchor.durationMinutes) - MORE_CHIP_H - 2);
                            const chipTop = appointmentTopPx(anchor.startAt, gridStart) + anchorH + 2;
                            const first = new Date(g.members[0].startAt);
                            const timeLabel = `${String(first.getHours()).padStart(2, "0")}:${String(first.getMinutes()).padStart(2, "0")}`;
                            const open = morePop?.dayKey === key && morePop.anchorId === g.anchorId;
                            return (
                              <div key={`more-${g.anchorId}`}>
                                <button
                                  type="button"
                                  data-testid="calendar-more-chip"
                                  data-appt-ids={`,${g.members.map((m) => m.id).join(",")},`}
                                  aria-expanded={open}
                                  aria-label={t("femme.calendar.moreAria", { count: g.members.length, time: timeLabel })}
                                  title={t("femme.calendar.moreAria", { count: g.members.length, time: timeLabel })}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMorePop(open ? null : { dayKey: key, anchorId: g.anchorId });
                                  }}
                                  style={{
                                    position: "absolute",
                                    left: "50%",
                                    width: "calc(50% - 4px)",
                                    marginLeft: 2,
                                    top: chipTop,
                                    height: MORE_CHIP_H,
                                    zIndex: 12,
                                    borderRadius: "var(--radius-md)",
                                    border: "1px dashed rgb(var(--fb-ink-3))",
                                    background: "rgb(var(--fb-bg))",
                                    color: "rgb(var(--fb-ink-2))",
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    padding: 0,
                                  }}
                                >
                                  {t("femme.calendar.moreCount", { count: g.hiddenCount })}
                                </button>
                                {open && (
                                  <div
                                    data-more-pop
                                    data-testid="calendar-more-popover"
                                    role="dialog"
                                    aria-label={t("femme.calendar.morePopTitle", { count: g.members.length, time: timeLabel })}
                                    style={{
                                      position: "absolute",
                                      top: chipTop + MORE_CHIP_H + 4,
                                      ...(dayIdx < 4 ? { left: 2 } : { right: 2 }),
                                      width: 250,
                                      maxWidth: "90vw",
                                      zIndex: 70,
                                      background: "rgb(var(--fb-surface))",
                                      border: "1px solid rgb(var(--fb-border))",
                                      borderRadius: "var(--radius-lg)",
                                      boxShadow: "0 12px 30px rgba(0, 0, 0, 0.25)",
                                      padding: 6,
                                    }}
                                  >
                                    <div style={{ fontSize: 11, fontWeight: 700, color: "rgb(var(--fb-ink-2))", padding: "2px 4px 6px" }}>
                                      {t("femme.calendar.morePopTitle", { count: g.members.length, time: timeLabel })}
                                    </div>
                                    {g.members.map((m) => {
                                      const mp = profColor(m.professionalId, professionals);
                                      const mStart = new Date(m.startAt);
                                      const mCharged = m.status === "COMPLETED" && m.invoiceId != null;
                                      return (
                                        <button
                                          key={m.id}
                                          type="button"
                                          data-testid={`calendar-more-row-${m.id}`}
                                          onClick={() => {
                                            setMorePop(null);
                                            openDetail(m);
                                          }}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 7,
                                            width: "100%",
                                            minHeight: 44,
                                            marginTop: 3,
                                            padding: "6px 6px 6px 8px",
                                            borderRadius: "var(--radius-md)",
                                            border: "none",
                                            borderLeft: `4px solid ${mp.border}`,
                                            background: "rgb(var(--fb-bg))",
                                            color: "rgb(var(--fb-ink))",
                                            textAlign: "left",
                                            cursor: "pointer",
                                          }}
                                        >
                                          <span style={{ fontSize: 11, fontWeight: 600, color: "rgb(var(--fb-ink-2))" }}>
                                            {`${String(mStart.getHours()).padStart(2, "0")}:${String(mStart.getMinutes()).padStart(2, "0")}`}
                                          </span>
                                          <StatusIcon
                                            status={m.status}
                                            charged={mCharged}
                                            apptId={m.id}
                                            label={t(`femme.calendar.status.${m.status}`)}
                                            doneLabel={t(mCharged ? "femme.calendar.badge.charged" : "femme.calendar.badge.completed")}
                                          />
                                          <span style={{ minWidth: 0 }}>
                                            <b style={{ display: "block", fontSize: 12, wordBreak: "break-word" }}>{clientLabelOf(m)}</b>
                                            <span style={{ display: "block", fontSize: 11, color: "rgb(var(--fb-ink-3))", wordBreak: "break-word" }}>
                                              {m.serviceName} · {m.professionalName}
                                            </span>
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      <AppointmentDetailModal appointment={detailAppt} onClose={closeDetail} onChanged={onDetailChanged} />

      <AppointmentFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initialDate={formInitialDate}
        initialHour={formInitialHour}
        initialProfessionalId={selectedProfessionalId}
        onSaved={(saved, mode) => {
          setAppointments((prev) =>
            mode === "updated" ? prev.map((a) => (a.id === saved.id ? saved : a)) : [...prev, saved],
          );
          // Show the day of the appointment that was just saved.
          const savedDay = new Date(saved.startAt);
          savedDay.setHours(0, 0, 0, 0);
          setCursor(savedDay);
        }}
      />

    </div>
  );
}
