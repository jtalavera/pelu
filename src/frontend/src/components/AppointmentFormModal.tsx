import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Modal, Spinner, TimeCombobox } from "@design-system";
import {
  Appointment,
  AppointmentCreateRequest,
  AppointmentUpdateRequest,
  createAppointment,
  updateAppointment,
} from "../api/appointments";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { withDisplayNames } from "../lib/professionalDisplay";
import { useMe } from "../hooks/useMe";
import { FieldValidationError } from "./FieldValidationError";
import { LocalizedDateInput } from "./LocalizedDateInput";
import { SearchableSelect } from "./SearchableSelect";
import { ClientTechnicalSheetModal } from "./ClientTechnicalSheetModal";

const MIN_DURATION = 5;
const MAX_DURATION = 480;
const DURATION_STEP = 5;
const DURATION_PRESETS = [30, 45, 60, 90, 120];

/** One step up / down, rounded to the step grid and kept inside the allowed range. */
function stepDuration(current: number | "", delta: number): number {
  const base = current === "" ? 0 : current;
  const next = delta > 0 ? Math.floor(base / DURATION_STEP) * DURATION_STEP + DURATION_STEP : Math.ceil(base / DURATION_STEP) * DURATION_STEP - DURATION_STEP;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, next));
}

function formatDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatLocalYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toLocalDatetimeString(date: Date, time: string): string {
  return `${formatDateIso(date)}T${time}:00`;
}

function toUtcIsoString(localDatetime: string): string {
  return new Date(localDatetime).toISOString();
}

type ProfSchedule = { dayOfWeek: number; startTime: string; endTime: string; active: boolean };
type Professional = { id: number; fullName: string; displayName?: string | null; active: boolean; schedules?: ProfSchedule[] };
type SalonService = { id: number; name: string; durationMinutes: number; active: boolean };
type Client = { id: number; fullName: string };

type FormErrors = {
  date?: string;
  time?: string;
  startInPast?: string;
  professionalId?: string;
  serviceId?: string;
  duration?: string;
};

/**
 * «Nuevo turno» / «Editar turno» dialog, shared by the Agenda and the Inicio so a turno can be
 * booked without leaving the page you are on.
 */
export function AppointmentFormModal({
  open,
  onClose,
  editAppointment = null,
  initialDate,
  initialHour,
  initialProfessionalId = null,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** When set the dialog edits this turno; otherwise it creates one. */
  editAppointment?: Appointment | null;
  /** Local day (YYYY-MM-DD) preselected for a new turno; defaults to today. */
  initialDate?: string;
  /** Hour (0–23) preselected for a new turno. */
  initialHour?: number;
  initialProfessionalId?: number | null;
  onSaved: (appointment: Appointment, mode: "created" | "updated") => void;
}) {
  const { t } = useTranslation();
  const { me } = useMe();
  const isProfessional = me?.role === "PROFESSIONAL";

  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [services, setServices] = useState<SalonService[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [technicalSheetClientId, setTechnicalSheetClientId] = useState<number | null>(null);

  const [formDate, setFormDate] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formProfessionalId, setFormProfessionalId] = useState<number | "">("");
  const [formServiceId, setFormServiceId] = useState<number | "">("");
  /** Length of the turno being created / edited, in minutes (starts as the service's own). */
  const [formDuration, setFormDuration] = useState<number | "">("");
  const [formClientId, setFormClientId] = useState<number | "">("");
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [formSaving, setFormSaving] = useState(false);
  const [formApiError, setFormApiError] = useState<string | null>(null);

  // Reset the fields every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (editAppointment) {
      const d = new Date(editAppointment.startAt);
      setFormDate(formatDateIso(d));
      setFormTime(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      );
      setFormProfessionalId(editAppointment.professionalId);
      setFormServiceId(editAppointment.serviceId);
      setFormDuration(editAppointment.durationMinutes);
      setFormClientId(editAppointment.clientId ?? "");
    } else {
      setFormDate(initialDate ?? formatLocalYmd(new Date()));
      setFormTime(initialHour != null ? `${String(initialHour).padStart(2, "0")}:00` : "");
      setFormProfessionalId(
        isProfessional && me?.professionalId != null ? me.professionalId : (initialProfessionalId ?? ""),
      );
      setFormServiceId("");
      setFormDuration("");
      setFormClientId("");
    }
    setFormErrors({});
    setFormApiError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load professionals, services and (active only — inactive clients must not be assignable) clients.
  useEffect(() => {
    if (!open) return;
    Promise.all([
      femmeJson<Professional[]>("/api/professionals"),
      femmeJson<SalonService[]>("/api/services?kind=SERVICE"),
    ])
      .then(([profs, svcs]) => {
        setProfessionals(withDisplayNames(profs).filter((p) => p.active));
        setServices(svcs.filter((s) => s.active));
      })
      .catch(() => {});
    femmeJson<Client[]>("/api/clients?q=&active=true")
      .then((c) => setClients(c))
      .catch(() => {});
  }, [open]);

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

  // ── Form validation ─────────────────────────────────────────────────────────
  const validateForm = (): boolean => {
    const errors: FormErrors = {};
    if (!formDate) errors.date = t("femme.calendar.form.errors.dateRequired");
    if (!formTime) errors.time = t("femme.calendar.form.errors.timeRequired");
    if (!formProfessionalId)
      errors.professionalId = t("femme.calendar.form.errors.professionalRequired");
    if (!formServiceId) errors.serviceId = t("femme.calendar.form.errors.serviceRequired");
    if (
      formDuration === "" ||
      !Number.isInteger(formDuration) ||
      formDuration < MIN_DURATION ||
      formDuration > MAX_DURATION
    ) {
      errors.duration = t("femme.calendar.form.errors.duration", { min: MIN_DURATION, max: MAX_DURATION });
    }
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
      if (editAppointment) {
        const req: AppointmentUpdateRequest = {
          clientId,
          professionalId: formProfessionalId as number,
          serviceId: formServiceId as number,
          startAt,
          durationMinutes: formDuration as number,
        };
        updated = await updateAppointment(editAppointment.id, req);
      } else {
        const req: AppointmentCreateRequest = {
          clientId,
          professionalId: formProfessionalId as number,
          serviceId: formServiceId as number,
          startAt,
          durationMinutes: formDuration as number,
        };
        updated = await createAppointment(req);
      }
      onSaved(updated, editAppointment ? "updated" : "created");
      onClose();
    } catch (err) {
      setFormApiError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setFormSaving(false);
    }
  };

  // End time next to the duration ("11:00 → 12:00") and, when she changed it, the service's own length.
  const durationEnd = (() => {
    if (!formTime || formDuration === "" || formDuration < MIN_DURATION) return null;
    const [hh, mm] = formTime.split(":").map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    const total = hh * 60 + mm + formDuration;
    return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  })();
  const durationServiceNote = (() => {
    const svc = services.find((s) => s.id === formServiceId);
    return svc && formDuration !== "" && formDuration !== svc.durationMinutes
      ? t("femme.calendar.form.durationServiceNote", { minutes: svc.durationMinutes })
      : "";
  })();

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          if (technicalSheetClientId === null) onClose();
        }}
        title={editAppointment ? t("femme.calendar.form.editTitle") : t("femme.calendar.form.title")}
        footer={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onClose()}
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
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-primary">{t("femme.calendar.form.sectionWho")}</h3>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Service */}
          <div className="space-y-1">
            <SearchableSelect<number>
              id="form-service"
              label={t("femme.calendar.form.service")}
              value={formServiceId}
              onChange={(v) => {
                setFormServiceId(v);
                // The turno starts with the service's own duration; she can change it below.
                const svc = services.find((s) => s.id === v);
                if (svc) setFormDuration(svc.durationMinutes);
              }}
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
          </div>
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-primary" >{t("femme.calendar.form.sectionWhen")}</h3>
          <div className="grid grid-cols-2 gap-3">
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
          {/* Duration: starts as the service's, adjustable (a turno can run long) */}
          <div className="space-y-2 rounded-card border border-line bg-page p-3" data-testid="appointment-duration">
            <Label htmlFor="form-duration">{t("femme.calendar.form.duration")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label={t("femme.calendar.form.durationDecrease")}
                data-testid="appointment-duration-minus"
                onClick={() => setFormDuration(stepDuration(formDuration, -DURATION_STEP))}
                className="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-primary font-heading text-xl font-extrabold leading-none text-primary"
              >
                −
              </button>
              <Input
                id="form-duration"
                type="number"
                inputMode="numeric"
                min={MIN_DURATION}
                max={MAX_DURATION}
                step={DURATION_STEP}
                value={formDuration}
                onChange={(e) => setFormDuration(e.target.value === "" ? "" : Math.floor(Number(e.target.value)))}
                aria-invalid={!!formErrors.duration}
                aria-describedby={formErrors.duration ? "form-duration-err" : "form-duration-hint"}
                data-testid="appointment-duration-input"
                className="w-24 text-center tabular-nums"
              />
              <span className="text-sm text-ink-3">{t("femme.calendar.form.durationUnit")}</span>
              <button
                type="button"
                aria-label={t("femme.calendar.form.durationIncrease")}
                data-testid="appointment-duration-plus"
                onClick={() => setFormDuration(stepDuration(formDuration, DURATION_STEP))}
                className="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-primary font-heading text-xl font-extrabold leading-none text-primary"
              >
                +
              </button>
              {durationEnd ? (
                <span
                  className="ml-auto text-sm font-bold text-ink-2"
                  data-testid="appointment-duration-ends"
                  aria-label={t("femme.calendar.form.durationEnds", { time: durationEnd })}
                >
                  {formTime} → <b className="text-ink">{durationEnd}</b>
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2" data-testid="appointment-duration-presets">
              {DURATION_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFormDuration(m)}
                  aria-pressed={formDuration === m}
                  className={`min-h-10 rounded-full border px-3 text-sm font-bold ${
                    formDuration === m ? "border-primary bg-primary-lt text-primary" : "border-line bg-surface text-ink"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {formErrors.duration ? (
              <FieldValidationError id="form-duration-err">{formErrors.duration}</FieldValidationError>
            ) : (
              <p id="form-duration-hint" className="text-xs text-ink-3" data-testid="appointment-duration-hint">
                {durationServiceNote}
              </p>
            )}
          </div>
        </div>
      </Modal>

      <ClientTechnicalSheetModal
        clientId={technicalSheetClientId}
        onClose={() => setTechnicalSheetClientId(null)}
      />
    </>
  );
}
