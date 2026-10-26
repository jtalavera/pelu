import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Label, Modal, Select, Text, Textarea } from "@design-system";
import { femmeJson } from "../../api/femmeClient";
import { assignInvoiceLinesProfessionals } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { formatAmountDecimal } from "../../lib/formatMoney";
import type { InvoiceLine } from "../InvoiceDetailModal";

type ProfessionalOption = { id: number; fullName: string; active: boolean };

/**
 * "Asignar profesional" from the comprobante detail: sets or changes the professional who served
 * each catalog line of an already issued invoice. The invoice is not modified. A line without
 * professional accrues its commission with the rules in force at the invoice date; changing an
 * assigned one reverses the previous professional's commission and accrues the new one's (an
 * approved / paid settlement is never touched — the correction goes to the next one). The reason
 * of a change is optional.
 */
export function AssignInvoiceProfessionalsDialog({
  invoiceId,
  lines,
  onClose,
  onAssigned,
}: {
  invoiceId: number;
  lines: InvoiceLine[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const { t } = useTranslation();
  const [professionals, setProfessionals] = useState<ProfessionalOption[]>([]);
  const catalogLines = lines.filter((l) => l.serviceId != null);
  const initialValue = (l: InvoiceLine) => (l.professionalId != null ? String(l.professionalId) : "");
  const [selection, setSelection] = useState<Record<number, string>>(() =>
    Object.fromEntries(catalogLines.map((l) => [l.id, initialValue(l)])),
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    femmeJson<ProfessionalOption[]>("/api/professionals")
      .then((list) => setProfessionals(Array.isArray(list) ? list.filter((p) => p.active) : []))
      .catch(() => setProfessionals([]));
  }, []);

  // Only lines whose choice differs from what the invoice has are sent (a set professional can't
  // be cleared back to "none").
  const changed = catalogLines.filter(
    (l) => selection[l.id] && selection[l.id] !== initialValue(l),
  );
  const reassigning = changed.some((l) => l.professionalId != null);

  async function save() {
    if (changed.length === 0) {
      setError(t("femme.billing.history.detail.assignProfessionals.selectionRequired"));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await assignInvoiceLinesProfessionals(
        invoiceId,
        changed.map((l) => ({ invoiceLineId: l.id, professionalId: Number(selection[l.id]) })),
        reason.trim(),
      );
      onAssigned();
    } catch (err) {
      setError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("femme.billing.history.detail.assignProfessionals.title")}
      description={t("femme.billing.history.detail.assignProfessionals.hint")}
      footer={
        <>
          <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={onClose}>
            {t("femme.billing.history.detail.assignProfessionals.cancel")}
          </Button>
          <Button
            type="button"
            className="min-h-11 w-full sm:w-auto"
            disabled={saving}
            onClick={() => void save()}
            data-testid="assign-professionals-save"
          >
            {saving
              ? t("femme.billing.history.detail.assignProfessionals.saving")
              : t("femme.billing.history.detail.assignProfessionals.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="assign-professionals-dialog">
        {catalogLines.map((line) => {
          const assigned = line.professionalId != null;
          // An assigned professional who was since deactivated still shows as the current value.
          const options =
            assigned && !professionals.some((p) => p.id === line.professionalId)
              ? [{ id: line.professionalId!, fullName: line.professionalName ?? "", active: false }, ...professionals]
              : professionals;
          return (
            <div
              key={line.id}
              className="flex flex-col gap-1 rounded border border-[rgb(var(--color-border))] p-3"
              data-testid={`assign-professionals-line-${line.id}`}
            >
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="min-w-0 font-medium">
                  {line.description} × {line.quantity}
                </span>
                <span>{formatAmountDecimal(line.lineTotal)}</span>
              </div>
              {assigned && (
                <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                  {t("femme.billing.history.detail.assignProfessionals.alreadyAssigned", {
                    professional: line.professionalName ?? "",
                  })}
                </Text>
              )}
              <Label htmlFor={`assign-professional-${line.id}`}>
                {t("femme.billing.history.detail.assignProfessionals.professional")}
              </Label>
              <Select
                id={`assign-professional-${line.id}`}
                value={selection[line.id] ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelection((prev) => ({ ...prev, [line.id]: value }));
                  setError(null);
                }}
              >
                {!assigned && (
                  <option value="">{t("femme.billing.history.detail.assignProfessionals.choose")}</option>
                )}
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </div>
          );
        })}
        {reassigning && (
          <>
            <Text
              variant="small"
              className="text-amber-700 dark:text-amber-300"
              data-testid="assign-professionals-reassign-note"
            >
              {t("femme.billing.history.detail.assignProfessionals.reassignNote")}
            </Text>
            <div className="flex flex-col gap-1">
              <Label htmlFor="assign-professionals-reason">
                {t("femme.billing.history.detail.assignProfessionals.reason")}
              </Label>
              <Textarea
                id="assign-professionals-reason"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("femme.billing.history.detail.assignProfessionals.reasonPlaceholder")}
              />
            </div>
          </>
        )}
        {error && (
          <Alert variant="destructive" data-testid="assign-professionals-error">
            {error}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
