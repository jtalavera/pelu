import { useTranslation } from "react-i18next";
import { Alert, Badge, Button } from "@design-system";
import { translateApiError } from "../../api/parseApiErrorMessage";
import type {
  AppointmentDraftPayload,
  AssistantDraftStatus,
  DraftPatch,
} from "../../api/assistant";
import type { AssistantDraftCard } from "../../assistant/AssistantContext";
import { ACTION_BUTTON } from "../actionButtons";

const BADGE: Record<AssistantDraftStatus, "warning" | "info" | "success" | "secondary"> = {
  DRAFT: "warning",
  CONFIRMING: "info",
  CONFIRMED: "success",
  SUPERSEDED: "secondary",
  DISCARDED: "secondary",
  EXPIRED: "secondary",
};

/** «viernes, 21 de noviembre»: the salon's date (already a plain yyyy-MM-dd), no time-zone games. */
function longDate(date: string, language: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat(language, { weekday: "long", day: "numeric", month: "long" }).format(d);
}

/**
 * The appointment the assistant proposed, drawn from the draft the BACKEND validated (client,
 * service, professional, time, duration). Nothing is booked until «Confirmar y agendar». If the
 * time was taken meanwhile the card keeps the draft and offers the free times as buttons.
 */
export function AppointmentDraftCard({
  card,
  onConfirm,
  onDiscard,
  onComplete,
  onViewAppointment,
}: {
  card: AssistantDraftCard;
  onConfirm: (id: string) => void;
  onDiscard: (id: string) => void;
  onComplete: (id: string, patch: DraftPatch) => void;
  onViewAppointment?: (appointmentId: number, date: string) => void;
  onViewInvoice?: (invoiceId: number) => void;
  onShareInvoice?: (invoiceId: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const { draft, busy, error, result, alternatives } = card;
  const p = draft.payload as AppointmentDraftPayload;

  // After a reload there is no in-memory result: the persisted draft carries the appointment id.
  const booked = draft.status === "CONFIRMED" && (result != null || draft.resultId != null);
  const open = draft.status === "DRAFT" && !booked;
  const frame = booked
    ? "border-success bg-success-lt"
    : open
      ? "border-dashed border-warning bg-warning-lt"
      : "border-line bg-surface opacity-70";
  const status = busy ? "CONFIRMING" : draft.status;
  const appointmentId = result?.appointmentId ?? draft.resultId;

  return (
    <section
      data-testid="assistant-draft-card"
      data-type="APPOINTMENT"
      data-draft-id={draft.id}
      data-status={booked ? "CONFIRMED" : draft.status}
      aria-label={t("femme.assistant.appointmentDraft.title")}
      className={`flex w-full max-w-[95%] flex-col gap-3 rounded-card border-2 p-3 text-sm text-ink ${frame}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-heading font-bold">
          {booked
            ? t("femme.assistant.appointmentDraft.bookedTitle")
            : t("femme.assistant.appointmentDraft.title")}
        </span>
        <Badge variant={BADGE[status]}>
          {booked
            ? t("femme.assistant.appointmentDraft.bookedBadge")
            : t(`femme.assistant.draft.status.${status}`)}
        </Badge>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-testid="assistant-draft-details">
        <dt className="text-ink-2">{t("femme.assistant.appointmentDraft.client")}</dt>
        <dd className="min-w-0 break-words font-semibold" data-testid="assistant-draft-client">
          {p.clientName}
        </dd>
        <dt className="text-ink-2">{t("femme.assistant.appointmentDraft.service")}</dt>
        <dd className="min-w-0 break-words" data-testid="assistant-draft-service">
          {p.serviceName}
        </dd>
        <dt className="text-ink-2">{t("femme.assistant.appointmentDraft.when")}</dt>
        <dd className="min-w-0 font-semibold" data-testid="assistant-draft-when">
          {longDate(p.date, i18n.language)} · {p.time} – {p.endTime}
        </dd>
        <dt className="text-ink-2">{t("femme.assistant.appointmentDraft.professional")}</dt>
        <dd className="min-w-0 break-words" data-testid="assistant-draft-professional">
          {p.professionalName}
        </dd>
        <dt className="text-ink-2">{t("femme.assistant.appointmentDraft.duration")}</dt>
        <dd>{t("femme.assistant.appointmentDraft.minutes", { count: p.durationMinutes })}</dd>
      </dl>

      {p.outsideWorkingHours && !booked && (
        <Alert variant="warning" data-testid="assistant-draft-outside-hours">
          {t("femme.assistant.appointmentDraft.outsideHours", { professional: p.professionalName })}
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" data-testid="assistant-draft-error">
          {translateApiError(error, t)}
        </Alert>
      )}

      {open && alternatives && alternatives.length > 0 && (
        <div role="group" aria-label={t("femme.assistant.appointmentDraft.pickAnother")} className="flex flex-col gap-2">
          <span className="text-ink-2">{t("femme.assistant.appointmentDraft.pickAnother")}</span>
          <div className="flex flex-wrap gap-2">
            {alternatives.map((a) => (
              <button
                key={`${a.professionalId}-${a.startAt}`}
                type="button"
                disabled={busy}
                data-testid="assistant-draft-alternative"
                onClick={() => onComplete(draft.id, { startAt: a.startAt, professionalId: a.professionalId })}
                className="min-h-11 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-page disabled:opacity-60"
              >
                {a.time} · {a.professionalName}
              </button>
            ))}
          </div>
        </div>
      )}

      {open && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className={ACTION_BUTTON}
            loading={busy}
            disabled={busy}
            data-testid="assistant-draft-confirm"
            onClick={() => onConfirm(draft.id)}
          >
            {busy
              ? t("femme.assistant.appointmentDraft.confirming")
              : t("femme.assistant.appointmentDraft.confirm")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={ACTION_BUTTON}
            disabled={busy}
            data-testid="assistant-draft-discard"
            onClick={() => onDiscard(draft.id)}
          >
            {t("femme.assistant.draft.discard")}
          </Button>
        </div>
      )}

      {booked && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className={ACTION_BUTTON}
            data-testid="assistant-draft-view-agenda"
            onClick={() => appointmentId != null && onViewAppointment?.(appointmentId, p.date)}
          >
            {t("femme.assistant.appointmentDraft.viewInAgenda")}
          </Button>
        </div>
      )}

      {!open && !booked && (
        <p className="text-ink-2" data-testid="assistant-draft-inactive">
          {t("femme.assistant.draft.inactive")}
        </p>
      )}
    </section>
  );
}
