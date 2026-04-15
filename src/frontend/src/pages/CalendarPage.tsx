import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Label,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@design-system";
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
import { FemmeNativeTimeInput } from "../components/FemmeNativeTimeInput";
import { FieldValidationError } from "../components/FieldValidationError";
import { SearchableSelect } from "../components/SearchableSelect";
import { StatusBadge } from "../components/StatusBadge";
import { getDateLocale } from "../i18n/dateLocale";

// ── Calendar constants ────────────────────────────────────────────────────────
const HOUR_START = 7;
const HOUR_END = 21;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const PX_PER_HOUR = 64;
const GRID_HEIGHT = TOTAL_HOURS * PX_PER_HOUR;

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
type Professional = { id: number; fullName: string; active: boolean };
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

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
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

  const scrollRef = useRef<HTMLDivElement>(null);

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
        setProfessionals(profs.filter((p) => p.active));
        setServices(svcs.filter((s) => s.active));
      })
      .catch(() => {});
  }, []);

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
  const goToday = () => setWeekStart(startOfWeek(new Date()));

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
    setFormProfessionalId(selectedProfessionalId ?? "");
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

        {/* Professional filter */}
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

        {/* Today */}
        <button
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

        {/* Week navigation */}
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

        {/* New appointment — pushed right */}
        <button
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
              gridTemplateColumns: "52px repeat(7, 1fr)",
              borderBottom: "var(--border-default)",
            }}
          >
            <div
              style={{
                borderRight: "var(--border-default)",
                background: "var(--color-stone)",
              }}
            />
            {weekDays.map(({ key, label, date }, dayIdx) => (
              <div
                key={key}
                style={{
                  padding: "10px 8px",
                  textAlign: "center",
                  fontSize: 11,
                  color: "var(--color-ink-3)",
                  background: "var(--color-stone)",
                  borderRight: dayIdx < 6 ? "var(--border-default)" : "none",
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
                gridTemplateColumns: "52px repeat(7, 1fr)",
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
              {weekDays.map(({ key, date }) => {
                const dayAppts = appointments
                  .filter((a) => isSameDay(a.startAt, date))
                  .filter((a) => CALENDAR_GRID_STATUSES.includes(a.status));
                const overlapLayout = layoutOverlappingInDay(dayAppts);
                return (
                  <div
                    key={key}
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
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background =
                          "var(--color-rose-lt)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                      }}
                      aria-label={t("femme.calendar.newAppointment")}
                    />

                    {/* Appointment blocks */}
                    {dayAppts.map((appt) => {
                      const top = appointmentTopPx(appt.startAt);
                      const height = appointmentHeightPx(appt.durationMinutes);
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
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(appt);
                          }}
                          onMouseEnter={() => setHoveredApptId(appt.id)}
                          onMouseLeave={() => setHoveredApptId(null)}
                          style={{
                            position: "absolute",
                            left: `${leftPct}%`,
                            width: hovered ? "min(260px, calc(100% - 4px))" : `calc(${widthPct}% - 4px)`,
                            marginLeft: 2,
                            top,
                            height,
                            zIndex: hovered ? 60 : 10,
                            borderRadius: "var(--radius-md)",
                            padding: hovered ? 10 : 6,
                            fontSize: hovered ? 13 : 11,
                            cursor: "pointer",
                            background: pc.bg,
                            border: "none",
                            borderLeft: `3px solid ${pc.border}`,
                            color: pc.color,
                            textAlign: "left",
                            overflow: hovered ? "visible" : "hidden",
                            boxShadow: hovered
                              ? "0 10px 28px rgba(0, 0, 0, 0.18)"
                              : undefined,
                          }}
                          aria-label={`${appt.clientName ?? t("femme.calendar.detail.occasionalClient")} – ${appt.serviceName}`}
                        >
                          <p
                            style={{
                              fontWeight: 500,
                              margin: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {appt.clientName ?? t("femme.calendar.detail.occasionalClient")}
                          </p>
                          <p
                            style={{
                              fontSize: 10,
                              margin: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              opacity: 0.85,
                            }}
                          >
                            {appt.serviceName}
                          </p>
                          <p
                            style={{
                              fontSize: 10,
                              margin: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
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
          {/* Date */}
          <div className="space-y-1">
            <Label htmlFor="form-date">{t("femme.calendar.form.date")}</Label>
            <input
              id="form-date"
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              aria-invalid={!!(formErrors.date || formErrors.startInPast)}
              aria-describedby={
                [formErrors.date && "form-date-err", formErrors.startInPast && "form-start-past-err"]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              className="flex min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-indigo-400"
            />
            {formErrors.date && (
              <FieldValidationError id="form-date-err">{formErrors.date}</FieldValidationError>
            )}
          </div>
          {/* Time */}
          <div className="space-y-1">
            <Label htmlFor="form-time">{t("femme.calendar.form.time")}</Label>
            <FemmeNativeTimeInput
              id="form-time"
              value={formTime}
              onChange={(e) => setFormTime(e.target.value)}
              invalid={!!(formErrors.time || formErrors.startInPast)}
              aria-invalid={!!(formErrors.time || formErrors.startInPast)}
              aria-describedby={
                [formErrors.time && "form-time-err", formErrors.startInPast && "form-start-past-err"]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            />
            {formErrors.time && (
              <FieldValidationError id="form-time-err">{formErrors.time}</FieldValidationError>
            )}
            {formErrors.startInPast && (
              <FieldValidationError id="form-start-past-err">{formErrors.startInPast}</FieldValidationError>
            )}
          </div>
          {/* Professional */}
          <div className="space-y-1">
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
