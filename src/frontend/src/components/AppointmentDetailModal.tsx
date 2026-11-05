import { useEffect, useState, type ReactNode } from "react";
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
import { AppointmentFichaAction } from "./AppointmentFichaAction";
import { AppointmentFormModal } from "./AppointmentFormModal";
import { ClientTechnicalSheetModal } from "./ClientTechnicalSheetModal";
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

function Row({ label, children }: { label: string; children: ReactNode }) {
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

  const [detailError, setDetailError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [openRecordId, setOpenRecordId] = useState<number | null>(null);
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
  let primaryAction: { key: "confirm" | "start" | "charge" | "viewInvoice"; run: () => void } | null = null;
  const moreActions: DetailAction[] = [];
  if (appointment) {
    const st = appointment.status;
    const apptEditable = canModify(appointment);
    if (apptEditable && st === "PENDING") {
      primaryAction = { key: "confirm", run: () => void applyStatus("CONFIRMED") };
    } else if (apptEditable && st === "CONFIRMED") {
      primaryAction = { key: "start", run: () => void applyStatus("IN_PROGRESS") };
    } else if (!isProfessional && appointment.invoiceId != null) {
      // Already charged: no second «Cobrar»; the comprobante is one tap away.
      const invoiceId = appointment.invoiceId;
      primaryAction = {
        key: "viewInvoice",
        run: () => navigate("/app/billing", { state: { openInvoiceId: invoiceId } }),
      };
    } else if (!isProfessional && (st === "IN_PROGRESS" || st === "COMPLETED")) {
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

  return (
    <>
      {/* ── Appointment detail modal ── */}
      <Modal
        open={appointment !== null && !editing}
        onClose={() => {
          if (technicalSheetClientId === null && openRecordId === null && !cancelOpen) onClose();
        }}
        title={t("femme.calendar.detail.title")}
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            <Button size="md" variant="secondary" className={ACTION_BUTTON} onClick={onClose}>
              {t("femme.calendar.detail.close")}
            </Button>
            {moreActions.length > 0 && (
              <MoreActionsMenu
                label={t("femme.calendar.action.more")}
                open={moreOpen}
                onOpenChange={setMoreOpen}
                triggerTestId="calendar-more-actions"
                menuTestId="calendar-actions-panel"
                disabled={actionBusy}
                items={moreActions.map((a) => ({
                  id: a.key,
                  label: a.label,
                  icon: a.icon,
                  destructive: a.danger,
                  testId: `calendar-action-${a.key}`,
                  onSelect: a.run,
                }))}
              />
            )}
            {primaryAction && (
              <Button
                variant="primary"
                className={`${ACTION_BUTTON} flex-1`}
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
        {appointment && (
          <div className="space-y-3 text-sm">
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
            <Row label={t("femme.calendar.detail.client")}>
              {appointment.clientName ?? (
                <span className="italic text-ink-3">{t("femme.calendar.detail.occasionalClient")}</span>
              )}
              {appointment.clientBirthdayOnDay && (
                <span data-testid="appointment-detail-birthday" className="ml-2">
                  🎂 {t("femme.calendar.clientBirthday")}
                </span>
              )}
            </Row>
            <Row label={t("femme.calendar.detail.professional")}>{appointment.professionalName}</Row>
            <Row label={t("femme.calendar.detail.service")}>
              {appointment.serviceName} —{" "}
              {t("femme.calendar.detail.duration", { minutes: appointment.durationMinutes })}
            </Row>
            <Row label={t("femme.calendar.detail.date")}>{formatDateTime(appointment.startAt, locale)}</Row>
            <Row label={t("femme.calendar.detail.status")}>
              <StatusBadge status={appointment.status} />
            </Row>
            {appointment.reminderSentAt && (
              <Row label={t("femme.calendar.detail.reminderSent")}>
                <span data-testid={`reminder-sent-${appointment.id}`}>
                  {formatDateTime(appointment.reminderSentAt, locale)}
                </span>
              </Row>
            )}
            {canModify(appointment) ? (
              <div className="flex">
                <AppointmentFichaAction
                  appt={appointment}
                  testIdPrefix="calendar-appointment-ficha"
                  className="w-full"
                  onOpenRecord={setOpenRecordId}
                  onChanged={() => onChanged()}
                />
              </div>
            ) : null}
            {appointment.cancelReason && (
              <Row label={t("femme.calendar.detail.cancelReason")}>{appointment.cancelReason}</Row>
            )}
          </div>
        )}
      </Modal>

      {openRecordId !== null ? (
        <ServiceRecordDetailModal
          serviceRecordId={openRecordId}
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
