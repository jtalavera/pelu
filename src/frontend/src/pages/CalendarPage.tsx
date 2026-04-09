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
  EDITABLE_STATUSES,
  ALL_STATUSES,
  createAppointment,
  listAppointments,
  updateAppointment,
  updateAppointmentStatus,
} from "../api/appointments";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";

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

// ── Status badge styles ───────────────────────────────────────────────────────
const STATUS_COLORS: Record<AppointmentStatus, string> = {
  PENDING:
    "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300",
  CONFIRMED:
    "bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300",
  IN_PROGRESS:
    "bg-purple-100 border-purple-300 text-purple-800 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-300",
  COMPLETED:
    "bg-green-100 border-green-300 text-green-800 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300",
  CANCELLED:
    "bg-slate-100 border-slate-300 text-slate-500 dark:bg-slate-700/30 dark:border-slate-600 dark:text-slate-400",
  NO_SHOW:
    "bg-red-100 border-red-300 text-red-700 dark:bg-red-900/30 dark:border-red-700 dark:text-red-400",
};

// ── Types ─────────────────────────────────────────────────────────────────────
type Professional = { id: number; fullName: string; active: boolean };
type SalonService = { id: number; name: string; durationMinutes: number; active: boolean };
type Client = { id: number; fullName: string };

type FormErrors = {
  date?: string;
  time?: string;
  professionalId?: string;
  serviceId?: string;
};

// ── Main component ────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "es" ? "es-PY" : "en-US";

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
    if (!formProfessionalId) errors.professionalId = t("femme.calendar.form.errors.professionalRequired");
    if (!formServiceId) errors.serviceId = t("femme.calendar.form.errors.serviceRequired");
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

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-xl font-bold text-slate-900 dark:text-slate-100">
          {t("femme.calendar.title")}
        </h1>

        {/* Professional filter */}
        <div className="flex items-center gap-2">
          <Label htmlFor="prof-filter" className="sr-only">
            {t("femme.calendar.filterByProfessional")}
          </Label>
          <Select
            id="prof-filter"
            value={selectedProfessionalId ?? ""}
            onChange={(e) =>
              setSelectedProfessionalId(e.target.value ? Number(e.target.value) : null)
            }
            className="w-48"
            aria-label={t("femme.calendar.filterByProfessional")}
          >
            <option value="">{t("femme.calendar.allProfessionals")}</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </Select>
        </div>

        <Button variant="outline" size="sm" onClick={goToday}>
          {t("femme.calendar.today")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={goPrev}
          aria-label={t("femme.calendar.prev")}
        >
          ‹
        </Button>
        <span className="min-w-[150px] text-center text-sm font-medium text-slate-700 dark:text-slate-300">
          {weekLabel}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={goNext}
          aria-label={t("femme.calendar.next")}
        >
          ›
        </Button>

        <Button size="sm" onClick={() => openNewForm()}>
          + {t("femme.calendar.newAppointment")}
        </Button>
      </div>

      {/* Errors */}
      {pageError && (
        <Alert variant="destructive">
          <p>{pageError}</p>
        </Alert>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      )}

      {/* Calendar grid */}
      {!loading && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {/* Day header */}
          <div className="grid border-b border-slate-200 dark:border-slate-700" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
            <div className="border-r border-slate-200 dark:border-slate-700" />
            {weekDays.map(({ key, label, date }) => (
              <div
                key={key}
                className={`border-r border-slate-200 py-2 text-center last:border-r-0 dark:border-slate-700`}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {label}
                </p>
                <p
                  className={`text-sm font-semibold ${
                    isToday(date)
                      ? "flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-white mx-auto"
                      : "text-slate-900 dark:text-slate-100"
                  }`}
                >
                  {date.getDate()}
                </p>
              </div>
            ))}
          </div>

          {/* Scrollable time grid */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="grid" style={{ gridTemplateColumns: "56px repeat(7, 1fr)", height: GRID_HEIGHT }}>
              {/* Time labels */}
              <div className="relative border-r border-slate-200 dark:border-slate-700">
                {Array.from({ length: TOTAL_HOURS }).map((_, i) => {
                  const hour = HOUR_START + i;
                  return (
                    <div
                      key={hour}
                      className="absolute right-2 -translate-y-1/2 text-right text-xs text-slate-400 dark:text-slate-500"
                      style={{ top: i * PX_PER_HOUR }}
                    >
                      {String(hour).padStart(2, "0")}:00
                    </div>
                  );
                })}
              </div>

              {/* Day columns */}
              {weekDays.map(({ key, date }) => {
                const dayAppts = appointments.filter((a) => isSameDay(a.startAt, date));

                return (
                  <div
                    key={key}
                    className="relative border-r border-slate-200 last:border-r-0 dark:border-slate-700"
                    style={{ height: GRID_HEIGHT }}
                  >
                    {/* Hour grid lines */}
                    {Array.from({ length: TOTAL_HOURS }).map((_, i) => (
                      <div
                        key={i}
                        className="absolute inset-x-0 border-t border-slate-100 dark:border-slate-800"
                        style={{ top: i * PX_PER_HOUR }}
                      />
                    ))}
                    {/* Half-hour lines */}
                    {Array.from({ length: TOTAL_HOURS }).map((_, i) => (
                      <div
                        key={`h${i}`}
                        className="absolute inset-x-0 border-t border-dashed border-slate-50 dark:border-slate-800/50"
                        style={{ top: i * PX_PER_HOUR + PX_PER_HOUR / 2 }}
                      />
                    ))}

                    {/* Click to create new appointment */}
                    <button
                      type="button"
                      className="absolute inset-0 w-full"
                      style={{ zIndex: 0 }}
                      onClick={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const relY = e.clientY - rect.top;
                        const hour = Math.floor(relY / PX_PER_HOUR) + HOUR_START;
                        openNewForm(date, hour);
                      }}
                      aria-label={t("femme.calendar.newAppointment")}
                    />

                    {/* Appointments */}
                    {dayAppts.map((appt) => {
                      const top = appointmentTopPx(appt.startAt);
                      const height = appointmentHeightPx(appt.durationMinutes);
                      const colorClass = STATUS_COLORS[appt.status] ?? STATUS_COLORS.PENDING;
                      return (
                        <button
                          key={appt.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(appt);
                          }}
                          className={`absolute inset-x-0.5 overflow-hidden rounded border px-1 py-0.5 text-left text-xs transition-opacity hover:opacity-90 ${colorClass}`}
                          style={{ top, height, zIndex: 10 }}
                          aria-label={`${appt.clientName ?? t("femme.calendar.detail.occasionalClient")} – ${appt.serviceName}`}
                        >
                          <p className="truncate font-semibold">
                            {appt.clientName ?? t("femme.calendar.detail.occasionalClient")}
                          </p>
                          <p className="truncate opacity-80">{appt.serviceName}</p>
                          <p className="truncate opacity-70">{appt.professionalName}</p>
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
            <Row label={t("femme.calendar.detail.professional")}>{detailAppt.professionalName}</Row>
            <Row label={t("femme.calendar.detail.service")}>
              {detailAppt.serviceName} —{" "}
              {t("femme.calendar.detail.duration", { minutes: detailAppt.durationMinutes })}
            </Row>
            <Row label={t("femme.calendar.detail.date")}>
              {formatDateTime(detailAppt.startAt, locale)}
            </Row>
            <Row label={t("femme.calendar.detail.status")}>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[detailAppt.status]}`}
              >
                {t(`femme.calendar.status.${detailAppt.status}`)}
              </span>
            </Row>
            {detailAppt.cancelReason && (
              <Row label={t("femme.calendar.detail.cancelReason")}>{detailAppt.cancelReason}</Row>
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
              aria-invalid={!!formErrors.date}
              aria-describedby={formErrors.date ? "form-date-err" : undefined}
              className="flex min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-indigo-400"
            />
            {formErrors.date && (
              <FieldValidationError id="form-date-err">{formErrors.date}</FieldValidationError>
            )}
          </div>

          {/* Time */}
          <div className="space-y-1">
            <Label htmlFor="form-time">{t("femme.calendar.form.time")}</Label>
            <input
              id="form-time"
              type="time"
              value={formTime}
              onChange={(e) => setFormTime(e.target.value)}
              aria-invalid={!!formErrors.time}
              aria-describedby={formErrors.time ? "form-time-err" : undefined}
              className="flex min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-indigo-400"
            />
            {formErrors.time && (
              <FieldValidationError id="form-time-err">{formErrors.time}</FieldValidationError>
            )}
          </div>

          {/* Professional */}
          <div className="space-y-1">
            <Label htmlFor="form-professional">{t("femme.calendar.form.professional")}</Label>
            <Select
              id="form-professional"
              value={formProfessionalId}
              onChange={(e) => setFormProfessionalId(e.target.value ? Number(e.target.value) : "")}
              invalid={!!formErrors.professionalId}
              aria-invalid={!!formErrors.professionalId}
              aria-describedby={formErrors.professionalId ? "form-prof-err" : undefined}
            >
              <option value="">{t("femme.calendar.form.selectProfessional")}</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </Select>
            {formErrors.professionalId && (
              <FieldValidationError id="form-prof-err">
                {formErrors.professionalId}
              </FieldValidationError>
            )}
          </div>

          {/* Service */}
          <div className="space-y-1">
            <Label htmlFor="form-service">{t("femme.calendar.form.service")}</Label>
            <Select
              id="form-service"
              value={formServiceId}
              onChange={(e) => setFormServiceId(e.target.value ? Number(e.target.value) : "")}
              invalid={!!formErrors.serviceId}
              aria-invalid={!!formErrors.serviceId}
              aria-describedby={formErrors.serviceId ? "form-svc-err" : undefined}
            >
              <option value="">{t("femme.calendar.form.selectService")}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMinutes} min)
                </option>
              ))}
            </Select>
            {formErrors.serviceId && (
              <FieldValidationError id="form-svc-err">{formErrors.serviceId}</FieldValidationError>
            )}
          </div>

          {/* Client (optional) */}
          <div className="space-y-1">
            <Label htmlFor="form-client">{t("femme.calendar.form.client")}</Label>
            <Select
              id="form-client"
              value={formClientId}
              onChange={(e) => setFormClientId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">{t("femme.calendar.form.occasionalClient")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Helper sub-component ──────────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-28 shrink-0 font-medium text-slate-600 dark:text-slate-400">{label}</span>
      <span className="text-slate-900 dark:text-slate-100">{children}</span>
    </div>
  );
}
