import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Label, Modal, Select, Text } from "@design-system";
import { femmeJson } from "../../api/femmeClient";
import { assignInvoiceLinesProfessionals } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { formatAmountDecimal } from "../../lib/formatMoney";
import type { InvoiceLine } from "../InvoiceDetailModal";

type ProfessionalOption = { id: number; fullName: string; active: boolean };

/**
 * "Asignar profesional" from the comprobante detail: assigns the professional who served each
 * catalog line of an already issued invoice that was billed without one. The invoice is not
 * modified; each assigned line accrues its commission with the rules in force at the invoice date.
 * Lines that already have a professional are shown read-only.
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
  const [selection, setSelection] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    femmeJson<ProfessionalOption[]>("/api/professionals")
      .then((list) => setProfessionals(Array.isArray(list) ? list.filter((p) => p.active) : []))
      .catch(() => setProfessionals([]));
  }, []);

  const catalogLines = lines.filter((l) => l.serviceId != null);
  const pendingLines = catalogLines.filter((l) => l.professionalId == null);
  const chosen = pendingLines.filter((l) => selection[l.id]);

  async function save() {
    if (chosen.length === 0) {
      setError(t("femme.billing.history.detail.assignProfessionals.selectionRequired"));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await assignInvoiceLinesProfessionals(
        invoiceId,
        chosen.map((l) => ({ invoiceLineId: l.id, professionalId: Number(selection[l.id]) })),
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
            disabled={saving || pendingLines.length === 0}
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
        {pendingLines.length === 0 && (
          <Text variant="muted" className="text-sm" data-testid="assign-professionals-none-pending">
            {t("femme.billing.history.detail.assignProfessionals.nonePending")}
          </Text>
        )}
        {catalogLines.map((line) => (
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
            {line.professionalId != null ? (
              <Text variant="small" className="text-[rgb(var(--color-muted-foreground))]">
                {t("femme.billing.history.detail.assignProfessionals.alreadyAssigned", {
                  professional: line.professionalName ?? "",
                })}
              </Text>
            ) : (
              <>
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
                  <option value="">
                    {t("femme.billing.history.detail.assignProfessionals.choose")}
                  </option>
                  {professionals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
                </Select>
              </>
            )}
          </div>
        ))}
        {error && (
          <Alert variant="destructive" data-testid="assign-professionals-error">
            {error}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
