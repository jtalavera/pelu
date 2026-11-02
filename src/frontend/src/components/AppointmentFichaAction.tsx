import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Modal, Spinner } from "@design-system";
import type { Appointment } from "../api/appointments";
import { translateApiError } from "../api/parseApiErrorMessage";
import {
  assignServiceRecordToAppointment,
  createServiceRecordFromAppointment,
  listAssignableServiceRecords,
  type ServiceRecordListItem,
} from "../api/serviceRecords";
import { formatParaguayTime } from "../lib/paraguayDateTime";
import { getDateLocale } from "../i18n/dateLocale";

/** A turno can get a ficha while it is Pendiente, Confirmado or En curso and has a client. */
export function canGetFicha(appt: Pick<Appointment, "status" | "clientId" | "serviceRecordId">): boolean {
  return (
    !appt.serviceRecordId &&
    appt.clientId != null &&
    (appt.status === "PENDING" || appt.status === "CONFIRMED" || appt.status === "IN_PROGRESS")
  );
}

/**
 * The turno's ficha action, shared by Inicio and Agenda: «Ir a la ficha» when it has one, «Crear o
 * asignar ficha» when it does not (create a new one from the turno, or take an open ficha of the
 * same client from today). Creating or assigning starts the turno and opens the ficha.
 */
export function AppointmentFichaAction({
  appt,
  onOpenRecord,
  onChanged,
  className = "",
  testIdPrefix = "appointment-ficha",
}: {
  appt: Appointment;
  onOpenRecord: (serviceRecordId: number) => void;
  /** The turno changed (new ficha, status En curso): reload the lists. */
  onChanged?: () => void;
  className?: string;
  testIdPrefix?: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = getDateLocale(i18n);
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<ServiceRecordListItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCandidates(null);
    listAssignableServiceRecords(appt.id)
      .then((list) => {
        if (!cancelled) setCandidates(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, appt.id]);

  if (appt.serviceRecordId) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={`min-h-11 ${className}`}
        data-testid={`${testIdPrefix}-go`}
        onClick={() => onOpenRecord(appt.serviceRecordId as number)}
      >
        {t("femme.appointmentFicha.go")}
      </Button>
    );
  }
  if (!canGetFicha(appt)) return null;

  async function run(action: () => Promise<{ id: number }>) {
    setBusy(true);
    setError(null);
    try {
      const record = await action();
      setOpen(false);
      onChanged?.();
      onOpenRecord(record.id);
    } catch (err) {
      setError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setBusy(false);
    }
  }

  const clientName = appt.clientName ?? "";
  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="sm"
        className={`min-h-11 ${className}`}
        data-testid={`${testIdPrefix}-create-or-assign`}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {t("femme.appointmentFicha.createOrAssign")}
      </Button>
      {open ? (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={t("femme.appointmentFicha.modalTitle", { client: clientName })}
          className="max-w-md"
        >
          <div className="flex flex-col gap-3" data-testid="appointment-ficha-modal">
            {error ? (
              <Alert variant="destructive" role="alert">
                {error}
              </Alert>
            ) : null}
            <button
              type="button"
              disabled={busy}
              data-testid="appointment-ficha-create"
              onClick={() => void run(() => createServiceRecordFromAppointment(appt.id))}
              className="flex min-h-14 flex-col items-start justify-center rounded-card border-[1.5px] border-primary bg-primary-lt px-4 py-2 text-left"
            >
              <b className="font-heading text-ink">{t("femme.appointmentFicha.createNew")}</b>
              <span className="text-sm text-ink-3">
                {t("femme.appointmentFicha.createNewHint", {
                  service: appt.serviceName,
                  professional: appt.professionalName,
                })}
              </span>
            </button>

            <h3 className="text-xs font-extrabold uppercase tracking-wider text-primary">
              {t("femme.appointmentFicha.assignTitle")}
            </h3>
            {candidates === null ? (
              <div className="flex items-center gap-2 text-sm text-ink-3">
                <Spinner size="sm" /> {t("femme.serviceRecords.loading")}
              </div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-ink-3" data-testid="appointment-ficha-no-candidates">
                {t("femme.appointmentFicha.noCandidates", { client: clientName })}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {candidates.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      disabled={busy}
                      data-testid="appointment-ficha-candidate"
                      onClick={() => void run(() => assignServiceRecordToAppointment(appt.id, r.id))}
                      className="flex min-h-14 w-full flex-col items-start justify-center rounded-card border border-line bg-surface px-4 py-2 text-left hover:bg-primary-lt"
                    >
                      <b className="font-heading text-ink">
                        {t("femme.appointmentFicha.candidateTitle", {
                          time: formatParaguayTime(r.createdAt, locale),
                        })}
                      </b>
                      <span className="text-sm text-ink-3">
                        {r.servicesSummary || t("femme.serviceRecords.noServices")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => setOpen(false)}>
              {t("femme.serviceRecords.cancel")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
