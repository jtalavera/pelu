import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@design-system";
import { listAppointments, type Appointment } from "../api/appointments";
import { getDateLocale } from "../i18n/dateLocale";
import { useMe } from "../hooks/useMe";
import { formatParaguayTime } from "../lib/paraguayDateTime";
import { AppointmentFichaAction } from "./AppointmentFichaAction";

const POLL_MS = 60_000;
const ACTIVE = new Set(["PENDING", "CONFIRMED", "IN_PROGRESS"]);
const STATUS_TEXT: Record<string, string> = {
  PENDING: "text-warning",
  CONFIRMED: "text-success",
  IN_PROGRESS: "text-primary",
};

/** Local calendar day bounds as ISO instants. */
function todayRangeIso(): { from: string; to: string } {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString(),
    to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString(),
  };
}

/**
 * "Mis turnos de hoy" on the professional's Inicio: her own turnos still to attend (Pendiente,
 * Confirmado, En curso), each with «Crear o asignar ficha» / «Ir a la ficha». No money anywhere.
 */
export function ProfessionalTodayAppointments({
  onOpenRecord,
  onChanged,
}: {
  onOpenRecord: (serviceRecordId: number) => void;
  /** A ficha was created / assigned: the host reloads its fichas. */
  onChanged?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = getDateLocale(i18n);
  const { me } = useMe();
  const myId = me?.professionalId ?? null;
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    if (myId == null) return;
    const { from, to } = todayRangeIso();
    listAppointments(from, to, myId)
      .then((list) => setAppts(Array.isArray(list) ? list : []))
      .catch(() => setAppts([]))
      .finally(() => setLoaded(true));
  }, [myId]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const mine = useMemo(
    () =>
      appts
        .filter((a) => a.professionalId === myId && ACTIVE.has(a.status))
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [appts, myId],
  );

  return (
    <Card className="p-4 sm:p-5" data-testid="professional-today-appointments">
      <h2 className="mb-3 font-heading text-lg font-extrabold text-ink">
        {t("femme.serviceRecords.pro.myAppointments")}
      </h2>
      {loaded && mine.length === 0 ? (
        <p className="py-1 text-ink-3" data-testid="professional-appointments-empty">
          {t("femme.serviceRecords.pro.noAppointments")}
        </p>
      ) : (
        <ul className="flex flex-col">
          {mine.map((appt) => (
            <li
              key={appt.id}
              data-testid="professional-appointment-row"
              className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 border-t border-line py-3 first:border-t-0 sm:grid-cols-[52px_minmax(0,1fr)_auto] sm:gap-x-3"
            >
              <span className="col-start-1 row-span-2 row-start-1 font-heading text-[17px] font-extrabold tabular-nums text-ink">
                {formatParaguayTime(appt.startAt, locale)}
              </span>
              <b className="col-start-2 row-start-1 min-w-0 self-end break-words font-semibold text-ink">
                {appt.clientName ?? t("femme.calendar.detail.occasionalClient")}
              </b>
              <div className="col-start-2 row-start-2 min-w-0 self-start break-words text-sm text-ink-3">
                <span className={`font-semibold ${STATUS_TEXT[appt.status] ?? "text-ink-3"}`}>
                  {t(`femme.status.${appt.status}`, { defaultValue: appt.status })}
                </span>{" "}
                · {appt.serviceName}
              </div>
              <div className="col-start-2 row-start-3 mt-2 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:mt-0">
                <AppointmentFichaAction
                  appt={appt}
                  testIdPrefix="professional-appointment-ficha"
                  className="w-full whitespace-nowrap px-3"
                  onOpenRecord={onOpenRecord}
                  onChanged={() => {
                    load();
                    onChanged?.();
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
