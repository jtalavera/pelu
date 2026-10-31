import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Label,
  Modal,
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
import { ClientTechnicalSheetModal } from "../components/ClientTechnicalSheetModal";
import { StatusBadge } from "../components/StatusBadge";
import { getDateLocale } from "../i18n/dateLocale";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useMe } from "../hooks/useMe";
import { isPinSession } from "../auth/sharedDevice";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { billingStateForAppointment } from "../lib/appointmentBilling";

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

function formatLocalYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [services, setServices] = useState<SalonService[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Detail modal
  const [detailAppt, setDetailAppt] = useState<Appointment | null>(null);
  /** HU-68 AC6–8: client whose technical sheet is open on top of the detail / form modal. */
  const [technicalSheetClientId, setTechnicalSheetClientId] = useState<number | null>(null);
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

  // Status change: one next-step button + a few actions behind "⋯"; cancelling asks for a reason
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
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
      femmeJson<SalonService[]>("/api/services?kind=SERVICE"),
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
      setDetailError(null);
      setPendingOpenApptId(null);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [appointments, pendingOpenApptId, navigate, location.pathname]);

  // Load clients when form opens (active only — inactive clients must not be assignable to new turnos)
  useEffect(() => {
    if (formOpen && clients.length === 0) {
      femmeJson<Client[]>("/api/clients?q=&active=true")
        .then((c) => setClients(c))
        .catch(() => {});
    }
  }, [formOpen, clients.length]);

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

  // A professional browses every agenda but only modifies her own appointments (the backend
  // enforces the same rule).
  const canModify = (appt: Appointment) =>
    !isProfessional || (me?.professionalId != null && appt.professionalId === me.professionalId);

  // ── Appointment click → detail ──────────────────────────────────────────────
  const openDetail = (appt: Appointment) => {
    setDetailAppt(appt);
    setDetailError(null);
    setMoreOpen(false);
  };

  const closeDetail = () => {
    setDetailAppt(null);
    setDetailError(null);
    setMoreOpen(false);
  };

  // ── Status change ───────────────────────────────────────────────────────────
  const openCancelDialog = () => {
    if (!detailAppt) return;
    setCancelReason(detailAppt.cancelReason ?? "");
    setStatusError(null);
    setMoreOpen(false);
    setStatusModalOpen(true);
  };

  /** Moves the open appointment to `status` (no reason unless cancelling). */
  const applyStatus = async (status: AppointmentStatus, reason: string | null = null) => {
    if (!detailAppt) return;
    setStatusSaving(true);
    setActionBusy(true);
    setStatusError(null);
    setDetailError(null);
    try {
      const updated = await updateAppointmentStatus(detailAppt.id, {
        status,
        cancelReason: status === "CANCELLED" ? reason || null : null,
      });
      setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setDetailAppt(updated);
      setStatusModalOpen(false);
      setMoreOpen(false);
    } catch (err) {
      const msg = translateApiError(err, t, "femme.apiErrors.GENERIC");
      if (status === "CANCELLED") setStatusError(msg);
      else setDetailError(msg);
    } finally {
      setStatusSaving(false);
      setActionBusy(false);
    }
  };

  const saveStatus = () => applyStatus("CANCELLED", cancelReason);

  /** "Cobrar": Facturación opens with the client and the booked service already loaded. */
  const chargeAppointment = async () => {
    if (!detailAppt) return;
    setActionBusy(true);
    setDetailError(null);
    try {
      navigate("/app/billing", { state: await billingStateForAppointment(detailAppt) });
    } catch {
      setDetailError(t("femme.calendar.chargeError"));
    } finally {
      setActionBusy(false);
    }
  };

  // ── New appointment ─────────────────────────────────────────────────────────
  const openNewForm = (date?: Date, hour?: number) => {
    setEditAppt(null);
    setFormDate(formatLocalYmd(date ?? cursor));
    setFormTime(hour != null ? `${String(hour).padStart(2, "0")}:00` : "");
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
      // Show the day of the appointment that was just saved.
      const savedDay = new Date(updated.startAt);
      savedDay.setHours(0, 0, 0, 0);
      setCursor(savedDay);
    } catch (err) {
      setFormApiError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setFormSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const longDateLabel = (() => {
    const l = cursor.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
    return l.charAt(0).toUpperCase() + l.slice(1);
  })();
  const weekLabel = `${formatDate(weekStart, locale)} – ${formatDate(addDays(weekStart, 6), locale)}`;
  const rangeLabel = activeView === "week" ? weekLabel : longDateLabel;
  // Same appointments the grid shows (cancelled and no-shows are not listed).
  const dayList = appointments
    .filter((a) => isSameDay(a.startAt, cursor) && CALENDAR_GRID_STATUSES.includes(a.status))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const visibleDays = weekDays;
  const selectedProfessionalName =
    professionals.find((p) => p.id === selectedProfessionalId)?.fullName ?? null;

  const STATUS_TEXT: Record<string, string> = {
    PENDING: "text-warning",
    CONFIRMED: "text-success",
    IN_PROGRESS: "text-primary",
    COMPLETED: "text-ink-3",
  };

  // Detail actions: ONE main next step by state, the rest behind "⋯".
  type DetailAction = { key: string; label: string; run: () => void; danger?: boolean };
  const apptEditable = detailAppt !== null && canModify(detailAppt);
  let primaryAction: { key: "confirm" | "start" | "charge"; run: () => void } | null = null;
  const moreActions: DetailAction[] = [];
  if (detailAppt) {
    const st = detailAppt.status;
    if (apptEditable && st === "PENDING") {
      primaryAction = { key: "confirm", run: () => void applyStatus("CONFIRMED") };
    } else if (apptEditable && st === "CONFIRMED") {
      primaryAction = { key: "start", run: () => void applyStatus("IN_PROGRESS") };
    } else if (!isProfessional && (st === "IN_PROGRESS" || st === "COMPLETED")) {
      primaryAction = { key: "charge", run: () => void chargeAppointment() };
    }
    if (apptEditable && EDITABLE_STATUSES.includes(st)) {
      moreActions.push({ key: "edit", label: t("femme.calendar.detail.edit"), run: openEditForm });
    }
    if (detailAppt.clientId != null) {
      moreActions.push({
        key: "technical",
        label: t("femme.clients.technicalSheet.open"),
        run: () => setTechnicalSheetClientId(detailAppt.clientId as number),
      });
    }
    if (apptEditable && (st === "PENDING" || st === "CONFIRMED" || st === "IN_PROGRESS")) {
      moreActions.push({
        key: "complete",
        label: t("femme.calendar.action.complete"),
        run: () => void applyStatus("COMPLETED"),
      });
    }
    if (apptEditable && (st === "PENDING" || st === "CONFIRMED")) {
      moreActions.push({
        key: "noshow",
        label: t("femme.calendar.action.noShow"),
        run: () => void applyStatus("NO_SHOW"),
      });
    }
    if (apptEditable && (st === "PENDING" || st === "CONFIRMED" || st === "IN_PROGRESS")) {
      moreActions.push({
        key: "cancel",
        label: t("femme.calendar.action.cancelAppointment"),
        run: openCancelDialog,
        danger: true,
      });
    }
  }

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
          className="min-h-11"
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
            className="min-h-11"
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
                  selected ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink"
                }`}
              >
                <small className={`text-[11px] font-bold uppercase tracking-wider ${selected ? "opacity-85" : "text-ink-3"}`}>
                  {label}
                </small>
                <b className="font-heading text-lg tabular-nums">{date.getDate()}</b>
                {isToday(date) && (
                  <span aria-hidden className={`h-[3px] w-4 rounded ${selected ? "bg-on-primary" : "bg-primary"}`} />
                )}
                <i className={`text-[11px] not-italic ${selected ? "opacity-85" : "text-ink-3"}`}>
                  {n > 0 ? t("femme.calendar.count", { count: n }) : t("femme.calendar.free")}
                </i>
              </button>
            );
          })}
        </div>
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
          {dayList.length === 0 ? (
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
                        {clientLabel}
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
                      </span>
                      <span className="col-start-2 row-start-2 min-w-0 self-start break-words text-sm text-ink-3">
                        <span className={`font-semibold ${STATUS_TEXT[appt.status] ?? "text-ink-3"}`}>
                          {t(`femme.calendar.status.${appt.status}`)}
                        </span>
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
                        · {appt.serviceName} · {appt.professionalName}
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
        <div
          data-tour="calendar-grid"
          style={{
            background: "var(--color-white)",
            borderRadius: "var(--radius-xl)",
            border: "var(--border-default)",
            overflow: "hidden",
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
                          aria-label={`${appt.clientName ?? t("femme.calendar.detail.occasionalClient")} – ${appt.serviceName}${appt.clientBirthdayOnDay ? ` – ${t("femme.calendar.clientBirthday")}` : ""}`}
                        >
                          {(appt.status === "CONFIRMED" || appt.reminderSentAt || appt.clientBirthdayOnDay) && (
                            <span
                              style={{
                                position: "absolute",
                                top: 4,
                                right: 4,
                                display: "flex",
                                alignItems: "center",
                                gap: 3,
                              }}
                            >
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
                              {appt.status === "CONFIRMED" && (
                                <span
                                  aria-hidden="true"
                                  data-testid={`confirmed-check-${appt.id}`}
                                  style={{
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
        onClose={() => {
          if (technicalSheetClientId === null) closeDetail();
        }}
        title={t("femme.calendar.detail.title")}
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" className="min-h-11" onClick={closeDetail}>
              {t("femme.calendar.detail.close")}
            </Button>
            {moreActions.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 min-w-11 px-0 text-lg leading-none"
                aria-label={t("femme.calendar.action.more")}
                aria-expanded={moreOpen}
                data-testid="calendar-more-actions"
                onClick={() => setMoreOpen((o) => !o)}
              >
                ⋯
              </Button>
            )}
            {primaryAction && (
              <Button
                variant="primary"
                className="min-h-11 flex-1"
                disabled={actionBusy}
                data-testid="calendar-next-step"
                onClick={primaryAction.run}
              >
                {t(`femme.calendar.action.${primaryAction.key}`)}
              </Button>
            )}
          </div>
        }
      >
        {detailAppt && (
          <div className="space-y-3 text-sm">
            {!canModify(detailAppt) && (
              <Alert variant="info" data-testid="appointment-read-only-notice">
                {t("femme.calendar.detail.readOnlyOtherProfessional")}
              </Alert>
            )}
            {detailError && (
              <Alert variant="destructive">
                <p>{detailError}</p>
              </Alert>
            )}
            <Row label={t("femme.calendar.detail.client")}>
              {detailAppt.clientName ?? (
                <span className="italic text-ink-3">
                  {t("femme.calendar.detail.occasionalClient")}
                </span>
              )}
              {detailAppt.clientBirthdayOnDay && (
                <span data-testid="appointment-detail-birthday" className="ml-2">
                  🎂 {t("femme.calendar.clientBirthday")}
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
            {detailAppt.reminderSentAt && (
              <Row label={t("femme.calendar.detail.reminderSent")}>
                <span data-testid={`reminder-sent-${detailAppt.id}`}>
                  {formatDateTime(detailAppt.reminderSentAt, locale)}
                </span>
              </Row>
            )}
            {detailAppt.cancelReason && (
              <Row label={t("femme.calendar.detail.cancelReason")}>
                {detailAppt.cancelReason}
              </Row>
            )}
            {moreOpen && moreActions.length > 0 && (
              <div className="flex flex-col border-t border-line pt-2" data-testid="calendar-actions-panel">
                {moreActions.map((a) => (
                  <Button
                    key={a.key}
                    type="button"
                    variant="ghost"
                    disabled={actionBusy}
                    data-testid={`calendar-action-${a.key}`}
                    className={`min-h-11 justify-start ${a.danger ? "text-danger" : ""}`}
                    onClick={a.run}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Cancel appointment (asks for a reason) ── */}
      <Modal
        open={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        title={t("femme.calendar.cancelTitle")}
        footer={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="min-h-11"
              onClick={() => setStatusModalOpen(false)}
              disabled={statusSaving}
            >
              {t("femme.calendar.cancelBack")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              className="min-h-11"
              data-testid="calendar-cancel-confirm"
              onClick={saveStatus}
              disabled={statusSaving}
            >
              {statusSaving ? <Spinner size="sm" /> : t("femme.calendar.cancelConfirm")}
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
            <Label htmlFor="cancel-reason">{t("femme.calendar.cancelDialog.reason")}</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={t("femme.calendar.cancelDialog.reasonPlaceholder")}
              rows={3}
            />
          </div>
        </div>
      </Modal>

      {/* ── New / Edit appointment modal ── */}
      <Modal
        open={formOpen}
        onClose={() => {
          if (technicalSheetClientId === null) setFormOpen(false);
        }}
        title={editAppt ? t("femme.calendar.form.editTitle") : t("femme.calendar.form.title")}
        footer={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
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
            {formClientId !== "" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => setTechnicalSheetClientId(formClientId as number)}
              >
                {t("femme.clients.technicalSheet.view")}
              </Button>
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
          {/* Quick times */}
          <div className="flex flex-wrap gap-2" data-testid="appointment-quick-times">
            {["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setFormTime(q)}
                aria-pressed={formTime === q}
                className={`min-h-10 rounded-full border px-3 text-sm font-bold ${
                  formTime === q ? "border-primary bg-primary-lt text-primary" : "border-line bg-surface text-ink"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </Modal>

      <ClientTechnicalSheetModal
        clientId={technicalSheetClientId}
        onClose={() => setTechnicalSheetClientId(null)}
      />
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
