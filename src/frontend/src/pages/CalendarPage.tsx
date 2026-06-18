import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Label,
  Modal,
  Select,
  Spinner,
  Textarea,
  TimeCombobox,
} from "@design-system";
import { useTour } from "../tour/useTour";
import { calendarSteps } from "../tour/steps/calendar";
import {
  Appointment,
  AppointmentCreateRequest,
  AppointmentStatus,
  AppointmentUpdateRequest,
  CALENDAR_GRID_STATUSES,
  EDITABLE_STATUSES,
  ALL_STATUSES,
  createAppointment,
  listAppointments,
  updateAppointment,
  updateAppointmentStatus,
} from "../api/appointments";
import { layoutOverlappingInDay } from "../calendar/calendarAppointmentLayout";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";
import { LocalizedDateInput } from "../components/LocalizedDateInput";
import { SearchableSelect } from "../components/SearchableSelect";
import { StatusBadge } from "../components/StatusBadge";
import { getDateLocale } from "../i18n/dateLocale";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useMe } from "../hooks/useMe";
import { useLocation } from "react-router-dom";

// ── Calendar constants ────────────────────────────────────────────────────────
const HOUR_START = 7;
const HOUR_END = 21;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const PX_PER_HOUR = 64;
const GRID_HEIGHT = TOTAL_HOURS * PX_PER_HOUR;
const PX_PER_HALF_HOUR = PX_PER_HOUR / 2;
const SLOTS_PER_DAY = TOTAL_HOURS * 2;

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

function formatDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(isoString: string, locale: string): string {
  const d = new Date(isoString);
  return d.toLocaleString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function appointmentTopPx(startAt: string): number {
  const d = new Date(startAt);
  const hours = d.getHours() + d.getMinutes() / 60;
  return Math.max(0, (hours - HOUR_START) * PX_PER_HOUR);
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

function toLocalDatetimeString(date: Date, time: string): string {
  return `${formatDateIso(date)}T${time}:00`;
}

function toUtcIsoString(localDatetime: string): string {
  return new Date(localDatetime).toISOString();
}

// ── Professional color palette for calendar blocks ────────────────────────────
const PROF_COLORS = [
  { bg: "var(--color-rose-lt)",    border: "var(--color-rose)",    color: "var(--color-rose-dk)"  },
  { bg: "var(--color-mauve-lt)",   border: "var(--color-mauve)",   color: "var(--color-mauve-dk)" },
  { bg: "var(--color-success-lt)", border: "var(--color-success)", color: "var(--color-success)"  },
] as const;

type ProfColor = (typeof PROF_COLORS)[number];

function profColor(professionalId: number, professionals: Professional[]): ProfColor {
  const idx = professionals.findIndex((p) => p.id === professionalId);
  return PROF_COLORS[(idx === -1 ? 0 : idx) % PROF_COLORS.length];
}

// ── Types ─────────────────────────────────────────────────────────────────────
type ProfSchedule = { dayOfWeek: number; startTime: string; endTime: string; active: boolean };
type Professional = { id: number; fullName: string; active: boolean; schedules?: ProfSchedule[] };
type SalonService = { id: number; name: string; durationMinutes: number; active: boolean };
type Client = { id: number; fullName: string };

type FormErrors = {
  date?: string;
  time?: string;
  startInPast?: string;
  professionalId?: string;
  serviceId?: string;
};

// ── Main component ────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const locale = getDateLocale(i18n);
  const { me } = useMe();
  const isProfessional = me?.role === "PROFESSIONAL";
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR");
  const tourRole =
    !guidedTourEnabled
      ? undefined
      : me?.role === "PROFESSIONAL"
        ? "PROFESSIONAL"
        : "ADMIN";
  useTour("calendar", calendarSteps, tourRole, guidedTourEnabled);

  const location = useLocation();
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const selectedDate = (location.state as { selectedDate?: string } | null)?.selectedDate;
    if (selectedDate) {
      const d = new Date(selectedDate + "T00:00:00");
      if (!isNaN(d.getTime())) return startOfWeek(d);
    }
    return startOfWeek(new Date());
  });
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<number | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [services, setServices] = useState<SalonService[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Detail modal
  const [detailAppt, setDetailAppt] = useState<Appointment | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // New/Edit appointment modal
  const [formOpen, setFormOpen] = useState(false);
  const [editAppt, setEditAppt] = useState<Appointment | null>(null);
  const [formDate, setFormDate] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formProfessionalId, setFormProfessionalId] = useState<number | "">("");
  const [formServiceId, setFormServiceId] = useState<number | "">("");
  const [formClientId, setFormClientId] = useState<number | "">("");
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [formSaving, setFormSaving] = useState(false);
  const [formApiError, setFormApiError] = useState<string | null>(null);

  // Status change
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<AppointmentStatus>("PENDING");
  const [cancelReason, setCancelReason] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [hoveredApptId, setHoveredApptId] = useState<number | null>(null);
  const [dayGridHover, setDayGridHover] = useState<{
    colKey: (typeof DAY_KEYS)[number];
    slot: number;
  } | null>(null);
  // Mobile single-day view (AC-9)
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches,
  );
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(() => {
    const today = new Date();
    const jsDay = today.getDay();
    return jsDay === 0 ? 6 : jsDay - 1; // 0=Mon..6=Sun
  });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Availability warning (non-blocking) ────────────────────────────────────
  // dayOfWeek: JS Date.getDay() returns 0=Sun; schedule uses 1=Mon..7=Sun
  const availabilityWarning = useMemo((): string | null => {
    if (!formDate || !formTime || !formProfessionalId) return null;
    const prof = professionals.find((p) => p.id === formProfessionalId);
    if (!prof?.schedules?.length) return null;
    const d = new Date(formDate + "T00:00:00");
    const jsDay = d.getDay(); // 0=Sun..6=Sat
    const scheduleDay = jsDay === 0 ? 7 : jsDay; // convert to 1=Mon..7=Sun
    const sched = prof.schedules.find((s) => s.dayOfWeek === scheduleDay && s.startTime && s.endTime);
    if (!sched) return t("femme.calendar.form.availabilityWarningDayOff");
    // Normalize API times ("09:00:00" → "09:00")
    const normalize = (v: string) => v.slice(0, 5);
    if (formTime < normalize(sched.startTime) || formTime >= normalize(sched.endTime)) {
      return t("femme.calendar.form.availabilityWarningOutsideHours", {
        start: normalize(sched.startTime),
        end: normalize(sched.endTime),
      });
    }
    return null;
  }, [formDate, formTime, formProfessionalId, professionals, t]);

  // Scroll to 8am on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = (8 - HOUR_START) * PX_PER_HOUR;
    }
  }, []);

  // Load professionals and services once
  useEffect(() => {
    Promise.all([
      femmeJson<Professional[]>("/api/professionals"),
      femmeJson<SalonService[]>("/api/services"),
    ])
      .then(([profs, svcs]) => {
        const active = profs.filter((p) => p.active);
        setProfessionals(active);
        setServices(svcs.filter((s) => s.active));
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
    fetchAppointments();
  }, [fetchAppointments]);

  // Load clients when form opens
  useEffect(() => {
    if (formOpen && clients.length === 0) {
      femmeJson<Client[]>("/api/clients?q=")
        .then((c) => setClients(c))
        .catch(() => {});
    }
  }, [formOpen, clients.length]);

  // ── Navigation ──────────────────────────────────────────────────────────────
  const goPrev = () => setWeekStart((w) => addDays(w, -7));
  const goNext = () => setWeekStart((w) => addDays(w, 7));
  const goToday = () => {
    setWeekStart(startOfWeek(new Date()));
    const today = new Date();
    const jsDay = today.getDay();
    setSelectedDayIdx(jsDay === 0 ? 6 : jsDay - 1);
  };
  const goPrevDay = () => {
    setSelectedDayIdx((idx) => {
      if (idx === 0) {
        setWeekStart((w) => addDays(w, -7));
        return 6;
      }
      return idx - 1;
    });
  };
  const goNextDay = () => {
    setSelectedDayIdx((idx) => {
      if (idx === 6) {
        setWeekStart((w) => addDays(w, 7));
        return 0;
      }
      return idx + 1;
    });
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
    setDetailError(null);
  };

  const closeDetail = () => {
    setDetailAppt(null);
    setDetailError(null);
  };

  // ── Status change ───────────────────────────────────────────────────────────
  const openStatusModal = () => {
    if (!detailAppt) return;
    setSelectedStatus(detailAppt.status);
    setCancelReason(detailAppt.cancelReason ?? "");
    setStatusError(null);
    setStatusModalOpen(true);
  };

  const saveStatus = async () => {
    if (!detailAppt) return;
    setStatusSaving(true);
    setStatusError(null);
    try {
      const updated = await updateAppointmentStatus(detailAppt.id, {
        status: selectedStatus,
        cancelReason: selectedStatus === "CANCELLED" ? cancelReason || null : null,
      });
      setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setDetailAppt(updated);
      setStatusModalOpen(false);
    } catch (err) {
      setStatusError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setStatusSaving(false);
    }
  };

  // ── New appointment ─────────────────────────────────────────────────────────
  const openNewForm = (date?: Date, hour?: number) => {
    setEditAppt(null);
    setFormDate(date ? formatDateIso(date) : formatDateIso(new Date()));
    setFormTime(
      hour != null
        ? `${String(hour).padStart(2, "0")}:00`
        : formatDateIso(new Date()) === formatDateIso(new Date())
          ? ""
          : "",
    );
    setFormProfessionalId(
      isProfessional && me?.professionalId != null
        ? me.professionalId
        : (selectedProfessionalId ?? "")
    );
    setFormServiceId("");
    setFormClientId("");
    setFormErrors({});
    setFormApiError(null);
    setFormOpen(true);
  };

  // ── Edit appointment ────────────────────────────────────────────────────────
  const openEditForm = () => {
    if (!detailAppt) return;
    setEditAppt(detailAppt);
    const d = new Date(detailAppt.startAt);
    setFormDate(formatDateIso(d));
    setFormTime(
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    );
    setFormProfessionalId(detailAppt.professionalId);
    setFormServiceId(detailAppt.serviceId);
    setFormClientId(detailAppt.clientId ?? "");
    setFormErrors({});
    setFormApiError(null);
    setFormOpen(true);
    closeDetail();
  };

  // ── Form validation ─────────────────────────────────────────────────────────
  const validateForm = (): boolean => {
    const errors: FormErrors = {};
    if (!formDate) errors.date = t("femme.calendar.form.errors.dateRequired");
    if (!formTime) errors.time = t("femme.calendar.form.errors.timeRequired");
    if (!formProfessionalId)
      errors.professionalId = t("femme.calendar.form.errors.professionalRequired");
    if (!formServiceId) errors.serviceId = t("femme.calendar.form.errors.serviceRequired");
    if (formDate && formTime) {
      const localDt = toLocalDatetimeString(new Date(formDate), formTime);
      const startMs = new Date(localDt).getTime();
      if (!Number.isNaN(startMs) && startMs < Date.now()) {
        errors.startInPast = t("femme.calendar.form.errors.startInPast");
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Save appointment ────────────────────────────────────────────────────────
  const saveForm = async () => {
    if (!validateForm()) return;
    setFormSaving(true);
    setFormApiError(null);
    try {
      const localDt = toLocalDatetimeString(new Date(formDate), formTime);
      const startAt = toUtcIsoString(localDt);
      const clientId = formClientId !== "" ? (formClientId as number) : null;

      let updated: Appointment;
      if (editAppt) {
        const req: AppointmentUpdateRequest = {
          clientId,
          professionalId: formProfessionalId as number,
          serviceId: formServiceId as number,
          startAt,
        };
        updated = await updateAppointment(editAppt.id, req);
        setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      } else {
        const req: AppointmentCreateRequest = {
          clientId,
          professionalId: formProfessionalId as number,
          serviceId: formServiceId as number,
          startAt,
        };
        updated = await createAppointment(req);
        setAppointments((prev) => [...prev, updated]);
      }
      setFormOpen(false);
    } catch (err) {
      setFormApiError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setFormSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const weekLabel = `${formatDate(weekStart, locale)} – ${formatDate(addDays(weekStart, 6), locale)}`;
  const mobileDayLabel = weekDays[selectedDayIdx]
    ? `${weekDays[selectedDayIdx].label} ${formatDate(weekDays[selectedDayIdx].date, locale)}`
    : "";
  // On mobile, only render the selected day column
  const visibleDays = isMobile ? [weekDays[selectedDayIdx]].filter(Boolean) : weekDays;

  const navBtnStyle: React.CSSProperties = {
    padding: "6px 10px",
    border: "var(--border-default)",
    borderRadius: "var(--radius-md)",
    fontSize: 14,
    lineHeight: 1,
    background: "var(--color-white)",
    color: "var(--color-ink-2)",
    cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* ── Page topbar ── */}
      <div
        data-tour="calendar-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          paddingBottom: 16,
          borderBottom: "var(--border-default)",
        }}
      >
        <h1
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: "var(--color-ink)",
            margin: 0,
            flexShrink: 0,
          }}
        >
          {t("femme.calendar.title")}
        </h1>

        {/* Professional filter (hidden for professional role — they only see own agenda) */}
        {!isProfessional && (
          <div data-tour="calendar-prof-filter" style={{ minWidth: 0 }}>
            <SearchableSelect<number>
              id="prof-filter"
              className="min-w-0 shrink"
              labelSrOnly
              label={t("femme.calendar.filterByProfessional")}
              value={selectedProfessionalId ?? ""}
              onChange={(v) => setSelectedProfessionalId(v === "" ? null : v)}
              emptyOption={{ value: "", label: t("femme.calendar.allProfessionals") }}
              options={professionals.map((p) => ({ value: p.id, label: p.fullName }))}
              filterPlaceholder={t("femme.calendar.searchable.filterPlaceholder")}
              noResultsText={t("femme.calendar.searchable.noResults")}
            />
          </div>
        )}

        {/* Today */}
        <button
          data-tour="calendar-today"
          type="button"
          onClick={goToday}
          style={{
            padding: "6px 14px",
            border: "var(--border-default)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
            background: "var(--color-white)",
            color: "var(--color-ink-2)",
            cursor: "pointer",
          }}
        >
          {t("femme.calendar.today")}
        </button>

        {/* Week / Day navigation */}
        <div data-tour="calendar-week-nav" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {isMobile ? (
            <>
              <button type="button" onClick={goPrevDay} aria-label={t("femme.calendar.prevDay")} style={navBtnStyle}>
                ‹
              </button>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--color-ink)",
                  minWidth: 140,
                  textAlign: "center",
                  flexShrink: 0,
                }}
              >
                {mobileDayLabel}
              </span>
              <button type="button" onClick={goNextDay} aria-label={t("femme.calendar.nextDay")} style={navBtnStyle}>
                ›
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={goPrev} aria-label={t("femme.calendar.prev")} style={navBtnStyle}>
                ‹
              </button>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--color-ink)",
                  minWidth: 160,
                  textAlign: "center",
                  flexShrink: 0,
                }}
              >
                {weekLabel}
              </span>
              <button type="button" onClick={goNext} aria-label={t("femme.calendar.next")} style={navBtnStyle}>
                ›
              </button>
            </>
          )}
        </div>

        {/* New appointment — pushed right */}
        <button
          data-tour="calendar-new-appointment"
          type="button"
          onClick={() => openNewForm()}
          style={{
            marginLeft: "auto",
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
            flexShrink: 0,
          }}
        >
          {t("femme.calendar.newAppointment")}
        </button>
      </div>

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

      {/* ── Calendar grid ── */}
      {!loading && (
        <div
          data-tour="calendar-grid"
          style={{
            background: "var(--color-white)",
            borderRadius: "var(--radius-xl)",
            border: "var(--border-default)",
            overflow: "hidden",
            marginTop: 16,
          }}
        >
          {/* Day header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `52px repeat(${visibleDays.length}, 1fr)`,
              borderBottom: "var(--border-default)",
            }}
          >
            <div
              style={{
                borderRight: "var(--border-default)",
                background: "var(--color-stone)",
              }}
            />
            {visibleDays.map(({ key, label, date }, dayIdx) => (
              <div
                key={key}
                style={{
                  padding: "10px 8px",
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
                {isToday(date) ? (
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: "var(--color-rose)",
                      color: "var(--color-on-primary)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 500,
                      fontSize: 12,
                      lineHeight: 1,
                    }}
                  >
                    {date.getDate()}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--color-ink)", fontWeight: 400 }}>
                    {date.getDate()}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Scrollable time grid */}
          <div
            ref={scrollRef}
            style={{ overflowY: "auto", maxHeight: "calc(100vh - 230px)" }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `52px repeat(${visibleDays.length}, 1fr)`,
                height: GRID_HEIGHT,
              }}
            >
              {/* Hour labels */}
              <div style={{ position: "relative", borderRight: "var(--border-default)" }}>
                {Array.from({ length: TOTAL_HOURS }).map((_, i) => {
                  const hour = HOUR_START + i;
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
              {visibleDays.map(({ key, date }) => {
                const dayAppts = appointments
                  .filter((a) => isSameDay(a.startAt, date))
                  .filter((a) => CALENDAR_GRID_STATUSES.includes(a.status));
                const overlapLayout = layoutOverlappingInDay(dayAppts);
                return (
                  <div
                    key={key}
                    data-testid={`calendar-day-col-${key}`}
                    onMouseMove={(e) => {
                      const col = e.currentTarget as HTMLDivElement;
                      const relY = e.clientY - col.getBoundingClientRect().top;
                      const slot = Math.min(
                        SLOTS_PER_DAY - 1,
                        Math.max(0, Math.floor(relY / PX_PER_HALF_HOUR)),
                      );
                      setDayGridHover({ colKey: key, slot });
                    }}
                    onMouseLeave={() => {
                      setDayGridHover((h) => (h?.colKey === key ? null : h));
                    }}
                    style={{
                      position: "relative",
                      height: GRID_HEIGHT,
                      borderLeft: "var(--border-default)",
                      overflow: "visible",
                      zIndex: 0,
                    }}
                  >
                    {/* Hour lines */}
                    {Array.from({ length: TOTAL_HOURS }).map((_, i) => (
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
                    {Array.from({ length: TOTAL_HOURS }).map((_, i) => (
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
                        const hour = Math.floor(relY / PX_PER_HOUR) + HOUR_START;
                        openNewForm(date, hour);
                      }}
                      aria-label={t("femme.calendar.newAppointment")}
                    />

                    {/* Appointment blocks */}
                    {dayAppts.map((appt) => {
                      const top = appointmentTopPx(appt.startAt);
                      const minBlockH = appointmentHeightPx(appt.durationMinutes);
                      const pc = profColor(appt.professionalId, professionals);
                      const slot = overlapLayout.get(appt.id) ?? { col: 0, slotCount: 1 };
                      const { col, slotCount } = slot;
                      const leftPct = (col / slotCount) * 100;
                      const widthPct = 100 / slotCount;
                      const hovered = hoveredApptId === appt.id;
                      return (
                        <button
                          key={appt.id}
                          type="button"
                          data-testid={`calendar-appt-${appt.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(appt);
                          }}
                          onMouseEnter={() => setHoveredApptId(appt.id)}
                          onMouseLeave={() => setHoveredApptId(null)}
                          style={{
                            position: "absolute",
                            left: `${leftPct}%`,
                            width: hovered
                              ? "auto"
                              : `calc(${widthPct}% - 4px)`,
                            minWidth: hovered ? `calc(${widthPct}% - 4px)` : undefined,
                            maxWidth: hovered ? "calc(100% - 4px)" : undefined,
                            marginLeft: 2,
                            top,
                            minHeight: minBlockH,
                            height: hovered ? "auto" : minBlockH,
                            zIndex: hovered ? 60 : 10,
                            borderRadius: "var(--radius-md)",
                            padding: hovered ? 10 : 6,
                            fontSize: hovered ? 13 : 11,
                            cursor: "pointer",
                            background: pc.bg,
                            border: "none",
                            borderLeft: appt.status === "PENDING"
                              ? `3px dotted ${pc.border}`
                              : `3px solid ${pc.border}`,
                            color: pc.color,
                            textAlign: "left",
                            overflow: hovered ? "visible" : "hidden",
                            boxShadow: hovered
                              ? "0 10px 28px rgba(0, 0, 0, 0.18)"
                              : undefined,
                          }}
                          aria-label={`${appt.clientName ?? t("femme.calendar.detail.occasionalClient")} – ${appt.serviceName}`}
                        >
                          {appt.status === "CONFIRMED" && (
                            <span
                              aria-hidden="true"
                              data-testid={`confirmed-check-${appt.id}`}
                              style={{
                                position: "absolute",
                                top: 4,
                                right: 4,
                                width: 12,
                                height: 12,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                opacity: 0.85,
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                <path d="M2 6l2.5 2.5L10 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </span>
                          )}
                          <p
                            style={{
                              fontWeight: 500,
                              margin: 0,
                              overflow: hovered ? "visible" : "hidden",
                              textOverflow: hovered ? "clip" : "ellipsis",
                              whiteSpace: hovered ? "normal" : "nowrap",
                              wordBreak: hovered ? "break-word" : "normal",
                            }}
                          >
                            {appt.clientName ?? t("femme.calendar.detail.occasionalClient")}
                          </p>
                          <p
                            style={{
                              fontSize: 10,
                              margin: 0,
                              overflow: hovered ? "visible" : "hidden",
                              textOverflow: hovered ? "clip" : "ellipsis",
                              whiteSpace: hovered ? "normal" : "nowrap",
                              wordBreak: hovered ? "break-word" : "normal",
                              opacity: 0.85,
                            }}
                          >
                            {appt.serviceName}
                          </p>
                          <p
                            style={{
                              fontSize: 10,
                              margin: 0,
                              overflow: hovered ? "visible" : "hidden",
                              textOverflow: hovered ? "clip" : "ellipsis",
                              whiteSpace: hovered ? "normal" : "nowrap",
                              wordBreak: hovered ? "break-word" : "normal",
                              opacity: 0.75,
                            }}
                          >
                            {appt.professionalName}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Appointment detail modal ── */}
      <Modal
        open={detailAppt !== null}
        onClose={closeDetail}
        title={t("femme.calendar.detail.title")}
        footer={
          <div className="flex flex-wrap gap-2">
            {detailAppt && EDITABLE_STATUSES.includes(detailAppt.status) && (
              <Button size="sm" variant="outline" onClick={openEditForm}>
                {t("femme.calendar.detail.edit")}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={openStatusModal}>
              {t("femme.calendar.detail.changeStatus")}
            </Button>
            <Button size="sm" onClick={closeDetail}>
              {t("femme.calendar.detail.close")}
            </Button>
          </div>
        }
      >
        {detailAppt && (
          <div className="space-y-3 text-sm">
            {detailError && (
              <Alert variant="destructive">
                <p>{detailError}</p>
              </Alert>
            )}
            <Row label={t("femme.calendar.detail.client")}>
              {detailAppt.clientName ?? (
                <span className="italic text-slate-500 dark:text-slate-400">
                  {t("femme.calendar.detail.occasionalClient")}
                </span>
              )}
            </Row>
            <Row label={t("femme.calendar.detail.professional")}>
              {detailAppt.professionalName}
            </Row>
            <Row label={t("femme.calendar.detail.service")}>
              {detailAppt.serviceName} —{" "}
              {t("femme.calendar.detail.duration", { minutes: detailAppt.durationMinutes })}
            </Row>
            <Row label={t("femme.calendar.detail.date")}>
              {formatDateTime(detailAppt.startAt, locale)}
            </Row>
            <Row label={t("femme.calendar.detail.status")}>
              <StatusBadge status={detailAppt.status} />
            </Row>
            {detailAppt.cancelReason && (
              <Row label={t("femme.calendar.detail.cancelReason")}>
                {detailAppt.cancelReason}
              </Row>
            )}
          </div>
        )}
      </Modal>

      {/* ── Status change modal ── */}
      <Modal
        open={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        title={t("femme.calendar.detail.changeStatus")}
        footer={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatusModalOpen(false)}
              disabled={statusSaving}
            >
              {t("femme.calendar.detail.cancel")}
            </Button>
            <Button size="sm" onClick={saveStatus} disabled={statusSaving}>
              {statusSaving ? <Spinner size="sm" /> : t("femme.calendar.detail.save")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {statusError && (
            <Alert variant="destructive">
              <p role="alert">{statusError}</p>
            </Alert>
          )}
          <div className="space-y-1">
            <Label htmlFor="status-select">{t("femme.calendar.detail.status")}</Label>
            <Select
              id="status-select"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as AppointmentStatus)}
            >
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`femme.calendar.status.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          {selectedStatus === "CANCELLED" && (
            <div className="space-y-1">
              <Label htmlFor="cancel-reason">{t("femme.calendar.cancelDialog.reason")}</Label>
              <Textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t("femme.calendar.cancelDialog.reasonPlaceholder")}
                rows={3}
              />
            </div>
          )}
        </div>
      </Modal>

      {/* ── New / Edit appointment modal ── */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editAppt ? t("femme.calendar.form.editTitle") : t("femme.calendar.form.title")}
        footer={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFormOpen(false)}
              disabled={formSaving}
            >
              {t("femme.calendar.form.cancel")}
            </Button>
            <Button size="sm" onClick={saveForm} disabled={formSaving}>
              {formSaving ? <Spinner size="sm" /> : t("femme.calendar.form.save")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {formApiError && (
            <Alert variant="destructive">
              <p role="alert">{formApiError}</p>
            </Alert>
          )}
          {availabilityWarning && (
            <Alert variant="warning" data-testid="availability-warning">
              <p role="alert">{availabilityWarning}</p>
            </Alert>
          )}
          {/* Date */}
          <div className="space-y-1">
            <Label htmlFor="form-date">{t("femme.calendar.form.date")}</Label>
            <LocalizedDateInput
              id="form-date"
              value={formDate}
              onChange={setFormDate}
              invalid={!!(formErrors.date || formErrors.startInPast)}
              aria-describedby={
                [formErrors.date && "form-date-err", formErrors.startInPast && "form-start-past-err"]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              data-testid="appointment-date-input"
            />
            {formErrors.date && (
              <FieldValidationError id="form-date-err">{formErrors.date}</FieldValidationError>
            )}
          </div>
          {/* Time */}
          <div className="space-y-1">
            <Label htmlFor="form-time">{t("femme.calendar.form.time")}</Label>
            <TimeCombobox
              id="form-time"
              value={formTime}
              onChange={setFormTime}
              startTime="06:00"
              endTime="20:00"
              placeholder={t("femme.calendar.form.timePlaceholder")}
              aria-label={t("femme.calendar.form.timeAriaLabel")}
              invalid={!!(formErrors.time || formErrors.startInPast)}
              aria-describedby={
                [formErrors.time && "form-time-err", formErrors.startInPast && "form-start-past-err"]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              data-testid="appointment-time-input"
            />
            {formErrors.time && (
              <FieldValidationError id="form-time-err">{formErrors.time}</FieldValidationError>
            )}
            {formErrors.startInPast && (
              <FieldValidationError id="form-start-past-err">{formErrors.startInPast}</FieldValidationError>
            )}
          </div>
          {/* Professional (locked to own profile for professional role) */}
          <div className="space-y-1">
            {isProfessional ? (
              <div>
                <Label>{t("femme.calendar.form.professional")}</Label>
                <div
                  style={{
                    padding: "8px 12px",
                    border: "var(--border-default)",
                    borderRadius: "var(--radius-md)",
                    fontSize: 13,
                    color: "var(--color-ink-2)",
                    background: "var(--color-stone)",
                  }}
                >
                  {professionals.find((p) => p.id === me?.professionalId)?.fullName ??
                    t("femme.calendar.form.selectProfessional")}
                </div>
              </div>
            ) : (
              <>
                <SearchableSelect<number>
                  id="form-professional"
                  label={t("femme.calendar.form.professional")}
                  value={formProfessionalId}
                  onChange={(v) => setFormProfessionalId(v)}
                  emptyOption={{ value: "", label: t("femme.calendar.form.selectProfessional") }}
                  options={professionals.map((p) => ({ value: p.id, label: p.fullName }))}
                  filterPlaceholder={t("femme.calendar.searchable.filterPlaceholder")}
                  noResultsText={t("femme.calendar.searchable.noResults")}
                  invalid={!!formErrors.professionalId}
                  describedBy={formErrors.professionalId ? "form-prof-err" : undefined}
                />
                {formErrors.professionalId && (
                  <FieldValidationError id="form-prof-err">
                    {formErrors.professionalId}
                  </FieldValidationError>
                )}
              </>
            )}
          </div>
          {/* Service */}
          <div className="space-y-1">
            <SearchableSelect<number>
              id="form-service"
              label={t("femme.calendar.form.service")}
              value={formServiceId}
              onChange={(v) => setFormServiceId(v)}
              emptyOption={{ value: "", label: t("femme.calendar.form.selectService") }}
              options={services.map((s) => ({
                value: s.id,
                label: `${s.name} (${s.durationMinutes} min)`,
              }))}
              filterPlaceholder={t("femme.calendar.searchable.filterPlaceholder")}
              noResultsText={t("femme.calendar.searchable.noResults")}
              invalid={!!formErrors.serviceId}
              describedBy={formErrors.serviceId ? "form-svc-err" : undefined}
            />
            {formErrors.serviceId && (
              <FieldValidationError id="form-svc-err">
                {formErrors.serviceId}
              </FieldValidationError>
            )}
          </div>
          {/* Client (optional) */}
          <div className="space-y-1">
            <SearchableSelect<number>
              id="form-client"
              label={t("femme.calendar.form.client")}
              value={formClientId}
              onChange={(v) => setFormClientId(v)}
              emptyOption={{ value: "", label: t("femme.calendar.form.occasionalClient") }}
              options={clients.map((c) => ({ value: c.id, label: c.fullName }))}
              filterPlaceholder={t("femme.calendar.searchable.filterPlaceholder")}
              noResultsText={t("femme.calendar.searchable.noResults")}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Helper sub-component ──────────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span
        style={{
          width: 112,
          flexShrink: 0,
          fontWeight: 500,
          fontSize: 13,
          color: "var(--color-ink-2)",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 13, color: "var(--color-ink)" }}>{children}</span>
    </div>
  );
}
