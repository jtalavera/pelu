import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Label, Modal, Select, Text, Textarea } from "@design-system";
import { reassignEntry, type EntryView } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { useProfessionals } from "./common";

/**
 * Change the professional who earns a commission (assigned to the wrong one at billing). The
 * invoice is not modified: the commission is reversed and re-accrued for the chosen professional.
 */
export function ReassignDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: EntryView | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const professionals = useProfessionals();
  const [professionalId, setProfessionalId] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setProfessionalId("");
    setReason("");
    setFieldError(null);
    setError(null);
  }, [entry]);

  const closed = entry?.settlementStatus === "APPROVED" || entry?.settlementStatus === "PAID";

  async function submit() {
    if (!entry) return;
    if (!professionalId) {
      setFieldError(t("femme.commissions.reassign.professionalRequired"));
      return;
    }
    if (!reason.trim()) {
      setFieldError(t("femme.apiErrors.COMMISSION_REASSIGN_REASON_REQUIRED"));
      return;
    }
    setFieldError(null);
    setSaving(true);
    try {
      await reassignEntry(entry.id, Number(professionalId), reason.trim());
      onDone();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={entry !== null}
      onClose={onClose}
      title={t("femme.commissions.reassign.title")}
      description={
        entry
          ? t("femme.commissions.reassign.description", {
              item: entry.itemName,
              invoice: entry.invoiceNumber,
              professional: entry.professionalName,
              amount: formatGuaraniesGs(entry.commissionAmount),
            })
          : undefined
      }
      footer={
        <>
          <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={onClose}>
            {t("femme.commissions.common.cancel")}
          </Button>
          <Button
            type="button"
            className="min-h-11 w-full sm:w-auto"
            disabled={saving}
            onClick={() => void submit()}
            data-testid="reassign-confirm"
          >
            {t("femme.commissions.reassign.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="reassign-dialog">
        <Text variant="small" className="text-[var(--color-ink-3)]">
          {t("femme.commissions.reassign.hint")}
        </Text>
        {closed && (
          <Alert variant="warning" data-testid="reassign-closed-warning">
            {t("femme.commissions.reassign.closedWarning")}
          </Alert>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="reassign-professional" required>
            {t("femme.commissions.reassign.newProfessional")}
          </Label>
          <Select
            id="reassign-professional"
            value={professionalId}
            onChange={(e) => setProfessionalId(e.target.value)}
            aria-invalid={!!fieldError && !professionalId}
          >
            <option value="">{t("femme.commissions.rules.chooseProfessional")}</option>
            {professionals
              .filter((p) => p.active && p.id !== entry?.professionalId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="reassign-reason" required>
            {t("femme.commissions.settlement.reason")}
          </Label>
          <Textarea
            id="reassign-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("femme.commissions.reassign.reasonPlaceholder")}
            aria-describedby={fieldError ? "reassign-error" : undefined}
          />
        </div>
        <FieldValidationError id="reassign-error">{fieldError}</FieldValidationError>
        {error && <Alert variant="destructive">{error}</Alert>}
      </div>
    </Modal>
  );
}
