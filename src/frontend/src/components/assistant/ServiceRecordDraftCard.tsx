import { useTranslation } from "react-i18next";
import { Alert, Badge, Button } from "@design-system";
import { translateApiError } from "../../api/parseApiErrorMessage";
import type { AssistantDraftStatus, ServiceRecordDraftPayload } from "../../api/assistant";
import type { AssistantDraftCard } from "../../assistant/AssistantContext";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { ACTION_BUTTON } from "../actionButtons";

const BADGE: Record<AssistantDraftStatus, "warning" | "info" | "success" | "secondary"> = {
  DRAFT: "warning",
  CONFIRMING: "info",
  CONFIRMED: "success",
  SUPERSEDED: "secondary",
  DISCARDED: "secondary",
  EXPIRED: "secondary",
};

type Line = ServiceRecordDraftPayload["lines"][number];

/** «Corte ×2 · Lu» and, only when the server sent money (the administrator's), the line total. */
function LineRow({ line, testId }: { line: Line; testId: string }) {
  const { t } = useTranslation();
  const amount = line.lineTotal ?? (line.unitPrice != null ? line.unitPrice * line.quantity : null);
  const removed = line.mark === "REMOVED";
  return (
    <li
      data-testid={testId}
      data-mark={line.mark}
      className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 ${removed ? "text-ink-2 line-through" : ""}`}
    >
      <span className="min-w-0 break-words">
        {!removed && <span className="mr-1 text-ink-2">{line.position}.</span>}
        <span className="font-semibold">{line.name}</span> ×{line.quantity}
        {line.professionalName ? <span className="text-ink-2"> · {line.professionalName}</span> : null}
        {line.mark === "NEW" || line.mark === "CHANGED" || removed ? (
          <span className="ml-2 no-underline">
            <Badge variant={line.mark === "NEW" ? "success" : removed ? "secondary" : "info"}>
              {t(`femme.assistant.recordDraft.mark.${line.mark}`)}
            </Badge>
          </span>
        ) : null}
      </span>
      {amount != null && <span className="shrink-0 tabular-nums">{formatGuaraniesGs(amount)}</span>}
    </li>
  );
}

/**
 * The ficha de servicio the assistant proposed, drawn from the draft the BACKEND built: the lines
 * the ficha will have (marked new / changed), the ones taken out, and the turno it is linked to.
 * Nothing is saved until «Guardar ficha». A professional's payload carries no amounts, so this
 * card shows no money for her: there is no column to hide, it is simply not there.
 */
export function ServiceRecordDraftCard({
  card,
  onConfirm,
  onDiscard,
}: {
  card: AssistantDraftCard;
  onConfirm: (id: string) => void;
  onDiscard: (id: string) => void;
  // The other card actions are passed to every card; this one needs only these two.
  onComplete?: unknown;
  onViewAppointment?: unknown;
  onViewInvoice?: unknown;
  onShareInvoice?: unknown;
}) {
  const { t } = useTranslation();
  const { draft, busy, error, result, recordChanged } = card;
  const p = draft.payload as ServiceRecordDraftPayload;

  // After a reload there is no in-memory result: the persisted draft carries the ficha id.
  const saved = draft.status === "CONFIRMED" && (result != null || draft.resultId != null);
  const open = draft.status === "DRAFT" && !saved;
  const frame = saved
    ? "border-success bg-success-lt"
    : open
      ? "border-dashed border-warning bg-warning-lt"
      : "border-line bg-surface opacity-70";
  const status = busy ? "CONFIRMING" : draft.status;
  const live = p.lines.filter((l) => l.mark !== "REMOVED");
  const removed = p.lines.filter((l) => l.mark === "REMOVED");

  return (
    <section
      data-testid="assistant-draft-card"
      data-type="SERVICE_RECORD"
      data-draft-id={draft.id}
      data-status={saved ? "CONFIRMED" : draft.status}
      aria-label={t("femme.assistant.recordDraft.title")}
      className={`flex w-full max-w-[95%] flex-col gap-3 rounded-card border-2 p-3 text-sm text-ink ${frame}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-heading font-bold">
          {saved ? t("femme.assistant.recordDraft.savedTitle") : t("femme.assistant.recordDraft.title")}
        </span>
        <Badge variant={BADGE[status]}>
          {saved ? t("femme.assistant.recordDraft.savedBadge") : t(`femme.assistant.draft.status.${status}`)}
        </Badge>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-ink-2">{t("femme.assistant.recordDraft.client")}</dt>
        <dd className="min-w-0 break-words font-semibold" data-testid="assistant-draft-client">
          {p.clientName}
        </dd>
      </dl>
      {p.appointmentTime && (
        <p className="text-ink-2" data-testid="assistant-record-appointment">
          {t("femme.assistant.recordDraft.appointment", { time: p.appointmentTime })}
        </p>
      )}

      <ol className="flex flex-col gap-1" data-testid="assistant-record-lines">
        {live.map((l) => (
          <LineRow key={`${l.position}-${l.name}`} line={l} testId={`assistant-record-line-${l.position}`} />
        ))}
      </ol>

      {p.total != null && (
        <p className="flex justify-between gap-3 border-t border-line pt-2 font-bold" data-testid="assistant-record-total">
          <span>{t("femme.assistant.draft.total")}</span>
          <span className="tabular-nums">{formatGuaraniesGs(p.total)}</span>
        </p>
      )}

      {removed.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-ink-2">{t("femme.assistant.recordDraft.removedTitle")}</span>
          <ul className="flex flex-col gap-1">
            {removed.map((l, i) => (
              <LineRow key={`removed-${i}-${l.name}`} line={l} testId={`assistant-record-line-removed-${i}`} />
            ))}
          </ul>
        </div>
      )}

      {p.notApplied.length > 0 && (
        <Alert variant="warning" data-testid="assistant-record-not-applied">
          {t("femme.assistant.recordDraft.notApplied", {
            items: p.notApplied
              .map((n) => t(`femme.assistant.recordDraft.notAppliedOp.${n.op}`, { name: n.name }))
              .join(", "),
          })}
        </Alert>
      )}

      {recordChanged && open && (
        <Alert variant="warning" data-testid="assistant-record-changed">
          {t("femme.assistant.recordDraft.changed")}
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" data-testid="assistant-draft-error">
          {translateApiError(error, t)}
        </Alert>
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
            {busy ? t("femme.assistant.recordDraft.confirming") : t("femme.assistant.recordDraft.confirm")}
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

      {!open && !saved && (
        <p className="text-ink-2" data-testid="assistant-draft-inactive">
          {t("femme.assistant.draft.inactive")}
        </p>
      )}
    </section>
  );
}
