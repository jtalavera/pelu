import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Modal, Spinner } from "@design-system";
import { sendSifenKudeByEmail } from "../../api/downloadSifenKude";
import { femmeJson } from "../../api/femmeClient";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { isValidEmail } from "../../lib/validateEmail";
import { ACTION_BUTTON } from "../actionButtons";
import { FieldValidationError } from "../FieldValidationError";

export type SendKudeEmailTarget = {
  id: number;
  clientDisplayName: string;
  invoiceNumberFormatted: string;
  total: string | number;
  issuedAt: string;
};

/**
 * «Enviar KuDE por correo» from a list row: shows the address the KuDE will go to — the client's own
 * email on file, loaded from the invoice — and lets the user change it before sending. The change
 * only applies to this send: it never edits the client. With no email on file the field starts empty
 * and a valid one is required.
 */
export function SendKudeEmailDialog({
  target,
  onClose,
  onSent,
}: {
  target: SendKudeEmailTarget | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [loading, setLoading] = useState(false);
  const [initialEmail, setInitialEmail] = useState("");
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const targetId = target?.id ?? null;
  useEffect(() => {
    // Each time the dialog opens for an invoice: start clean and read the client's email on file.
    setEmail("");
    setInitialEmail("");
    setFieldError(null);
    setSubmitError(null);
    if (targetId == null) return;
    let cancelled = false;
    setLoading(true);
    femmeJson<{ recipientEmail?: string | null; clientEmail?: string | null }>(`/api/invoices/${targetId}`)
      .then((detail) => {
        if (cancelled) return;
        const known = detail?.recipientEmail || detail?.clientEmail || "";
        setInitialEmail(known);
        setEmail(known);
      })
      .catch(() => {
        // Not fatal: the user can type the address by hand.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    if (!isValidEmail(email)) {
      setFieldError(t("femme.billing.home.emailDialog.invalid"));
      return;
    }
    setFieldError(null);
    setSubmitError(null);
    setSending(true);
    try {
      await sendSifenKudeByEmail(target.id, email.trim());
      onSent();
    } catch (err) {
      setSubmitError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={target !== null} onClose={onClose} title={t("femme.billing.home.emailDialog.title")}>
      {target ? (
        <form
          noValidate
          onSubmit={(e) => void submit(e)}
          className="flex flex-col gap-4"
          data-testid="kude-email-dialog"
        >
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-ink">
                {target.clientDisplayName || t("femme.billing.invoice.noName")}
              </div>
              <div className="text-xs text-ink-3">
                {t("femme.billing.home.emailDialog.invoiceLine", {
                  number: target.invoiceNumberFormatted,
                  date: formatParaguayDateTime(target.issuedAt, dateLocale),
                })}
              </div>
            </div>
            <span className="shrink-0 font-heading text-base font-extrabold tabular-nums text-ink">
              {formatGuaraniesGs(target.total)}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2" data-testid="kude-email-loading">
              <Spinner size="sm" />
              <span className="text-sm text-ink-3">{t("femme.billing.home.emailDialog.loading")}</span>
            </div>
          ) : (
            <div>
              <Label htmlFor="kude-row-email">{t("femme.billing.history.detail.sifen.kudeEmailFieldLabel")}</Label>
              <Input
                id="kude-row-email"
                data-testid="kude-email-input"
                type="email"
                value={email}
                placeholder={t("femme.billing.invoice.clientEmailPlaceholder")}
                aria-invalid={fieldError !== null}
                aria-describedby={`${fieldError ? "kude-row-email-err " : ""}kude-row-email-hint`}
                className="mt-1 w-full"
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldError(null);
                  setSubmitError(null);
                }}
              />
              <FieldValidationError id="kude-row-email-err">{fieldError}</FieldValidationError>
              <p id="kude-row-email-hint" className="mt-1 text-xs text-ink-3" data-testid="kude-email-hint">
                {initialEmail
                  ? t("femme.billing.home.emailDialog.hintOnFile")
                  : t("femme.billing.home.emailDialog.hintNone")}
              </p>
            </div>
          )}

          {submitError ? (
            <Alert variant="destructive" title={t("femme.billing.errorTitle")} data-testid="kude-email-error">
              {submitError}
            </Alert>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" className={ACTION_BUTTON} onClick={onClose}>
              {t("femme.propinas.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              className={ACTION_BUTTON}
              disabled={loading || sending}
              data-testid="kude-email-send"
            >
              {sending ? t("femme.billing.home.emailDialog.sending") : t("femme.billing.home.emailDialog.send")}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
