import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Button, Label, Modal, Spinner, Textarea } from "@design-system";
import {
  EDITABLE_STATUSES,
  updateAppointmentStatus,
  type Appointment,
  type AppointmentStatus,
} from "../api/appointments";
import { createServiceRecordFromAppointment, getServiceRecord } from "../api/serviceRecords";
import { translateApiError } from "../api/parseApiErrorMessage";
import { getDateLocale } from "../i18n/dateLocale";
import { useMe } from "../hooks/useMe";
import { billingStateForAppointment } from "../lib/appointmentBilling";
import { billServiceRecord } from "../lib/serviceRecordBilling";
import {
  AppointmentFichaAction,
  fichaActionKind,
  type AppointmentFichaActionHandle,
} from "./AppointmentFichaAction";
import { AppointmentFormModal } from "./AppointmentFormModal";
import { ClientTechnicalSheetModal } from "./ClientTechnicalSheetModal";
import { InvoiceDetailModal } from "./InvoiceDetailModal";
import { MoreActionsMenu } from "./MoreActionsMenu";
import { ServiceRecordDetailModal } from "./ServiceRecordDetailModal";
import { StatusBadge } from "./StatusBadge";
import { ACTION_BUTTON } from "./actionButtons";
import { ActionIcon } from "./actionIcons";

function formatDateTime(isoString: string, locale: string): string {
  return new Date(isoString).toLocaleString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const FIELD_LABEL = "text-[11px] font-extrabold uppercase tracking-wider text-primary";

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className={FIELD_LABEL}>{label}</dt>
      <dd className="m-0 break-words text-ink">{children}</dd>
    </div>
  );
}

/** True from the `sm` breakpoint up (the web layout); false on a phone. */
function useIsWide(): boolean {
  const query = "(min-width: 640px)";
  const [wide, setWide] = useState(
    () => typeof window === "undefined" || !window.matchMedia || window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setWide(e.matches);
    setWide(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return wide;
}

type DetailAction = { key: string; label: string; icon?: ReactNode; run: () => void; danger?: boolean };

/**
 * The turno's detail dialog (next step, ficha, comprobante, edit, cancel with a reason, technical
 * sheet), shared by the Agenda and the Inicio so a turno opens in place on either page.
 *
 * The host keeps `appointment` set while the dialog is open and gets `onChanged` after every change
 * (status, ficha, edit) so it can refresh its own list; `onClose` ends the whole flow.
 */
export function AppointmentDetailModal({
  appointment,
  onClose,
  onChanged,
}: {
  appointment: Appointment | null;
  onClose: () => void;
  /** `updated` is the turno as it is now when the change returned it; `kind` says what changed. */
  onChanged: (updated?: Appointment, kind?: "status" | "edited") => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = getDateLocale(i18n);
  const navigate = useNavigate();
  const { me } = useMe();
  const isProfessional = me?.role === "PROFESSIONAL";

  const isWide = useIsWide();
  const fichaRef = useRef<AppointmentFichaActionHandle>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [openRecordId, setOpenRecordId] = useState<number | null>(null);
  const [viewInvoiceId, setViewInvoiceId] = useState<number | null>(null);
  const [technicalSheetClientId, setTechnicalSheetClientId] = useState<number | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const appointmentId = appointment?.id ?? null;
  useEffect(() => {
    setDetailError(null);
    setMoreOpen(false);
    setEditing(false);
    setOpenRecordId(null);
    setViewInvoiceId(null);
    setCancelOpen(false);
  }, [appointmentId]);

  // A professional modifies only her own turnos (the backend enforces the same rule).
  const canModify = (appt: Appointment) =>
    !isProfessional || (me?.professionalId != null && appt.professionalId === me.professionalId);

  const openCancelDialog = () => {
    if (!appointment) return;
    setCancelReason(appointment.cancelReason ?? "");
    setStatusError(null);
    setMoreOpen(false);
    setCancelOpen(true);
  };

  /** Moves the open turno to `status` (no reason unless cancelling). */
  const applyStatus = async (status: AppointmentStatus, reason: string | null = null) => {
    if (!appointment) return;
    setStatusSaving(true);
    setActionBusy(true);
    setStatusError(null);
    setDetailError(null);
    try {
      const updated = await updateAppointmentStatus(appointment.id, {
        status,
        cancelReason: status === "CANCELLED" ? reason || null : null,
      });
      onChanged(updated, "status");
      setCancelOpen(false);
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

  /**
   * "Cobrar" always goes through the turno's ficha: its own, or one created right now. (An old
   * Atendido turno with no ficha keeps the previous behaviour: the booked service as the only line.)
   */
  const chargeAppointment = async () => {
    if (!appointment) return;
    setActionBusy(true);
    setDetailError(null);
    try {
      if (appointment.serviceRecordId) {
        await billServiceRecord(navigate, await getServiceRecord(appointment.serviceRecordId));
      } else if (appointment.status === "IN_PROGRESS") {
        await billServiceRecord(navigate, await createServiceRecordFromAppointment(appointment.id));
      } else {
        navigate("/app/billing", { state: await billingStateForAppointment(appointment) });
      }
    } catch {
      setDetailError(t("femme.calendar.chargeError"));
    } finally {
      setActionBusy(false);
    }
  };

  // Detail actions: ONE main next step by state, the rest behind "⋯".
  let primaryAction: { key: "confirm" | "start" | "charge"; run: () => void } | null = null;
  const moreActions: DetailAction[] = [];
  if (appointment) {
    const st = appointment.status;
    const apptEditable = canModify(appointment);
    if (apptEditable && st === "PENDING") {
      primaryAction = { key: "confirm", run: () => void applyStatus("CONFIRMED") };
    } else if (apptEditable && st === "CONFIRMED") {
      primaryAction = { key: "start", run: () => void applyStatus("IN_PROGRESS") };
    } else if (!isProfessional && appointment.invoiceId == null && (st === "IN_PROGRESS" || st === "COMPLETED")) {
      // Not charged yet. (Once charged there is no second «Cobrar»: the comprobante is one of the
      // two document tiles of the body.)
      primaryAction = { key: "charge", run: () => void chargeAppointment() };
    }
    if (apptEditable && EDITABLE_STATUSES.includes(st)) {
      moreActions.push({
        key: "edit",
        label: t("femme.calendar.detail.edit"),
        icon: <ActionIcon name="edit" />,
        run: () => {
          setMoreOpen(false);
          setEditing(true);
        },
      });
    }
    if (appointment.clientId != null) {
      moreActions.push({
        key: "technical",
        icon: <ActionIcon name="file" />,
        label: t("femme.clients.technicalSheet.open"),
        run: () => setTechnicalSheetClientId(appointment.clientId as number),
      });
    }
    if (apptEditable && (st === "PENDING" || st === "CONFIRMED" || st === "IN_PROGRESS")) {
      moreActions.push({
        key: "complete",
        icon: <ActionIcon name="check" />,
        label: t("femme.calendar.action.complete"),
        run: () => void applyStatus("COMPLETED"),
      });
    }
    if (apptEditable && (st === "PENDING" || st === "CONFIRMED")) {
      moreActions.push({
        key: "noshow",
        icon: <ActionIcon name="userX" />,
        label: t("femme.calendar.action.noShow"),
        run: () => void applyStatus("NO_SHOW"),
      });
    }
    if (apptEditable && (st === "PENDING" || st === "CONFIRMED" || st === "IN_PROGRESS")) {
      moreActions.push({
        key: "cancel",
        icon: <ActionIcon name="ban" />,
        label: t("femme.calendar.action.cancelAppointment"),
        run: openCancelDialog,
        danger: true,
      });
    }
  }

  const fichaKind = appointment !== null && canModify(appointment) ? fichaActionKind(appointment) : null;
  const showFicha = fichaKind !== null;
  const showInvoice = appointment !== null && !isProfessional && appointment.invoiceId != null;
  // On a phone the ficha and the comprobante live inside «Más acciones» (first two options); on the
  // web they are buttons of the footer.
  const menuActions: DetailAction[] = [...moreActions];
  if (!isWide && appointment) {
    const docs: DetailAction[] = [];
    if (showFicha) {
      docs.push({
        key: "ficha",
        icon: <ActionIcon name="file" />,
        label: t(
          fichaKind === "go"
            ? "femme.appointmentFicha.go"
            : fichaKind === "createOccasional"
              ? "femme.appointmentFicha.createOccasional"
              : "femme.appointmentFicha.createOrAssign",
        ),
        run: () => fichaRef.current?.trigger(),
      });
    }
    if (showInvoice) {
      docs.push({
        key: "invoice",
        icon: <ActionIcon name="file" />,
        label: t("femme.calendar.action.viewInvoice"),
        run: () => setViewInvoiceId(appointment.invoiceId as number),
      });
    }
    menuActions.unshift(...docs);
  }

  return (
    <>
      {/* ── Appointment detail modal ── */}
      <Modal
        open={appointment !== null && !editing}
        onClose={() => {
          if (technicalSheetClientId === null && openRecordId === null && viewInvoiceId === null && !cancelOpen) {
            onClose();
          }
        }}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {t("femme.calendar.detail.title")}
            {appointment ? <StatusBadge status={appointment.status} /> : null}
          </span>
        }
        footer={
          isWide ? (
            // Web: «Cerrar» first, then the ficha and the comprobante, the next step and «⋯».
            <div className="flex w-full flex-wrap items-center gap-2">
              <Button size="md" variant="secondary" className={ACTION_BUTTON} onClick={onClose}>
                {t("femme.calendar.detail.close")}
              </Button>
              {showFicha && appointment ? (
                <AppointmentFichaAction
                  ref={fichaRef}
                  compact
                  appt={appointment}
                  testIdPrefix="calendar-appointment-ficha"
                  className={ACTION_BUTTON}
                  onOpenRecord={setOpenRecordId}
                  onChanged={() => onChanged()}
                />
              ) : null}
              {showInvoice && appointment ? (
                <Button
                  type="button"
                  size="md"
                  variant="outline"
                  className={ACTION_BUTTON}
                  data-testid="appointment-view-invoice"
                  // The comprobante opens right here, on top of the turno: no trip to Facturación.
                  onClick={() => setViewInvoiceId(appointment.invoiceId as number)}
                >
                  {t("femme.calendar.action.invoiceShort")}
                </Button>
              ) : null}
              {primaryAction ? (
                <Button
                  variant="primary"
                  className={`${ACTION_BUTTON} flex-1`}
                  disabled={actionBusy}
                  data-testid="calendar-next-step"
                  onClick={primaryAction.run}
                >
                  {t(`femme.calendar.action.${primaryAction.key}`)}
                </Button>
              ) : (
                <span className="flex-1" aria-hidden="true" />
              )}
              {menuActions.length > 0 && (
                <MoreActionsMenu
                  compact
                  label={t("femme.calendar.action.more")}
                  open={moreOpen}
                  onOpenChange={setMoreOpen}
                  triggerTestId="calendar-more-actions"
                  menuTestId="calendar-actions-panel"
                  disabled={actionBusy}
                  items={menuActions.map((a) => ({
                    id: a.key,
                    label: a.label,
                    icon: a.icon,
                    destructive: a.danger,
                    testId: `calendar-action-${a.key}`,
                    onSelect: a.run,
                  }))}
                />
              )}
            </div>
          ) : (
            // Phone: the next step on top, then «Cerrar» and «Más acciones» (the ficha and the
            // comprobante are its first options).
            <div className="flex w-full flex-wrap items-center gap-2">
              {primaryAction ? (
                <Button
                  variant="primary"
                  className={`${ACTION_BUTTON} w-full`}
                  disabled={actionBusy}
                  data-testid="calendar-next-step"
                  onClick={primaryAction.run}
                >
                  {t(`femme.calendar.action.${primaryAction.key}`)}
                </Button>
              ) : null}
              <Button size="md" variant="secondary" className={`${ACTION_BUTTON} flex-1`} onClick={onClose}>
                {t("femme.calendar.detail.close")}
              </Button>
              {menuActions.length > 0 && (
                <MoreActionsMenu
                  className="flex-1 [&>button]:w-full"
                  label={t("femme.calendar.action.more")}
                  open={moreOpen}
                  onOpenChange={setMoreOpen}
                  triggerTestId="calendar-more-actions"
                  menuTestId="calendar-actions-panel"
                  disabled={actionBusy}
                  items={menuActions.map((a) => ({
                    id: a.key,
                    label: a.label,
                    icon: a.icon,
                    destructive: a.danger,
                    testId: `calendar-action-${a.key}`,
                    onSelect: a.run,
                  }))}
                />
              )}
            </div>
          )
        }
      >
        {appointment && (
          <div className="space-y-4 text-sm">
            {!canModify(appointment) && (
              <Alert variant="info" data-testid="appointment-read-only-notice">
                {t("femme.calendar.detail.readOnlyOtherProfessional")}
              </Alert>
            )}
            {detailError && (
              <Alert variant="destructive">
                <p>{detailError}</p>
              </Alert>
            )}

            {/* Who: the client first and biggest. */}
            <div>
              <div className={FIELD_LABEL}>{t("femme.calendar.detail.client")}</div>
              <div className="break-words font-heading text-xl font-extrabold leading-tight text-ink">
                {appointment.clientName ?? (
                  <span className="text-base font-semibold italic text-ink-3">
                    {t("femme.calendar.detail.occasionalClient")}
                  </span>
                )}
                {appointment.clientBirthdayOnDay && (
                  <span data-testid="appointment-detail-birthday" className="ml-2 text-sm font-semibold">
                    🎂 {t("femme.calendar.clientBirthday")}
                  </span>
                )}
              </div>
            </div>

            {/* What, when and with whom. */}
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label={t("femme.calendar.detail.professional")}>{appointment.professionalName}</Field>
              <Field label={t("femme.calendar.detail.service")}>
                {appointment.serviceName} ·{" "}
                {t("femme.calendar.detail.duration", { minutes: appointment.durationMinutes })}
              </Field>
              <Field label={t("femme.calendar.detail.date")} wide>
                {formatDateTime(appointment.startAt, locale)}
              </Field>
              {appointment.reminderSentAt && (
                <Field label={t("femme.calendar.detail.reminderSent")} wide>
                  <span data-testid={`reminder-sent-${appointment.id}`}>
                    {formatDateTime(appointment.reminderSentAt, locale)}
                  </span>
                </Field>
              )}
              {appointment.cancelReason && (
                <Field label={t("femme.calendar.detail.cancelReason")} wide>
                  {appointment.cancelReason}
                </Field>
              )}
            </dl>

            {/* Phone: the ficha's own dialogs (create / assign) live here; the button is a menu option. */}
            {!isWide && showFicha ? (
              <AppointmentFichaAction
                ref={fichaRef}
                hideButton
                appt={appointment}
                testIdPrefix="calendar-appointment-ficha"
                onOpenRecord={setOpenRecordId}
                onChanged={() => onChanged()}
              />
            ) : null}
          </div>
        )}
      </Modal>

      {viewInvoiceId !== null ? (
        <InvoiceDetailModal
          invoiceId={viewInvoiceId}
          onClose={() => setViewInvoiceId(null)}
          onVoided={() => {
            setViewInvoiceId(null);
            onChanged();
          }}
        />
      ) : null}

      {openRecordId !== null ? (
        <ServiceRecordDetailModal
          serviceRecordId={openRecordId}
          fromAppointmentId={appointmentId ?? undefined}
          professionalMode={isProfessional}
          onClose={() => setOpenRecordId(null)}
          onChanged={() => onChanged()}
        />
      ) : null}

      {/* ── Cancel appointment (asks for a reason) ── */}
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t("femme.calendar.cancelTitle")}
        footer={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="min-h-11"
              onClick={() => setCancelOpen(false)}
              disabled={statusSaving}
            >
              {t("femme.calendar.cancelBack")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              className="min-h-11"
              data-testid="calendar-cancel-confirm"
              onClick={() => void applyStatus("CANCELLED", cancelReason)}
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

      <AppointmentFormModal
        open={appointment !== null && editing}
        onClose={() => onClose()}
        editAppointment={appointment}
        onSaved={(saved) => onChanged(saved, "edited")}
      />

      <ClientTechnicalSheetModal
        clientId={technicalSheetClientId}
        onClose={() => setTechnicalSheetClientId(null)}
      />
    </>
  );
}
