import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Label, Modal, Text, Textarea } from "@design-system";
import { voidLateTip, type InvoiceTips } from "../../api/invoiceTips";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../FieldValidationError";
import { formatGuaraniesGs } from "../../lib/formatMoney";

export type VoidLateTipTarget = {
  id: number;
  professionalName: string;
  amount: number | string;
  /** Already translated, e.g. «Efectivo» or «Tarjeta de débito · Visa». */
  paymentLabel?: string;
};

/**
 * «Anular propina»: the salon administrator voids a tip left after the invoice was issued. A reason
 * is mandatory; the tip stays listed as «Anulada» (never deleted) and stops counting in the cash
 * register and in the professional's balance. Shared by the invoice tips panel and the Propinas
 * screen.
 */
export function VoidLateTipDialog({
  target,
  onClose,
  onVoided,
}: {
  target: VoidLateTipTarget | null;
  onClose: () => void;
  onVoided: (updated: InvoiceTips) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // A fresh dialog starts clean (it is reused for every tip).
    setReason("");
    setReasonError(null);
    setSubmitError(null);
  }, [target?.id]);

  async function submit() {
    if (!target) return;
    if (reason.trim() === "") {
      setReasonError(t("femme.propinas.manual.voidReasonRequired"));
      return;
    }
    setReasonError(null);
    setSubmitError(null);
    setSubmitting(true);
    try {
      const updated = await voidLateTip(target.id, reason.trim());
      onVoided(updated);
    } catch (err) {
      setSubmitError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={target !== null} onClose={onClose} title={t("femme.billing.invoiceTips.voidTitle")}>
      {target ? (
        <div className="flex flex-col gap-4" data-testid="late-tip-void-dialog">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
            <div className="min-w-0">
              <div className="font-semibold text-ink">{target.professionalName}</div>
              {target.paymentLabel ? (
                <div className="text-sm text-ink-3">{target.paymentLabel}</div>
              ) : null}
            </div>
            <span className="font-heading text-base font-extrabold tabular-nums text-ink">
              {formatGuaraniesGs(target.amount)}
            </span>
          </div>
          <div>
            <Label htmlFor="late-tip-void-reason">{t("femme.propinas.manual.voidReason")}</Label>
            <Textarea
              id="late-tip-void-reason"
              data-testid="late-tip-void-reason"
              rows={3}
              maxLength={200}
              value={reason}
              invalid={reasonError !== null}
              aria-describedby={reasonError ? "late-tip-void-reason-err" : undefined}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError(null);
              }}
            />
            <FieldValidationError id="late-tip-void-reason-err">{reasonError}</FieldValidationError>
          </div>
          <Text variant="small" className="rounded-xl bg-warning-lt px-4 py-2.5 text-ink">
            {t("femme.billing.invoiceTips.voidLead")}
          </Text>
          {submitError ? (
            <Alert variant="destructive" title={t("femme.billing.errorTitle")} data-testid="late-tip-void-error">
              {submitError}
            </Alert>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" className="min-h-11" onClick={onClose}>
              {t("femme.propinas.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              className="min-h-11"
              disabled={submitting}
              data-testid="late-tip-void-confirm"
              onClick={() => void submit()}
            >
              {submitting
                ? t("femme.propinas.manual.submitting")
                : t("femme.billing.invoiceTips.voidSubmit")}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
