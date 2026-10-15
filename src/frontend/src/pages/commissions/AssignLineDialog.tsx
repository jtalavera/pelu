import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Label, Modal, Select, Text, Textarea } from "@design-system";
import { assignLineProfessional, type LineWithoutBeneficiary } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { useProfessionals } from "./common";

/**
 * HU-COM-13: assign a professional to an issued line billed without one. The invoice is not
 * modified; the line accrues its commission with the rules in force when the invoice was issued.
 */
export function AssignLineDialog({
  line,
  onClose,
  onDone,
}: {
  line: LineWithoutBeneficiary | null;
  onClose: () => void;
  onDone: (professionalName: string) => void;
}) {
  const { t } = useTranslation();
  const professionals = useProfessionals();
  const [professionalId, setProfessionalId] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!line) return;
    setProfessionalId("");
    setNote("");
    setFieldError(null);
    setError(null);
  }, [line]);

  async function submit() {
    if (!line) return;
    if (!professionalId) {
      setFieldError(t("femme.commissions.reassign.professionalRequired"));
      return;
    }
    setFieldError(null);
    setSaving(true);
    try {
      await assignLineProfessional(line.invoiceLineId, Number(professionalId), note.trim());
      onDone(professionals.find((p) => p.id === Number(professionalId))?.fullName ?? "");
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={line !== null}
      onClose={onClose}
      title={t("femme.commissions.assignLine.title")}
      description={
        line
          ? t("femme.commissions.assignLine.description", {
              item: line.description,
              invoice: line.invoiceNumber,
              amount: formatGuaraniesGs(line.lineTotal),
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
            data-testid="assign-line-confirm"
          >
            {t("femme.commissions.assignLine.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="assign-line-dialog">
        <Text variant="small" className="text-[var(--color-ink-3)]">
          {t("femme.commissions.assignLine.hint")}
        </Text>
        <div className="flex flex-col gap-1">
          <Label htmlFor="assign-line-professional" required>
            {t("femme.commissions.common.professional")}
          </Label>
          <Select
            id="assign-line-professional"
            value={professionalId}
            onChange={(e) => setProfessionalId(e.target.value)}
            aria-invalid={!!fieldError}
            aria-describedby={fieldError ? "assign-line-error" : undefined}
          >
            <option value="">{t("femme.commissions.rules.chooseProfessional")}</option>
            {professionals
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
          </Select>
          <FieldValidationError id="assign-line-error">{fieldError}</FieldValidationError>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="assign-line-note">{t("femme.commissions.assignLine.note")}</Label>
          <Textarea
            id="assign-line-note"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("femme.commissions.assignLine.notePlaceholder")}
          />
        </div>
        {error && <Alert variant="destructive">{error}</Alert>}
      </div>
    </Modal>
  );
}
