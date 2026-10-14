import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Checkbox, Input, Label, Modal, Select, Spinner, Text } from "@design-system";
import { getMatrix, type ConfigChange, type MatrixResponse } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { ApplyChangeDialog } from "./ApplyChangeDialog";
import { ItemRulesEditor } from "./ItemRulesEditor";
import { TableWrap, formatPercent, parsePercentInput, tdClass, thClass, todayYmd } from "./common";

const ORIGIN_SHORT: Record<string, string> = {
  BENEFICIARY_ITEM: "E",
  ITEM: "G",
  TENANT_DEFAULT_SERVICE: "D",
  TENANT_DEFAULT_PRODUCT: "D",
};

/** HU-COM-02: global matrix (professionals × items) with per-cell edit and bulk apply. */
export function RulesTab() {
  const { t } = useTranslation();
  const [kind, setKind] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [matrix, setMatrix] = useState<MatrixResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ serviceId: number; name: string } | null>(null);
  const [cellEdit, setCellEdit] = useState<{ serviceId: number; item: string; professionalId: number; name: string; value: string } | null>(null);
  const [cellError, setCellError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkPercent, setBulkPercent] = useState("");
  const [bulkProfessional, setBulkProfessional] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ changes: ConfigChange[]; summary: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMatrix(await getMatrix(kind || undefined, date || undefined));
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [kind, date, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyBulk() {
    const parsed = parsePercentInput(bulkPercent);
    if (parsed === null) {
      setBulkError(t("femme.commissions.validation.percent"));
      return;
    }
    setBulkError(null);
    const professionalId = bulkProfessional ? Number(bulkProfessional) : null;
    setPending({
      changes: selected.map((serviceId) => ({ scope: "RULE", serviceId, professionalId, value: parsed })),
      summary: t("femme.commissions.rules.bulkSummary", {
        count: selected.length,
        value: formatPercent(parsed),
        target: professionalId
          ? matrix?.professionals.find((p) => p.id === professionalId)?.fullName
          : t("femme.commissions.rules.general"),
      }),
    });
  }

  function saveCell() {
    if (!cellEdit) return;
    const parsed = parsePercentInput(cellEdit.value);
    if (parsed === null) {
      setCellError(t("femme.commissions.validation.percent"));
      return;
    }
    setCellError(null);
    setPending({
      changes: [{ scope: "RULE", serviceId: cellEdit.serviceId, professionalId: cellEdit.professionalId, value: parsed }],
      summary: t("femme.commissions.rules.exceptionSummary", {
        item: cellEdit.item,
        professional: cellEdit.name,
        value: formatPercent(parsed),
      }),
    });
    setCellEdit(null);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="commission-rules">
      {notice && (
        <Alert variant="success" role="status">
          {notice}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="commission-matrix-kind">{t("femme.commissions.common.itemKind")}</Label>
          <Select id="commission-matrix-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t("femme.commissions.kind.ALL")}</option>
            <option value="SERVICE">{t("femme.commissions.kind.SERVICE")}</option>
            <option value="PRODUCT">{t("femme.commissions.kind.PRODUCT")}</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="commission-matrix-date">{t("femme.commissions.rules.atDate")}</Label>
          <LocalizedDateInput id="commission-matrix-date" value={date} onChange={setDate} data-testid="commission-matrix-date" />
        </div>
      </div>
      <Text variant="small" className="text-[var(--color-ink-3)]">
        {t("femme.commissions.rules.legend")}
      </Text>
      {error && <Alert variant="destructive">{error}</Alert>}
      {!matrix ? (
        <Spinner />
      ) : (
        <TableWrap testId="commission-matrix">
          <thead>
            <tr>
              <th className={thClass}>
                <span className="sr-only">{t("femme.commissions.rules.select")}</span>
              </th>
              <th className={thClass}>{t("femme.commissions.common.item")}</th>
              <th className={thClass}>{t("femme.commissions.rules.general")}</th>
              {matrix.professionals.map((p) => (
                <th key={p.id} className={thClass}>
                  {p.fullName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((r) => (
              <tr key={r.serviceId} className="border-t" data-testid="commission-matrix-row">
                <td className={tdClass}>
                  <Checkbox
                    aria-label={t("femme.commissions.rules.selectItem", { name: r.serviceName })}
                    checked={selected.includes(r.serviceId)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? [...selected, r.serviceId] : selected.filter((x) => x !== r.serviceId),
                      )
                    }
                  />
                </td>
                <td className={tdClass}>
                  <button
                    type="button"
                    className="min-h-11 text-left underline-offset-2 hover:underline"
                    onClick={() => setEditing({ serviceId: r.serviceId, name: r.serviceName })}
                  >
                    {r.serviceName}
                  </button>
                  <span className="block text-xs text-[var(--color-ink-3)]">{t(`femme.commissions.kind.${r.itemKind}`)}</span>
                </td>
                <td className={tdClass}>{r.generalPercent === null ? t("femme.commissions.rules.noRuleShort") : formatPercent(r.generalPercent)}</td>
                {r.cells.map((c) => {
                  const prof = matrix.professionals.find((p) => p.id === c.professionalId);
                  return (
                    <td key={c.professionalId} className={tdClass}>
                      <button
                        type="button"
                        className="min-h-11 whitespace-nowrap text-left"
                        data-testid={`commission-cell-${r.serviceId}-${c.professionalId}`}
                        title={t(`femme.commissions.origin.${c.origin}`)}
                        onClick={() =>
                          setCellEdit({
                            serviceId: r.serviceId,
                            item: r.serviceName,
                            professionalId: c.professionalId,
                            name: prof?.fullName ?? "",
                            value: String(c.percent).replace(".", ","),
                          })
                        }
                      >
                        {formatPercent(c.percent)}{" "}
                        <span className="text-xs text-[var(--color-ink-3)]">
                          ({ORIGIN_SHORT[c.origin] ?? "?"}){c.scheduled ? " ⏱" : ""}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
        <Text variant="small" className="w-full">
          {t("femme.commissions.rules.bulkTitle", { count: selected.length })}
        </Text>
        <div className="flex flex-col gap-1">
          <Label htmlFor="commission-bulk-target">{t("femme.commissions.rules.bulkTarget")}</Label>
          <Select id="commission-bulk-target" value={bulkProfessional} onChange={(e) => setBulkProfessional(e.target.value)}>
            <option value="">{t("femme.commissions.rules.general")}</option>
            {matrix?.professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="commission-bulk-percent">{t("femme.commissions.rules.percent")}</Label>
          <Input
            id="commission-bulk-percent"
            inputMode="decimal"
            value={bulkPercent}
            onChange={(e) => setBulkPercent(e.target.value)}
            invalid={!!bulkError}
            aria-describedby={bulkError ? "commission-bulk-error" : undefined}
            className="max-w-[8rem]"
          />
        </div>
        <Button type="button" disabled={selected.length === 0} onClick={applyBulk} data-testid="commission-bulk-apply">
          {t("femme.commissions.rules.bulkApply")}
        </Button>
        <div className="w-full">
          <FieldValidationError id="commission-bulk-error">{bulkError}</FieldValidationError>
        </div>
      </div>

      <Modal
        open={cellEdit !== null}
        onClose={() => setCellEdit(null)}
        title={t("femme.commissions.rules.cellTitle", { item: cellEdit?.item, professional: cellEdit?.name })}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setCellEdit(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button type="button" onClick={saveCell} data-testid="commission-cell-save">
              {t("femme.commissions.common.save")}
            </Button>
          </>
        }
      >
        <Label htmlFor="commission-cell-percent">{t("femme.commissions.rules.percent")}</Label>
        <Input
          id="commission-cell-percent"
          inputMode="decimal"
          value={cellEdit?.value ?? ""}
          onChange={(e) => cellEdit && setCellEdit({ ...cellEdit, value: e.target.value })}
          invalid={!!cellError}
          aria-describedby={cellError ? "commission-cell-error" : undefined}
        />
        <FieldValidationError id="commission-cell-error">{cellError}</FieldValidationError>
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => {
          setEditing(null);
          void load();
        }}
        title={editing?.name}
        className="max-w-3xl"
      >
        {editing && <ItemRulesEditor serviceId={editing.serviceId} />}
      </Modal>

      <ApplyChangeDialog
        open={pending !== null}
        changes={pending?.changes ?? []}
        summary={pending?.summary ?? ""}
        onClose={() => setPending(null)}
        onApplied={() => {
          setPending(null);
          setSelected([]);
          setBulkPercent("");
          setNotice(t("femme.commissions.applyDialog.applied"));
          void load();
        }}
      />
    </div>
  );
}
