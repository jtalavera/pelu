import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Input, Label } from "@design-system";
import { translateApiError } from "../../api/parseApiErrorMessage";
import type { AssistantDraftCard } from "../../assistant/AssistantContext";
import type { AssistantDraftStatus } from "../../api/assistant";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { ACTION_BUTTON } from "../actionButtons";

const PAYMENT_METHODS = ["CASH", "DEBIT_CARD", "CREDIT_CARD", "TRANSFER"] as const;
const CARD_BRANDS = ["VISA", "MASTERCARD", "AMEX", "MAESTRO", "PANAL", "CABAL"] as const;

const BADGE: Record<AssistantDraftStatus, "warning" | "info" | "success" | "secondary"> = {
  DRAFT: "warning",
  CONFIRMING: "info",
  CONFIRMED: "success",
  SUPERSEDED: "secondary",
  DISCARDED: "secondary",
  EXPIRED: "secondary",
};

function Chip({
  selected,
  disabled,
  onClick,
  testId,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className={`min-h-11 rounded-full border px-4 text-sm font-semibold disabled:opacity-60 ${
        selected
          ? "border-primary bg-primary-lt text-primary"
          : "border-line bg-surface text-ink hover:bg-page"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The invoice the assistant proposed, drawn from the draft the BACKEND priced (never from text the
 * model wrote). Nothing exists until «Confirmar y emitir»: the dashed amber border says «draft»,
 * green says «issued», dimmed says «no longer active». What is missing (payment method, card brand,
 * e-mail) is completed here, not by chat.
 */
export function InvoiceDraftCard({
  card,
  onConfirm,
  onDiscard,
  onComplete,
  onViewInvoice,
  onShareInvoice,
}: {
  card: AssistantDraftCard;
  onConfirm: (id: string) => void;
  onDiscard: (id: string) => void;
  onComplete: (
    id: string,
    patch: { paymentMethod?: string; cardBrand?: string; email?: string },
  ) => void;
  onViewInvoice: (invoiceId: number) => void;
  onShareInvoice: (invoiceId: number) => void;
}) {
  const { t } = useTranslation();
  const { draft, busy, error, result, priceChanged } = card;
  const payload = draft.payload;
  const [email, setEmail] = useState(payload.email ?? "");

  const issued = draft.status === "CONFIRMED" && result != null;
  const open = draft.status === "DRAFT" && !issued;
  const missing = draft.missing ?? [];
  const missingText = missing
    .map((m) => t(`femme.assistant.draft.missingField.${m}`, { defaultValue: m }))
    .join(", ");
  const showEmail = open && (missing.includes("EMAIL") || payload.email != null);
  const isCard = payload.paymentMethod === "DEBIT_CARD" || payload.paymentMethod === "CREDIT_CARD";

  const frame = issued
    ? "border-success bg-success-lt"
    : open
      ? "border-dashed border-warning bg-warning-lt"
      : "border-line bg-surface opacity-70";

  function saveEmail(e: FormEvent) {
    e.preventDefault();
    if (email.trim() !== "") onComplete(draft.id, { email: email.trim() });
  }

  return (
    <section
      data-testid="assistant-draft-card"
      data-type="INVOICE"
      data-draft-id={draft.id}
      data-status={issued ? "CONFIRMED" : draft.status}
      aria-label={t("femme.assistant.draft.invoiceTitle")}
      className={`flex w-full max-w-[95%] flex-col gap-3 rounded-card border-2 p-3 text-sm text-ink ${frame}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-heading font-bold">
          {issued
            ? t("femme.assistant.draft.issuedTitle", {
                number: result?.invoiceNumberFormatted ?? `#${result?.invoiceId ?? draft.resultId}`,
              })
            : t("femme.assistant.draft.invoiceTitle")}
        </span>
        <Badge variant={BADGE[busy ? "CONFIRMING" : draft.status]}>
          {t(`femme.assistant.draft.status.${busy ? "CONFIRMING" : draft.status}`)}
        </Badge>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-ink-2">{t("femme.assistant.draft.client")}</dt>
        <dd className="min-w-0 break-words font-semibold" data-testid="assistant-draft-client">
          {payload.clientName}
        </dd>
      </dl>

      <ul className="flex flex-col gap-1" data-testid="assistant-draft-lines">
        {payload.lines.map((l, i) => (
          <li key={`${l.serviceId}-${i}`} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words">
              {l.name}
              {l.quantity > 1 ? ` × ${l.quantity}` : ""}
            </span>
            <span className="shrink-0 tabular-nums">{formatGuaraniesGs(l.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2 font-bold">
        <span>{t("femme.assistant.draft.total")}</span>
        <span data-testid="assistant-draft-total" className="tabular-nums">
          {formatGuaraniesGs(payload.total)}
        </span>
      </div>

      {priceChanged && (
        <Alert variant="warning" data-testid="assistant-draft-price-changed">
          {t("femme.assistant.draft.priceChanged")}
        </Alert>
      )}

      {open && (
        <>
          <div role="group" aria-label={t("femme.assistant.draft.paymentLabel")} className="flex flex-col gap-2">
            <span className="text-ink-2">{t("femme.assistant.draft.paymentLabel")}</span>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <Chip
                  key={m}
                  testId={`assistant-draft-payment-${m}`}
                  selected={payload.paymentMethod === m}
                  disabled={busy}
                  onClick={() => onComplete(draft.id, { paymentMethod: m })}
                >
                  {t(`femme.assistant.draft.payment.${m}`)}
                </Chip>
              ))}
            </div>
          </div>

          {isCard && (
            <div role="group" aria-label={t("femme.assistant.draft.cardBrandLabel")} className="flex flex-col gap-2">
              <span className="text-ink-2">{t("femme.assistant.draft.cardBrandLabel")}</span>
              <div className="flex flex-wrap gap-2">
                {CARD_BRANDS.map((b) => (
                  <Chip
                    key={b}
                    testId={`assistant-draft-brand-${b}`}
                    selected={payload.cardBrand === b}
                    disabled={busy}
                    onClick={() => onComplete(draft.id, { cardBrand: b })}
                  >
                    {t(`femme.assistant.draft.cardBrand.${b}`)}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {showEmail && (
            <form className="flex flex-col gap-2" onSubmit={saveEmail} noValidate>
              <Label htmlFor={`draft-email-${draft.id}`}>{t("femme.assistant.draft.emailLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  id={`draft-email-${draft.id}`}
                  type="email"
                  data-testid="assistant-draft-email"
                  value={email}
                  placeholder={t("femme.assistant.draft.emailPlaceholder")}
                  onChange={(e) => setEmail(e.target.value)}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  className={ACTION_BUTTON}
                  disabled={busy || email.trim() === ""}
                  data-testid="assistant-draft-email-save"
                >
                  {t("femme.assistant.draft.emailSave")}
                </Button>
              </div>
              <span className="text-xs text-ink-2">{t("femme.assistant.draft.emailHint")}</span>
            </form>
          )}

          {missing.length > 0 && (
            <p className="text-ink-2" data-testid="assistant-draft-missing">
              {t("femme.assistant.draft.missing", { fields: missingText })}
            </p>
          )}
        </>
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
            disabled={busy || missing.length > 0}
            data-testid="assistant-draft-confirm"
            onClick={() => onConfirm(draft.id)}
          >
            {busy ? t("femme.assistant.draft.confirming") : t("femme.assistant.draft.confirm")}
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

      {issued && (
        <>
          {result?.sifenSubmissionStatus === "QUEUED" && (
            <p className="text-ink-2" data-testid="assistant-draft-sifen">
              {t("femme.assistant.draft.sifenQueued")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className={ACTION_BUTTON}
              data-testid="assistant-draft-view-invoice"
              onClick={() => result?.invoiceId != null && onViewInvoice(result.invoiceId)}
            >
              {t("femme.assistant.draft.viewInvoice")}
            </Button>
            <Button
              type="button"
              className={ACTION_BUTTON}
              data-testid="assistant-draft-share"
              onClick={() => result?.invoiceId != null && onShareInvoice(result.invoiceId)}
            >
              {t("femme.assistant.draft.shareWithClient")}
            </Button>
          </div>
        </>
      )}

      {!open && !issued && (
        <p className="text-ink-2" data-testid="assistant-draft-inactive">
          {t("femme.assistant.draft.inactive")}
        </p>
      )}
    </section>
  );
}
