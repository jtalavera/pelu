import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Heading, Input, Label, Spinner, Text } from "@design-system";
import { femmeDeleteJson, femmeJson, femmePostJson, femmePutJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FieldValidationError } from "../components/FieldValidationError";
import { ListSearchField } from "../components/ListSearchField";
import { StatusBadge } from "../components/StatusBadge";
import { useDateLocale } from "../i18n/dateLocale";
import { filterByListQuery } from "../util/matchesListQuery";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useTour } from "../tour/useTour";
import { fiscalStampSteps } from "../tour/steps/fiscalStamp";

type FiscalStampRow = {
  id: number;
  stampNumber: string;
  validFrom: string;
  validUntil: string;
  rangeFrom: number;
  rangeTo: number;
  nextEmissionNumber: number;
  active: boolean;
  lockedAfterInvoice: boolean;
  hasInvoices: boolean;
};

function parsePositiveInt(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

function fmtDateShort(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--color-ink-2)",
  marginBottom: 4,
};

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--color-ink-3)",
  marginTop: 3,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.06em",
  color: "var(--color-ink-3)",
  textTransform: "uppercase",
  margin: "14px 0 10px",
  paddingBottom: 6,
  borderBottom: "var(--border-default)",
};

// HU-29 AC9: visually separate the "current stamp" info from the "new stamp"
// form by enclosing each in its own bordered card.
const sectionCardStyle: React.CSSProperties = {
  border: "var(--border-default)",
  borderRadius: "var(--radius-xl)",
  padding: 16,
  marginBottom: 16,
  background: "var(--color-white)",
};

const createSectionCardStyle: React.CSSProperties = {
  ...sectionCardStyle,
  background: "var(--color-stone)",
};

function buildInputStyle(hasError: boolean, focused: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "8px 11px",
    border: hasError ? "1px solid var(--color-danger)" : "1px solid var(--color-stone-md)",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    color: "var(--color-ink)",
    background: "var(--color-white)",
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
  };
  if (focused) {
    base.boxShadow = hasError
      ? "0 0 0 3px var(--color-danger-lt)"
      : "0 0 0 3px var(--color-rose-lt)";
    if (!hasError) base.borderColor = "var(--color-rose)";
  }
  return base;
}

export default function FiscalStampSettingsPage() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR");
  useTour("fiscal-stamp", fiscalStampSteps, undefined, guidedTourEnabled);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FiscalStampRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FiscalStampRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [creating, setCreating] = useState(false);
  const [stampNumber, setStampNumber] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [initialEmission, setInitialEmission] = useState("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [focusField, setFocusField] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValidFrom, setEditValidFrom] = useState("");
  const [editValidUntil, setEditValidUntil] = useState("");
  const [editStartingEmission, setEditStartingEmission] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [stampListQuery, setStampListQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await femmeJson<FiscalStampRow[]>("/api/fiscal-stamps");
      setRows(data);
    } catch {
      setLoadError(t("femme.fiscalStamp.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearCreateErrors = useCallback(() => {
    setFieldErrors({});
    setSaveError(null);
  }, []);

  function validateCreateForm() {
    const err: Record<string, string | null> = {};
    const sn = stampNumber.trim();
    if (!sn || !/^\d+$/.test(sn)) {
      err.stampNumber = t("femme.fiscalStamp.stampNumberInvalid");
    }
    if (!validFrom) err.validFrom = t("femme.fiscalStamp.dateRequired");
    if (!validUntil) err.validUntil = t("femme.fiscalStamp.dateRequired");
    const rf = parsePositiveInt(rangeFrom);
    const rt = parsePositiveInt(rangeTo);
    const ie = parsePositiveInt(initialEmission);
    if (rf === null) err.rangeFrom = t("femme.fiscalStamp.integerInvalid");
    if (rt === null) err.rangeTo = t("femme.fiscalStamp.integerInvalid");
    if (ie === null) err.initialEmission = t("femme.fiscalStamp.integerInvalid");
    if (rf !== null && rt !== null && rf > rt) {
      err.rangeTo = t("femme.fiscalStamp.rangeOrder");
    }
    if (validFrom && validUntil && validFrom >= validUntil) {
      err.validUntil = t("femme.fiscalStamp.validUntilBeforeFrom");
    }
    if (rf !== null && rt !== null && ie !== null) {
      if (ie < rf || ie > rt) {
        err.initialEmission = t("femme.fiscalStamp.initialEmissionRange", {
          from: rf,
          to: rt,
        });
      }
    }
    return err;
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setSuccessMessage(null);
    const err = validateCreateForm();
    setFieldErrors(err);
    if (Object.keys(err).length > 0) return;

    const rf = parsePositiveInt(rangeFrom)!;
    const rt = parsePositiveInt(rangeTo)!;
    const ie = parsePositiveInt(initialEmission)!;

    setCreating(true);
    setSaveError(null);
    try {
      await femmePostJson<FiscalStampRow>("/api/fiscal-stamps", {
        stampNumber: stampNumber.trim(),
        validFrom,
        validUntil,
        rangeFrom: rf,
        rangeTo: rt,
        initialEmissionNumber: ie,
      });
      setSuccessMessage(t("femme.fiscalStamp.savedBody"));
      setStampNumber("");
      setValidFrom("");
      setValidUntil("");
      setRangeFrom("");
      setRangeTo("");
      setInitialEmission("");
      await load();
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.fiscalStamp.saveError"));
    } finally {
      setCreating(false);
    }
  }

  async function onActivate(id: number) {
    setSaveError(null);
    setSuccessMessage(null);
    try {
      await femmePostJson<FiscalStampRow>(`/api/fiscal-stamps/${id}/activate`, {});
      setSuccessMessage(t("femme.fiscalStamp.savedBody"));
      await load();
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.fiscalStamp.saveError"));
    }
  }

  async function onDeactivate(id: number) {
    setSaveError(null);
    setSuccessMessage(null);
    try {
      await femmePostJson<FiscalStampRow>(`/api/fiscal-stamps/${id}/deactivate`, {});
      setSuccessMessage(t("femme.fiscalStamp.savedBody"));
      await load();
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.fiscalStamp.saveError"));
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    setSaveError(null);
    setSuccessMessage(null);
    setDeleting(true);
    try {
      await femmeDeleteJson(`/api/fiscal-stamps/${target.id}`);
      setSuccessMessage(t("femme.fiscalStamp.deleteSuccess"));
      await load();
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.fiscalStamp.saveError"));
    } finally {
      setDeleting(false);
    }
  }

  function openEdit(row: FiscalStampRow) {
    setEditingId(row.id);
    setEditValidFrom(row.validFrom);
    setEditValidUntil(row.validUntil);
    setEditStartingEmission(String(row.nextEmissionNumber));
    setSaveError(null);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.editStartingEmission;
      return next;
    });
  }

  function closeEdit() {
    setEditingId(null);
    setEditSaving(false);
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId === null) return;
    const err: Record<string, string | null> = {};
    const row = rows.find((r) => r.id === editingId);
    const nextN = parsePositiveInt(editStartingEmission);
    if (nextN === null) {
      err.editStartingEmission = t("femme.fiscalStamp.integerInvalid");
    } else if (row && (nextN < row.rangeFrom || nextN > row.rangeTo)) {
      err.editStartingEmission = t("femme.fiscalStamp.initialEmissionRange", {
        from: row.rangeFrom,
        to: row.rangeTo,
      });
    } else if (row && row.lockedAfterInvoice && nextN < row.nextEmissionNumber) {
      err.editStartingEmission = t("femme.fiscalStamp.cannotMoveBackwardLocked");
    }
    setFieldErrors((prev) => ({ ...prev, ...err }));
    if (Object.keys(err).length > 0) return;

    setEditSaving(true);
    setSaveError(null);
    try {
      await femmePutJson<FiscalStampRow>(`/api/fiscal-stamps/${editingId}`, {
        validFrom: editValidFrom,
        validUntil: editValidUntil,
        nextEmissionNumber: nextN!,
      });
      setSuccessMessage(t("femme.fiscalStamp.savedBody"));
      closeEdit();
      await load();
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.fiscalStamp.saveError"));
    } finally {
      setEditSaving(false);
    }
  }

  const editingRow = rows.find((r) => r.id === editingId) ?? null;

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => Number(b.active) - Number(a.active)),
    [rows],
  );

  const filteredRows = useMemo(
    () =>
      filterByListQuery(sortedRows, stampListQuery, (r) => [
        r.stampNumber,
        String(r.rangeFrom),
        String(r.rangeTo),
        String(r.nextEmissionNumber),
        r.validFrom,
        r.validUntil,
      ]),
    [sortedRows, stampListQuery],
  );

  const primaryBtn: React.CSSProperties = {
    background: "var(--color-rose)",
    color: "var(--color-on-primary)",
    border: "none",
    borderRadius: "var(--radius-md)",
    padding: "8px 16px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  };

  const thStyle: React.CSSProperties = {
    padding: "9px 12px",
    fontSize: 10,
    fontWeight: 500,
    color: "var(--color-ink-3)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    textAlign: "left",
    background: "var(--color-stone)",
    whiteSpace: "nowrap",
  };

  if (loading) {
    return (
      <div style={{ display: "flex", minHeight: "40vh", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Spinner size="lg" />
        <Text>{t("femme.fiscalStamp.loading")}</Text>
      </div>
    );
  }

  return (
    <div>
      {loadError ? (
        <Alert variant="destructive" title={t("femme.businessSettings.errorTitle")}>
          {loadError}
        </Alert>
      ) : null}
      {saveError ? (
        <Alert variant="destructive" title={t("femme.businessSettings.errorTitle")}>
          {saveError}
        </Alert>
      ) : null}
      {successMessage ? (
        <Alert variant="success" title={t("femme.businessSettings.savedTitle")}>
          {successMessage}
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <section data-testid="fiscal-stamp-current-section" style={sectionCardStyle}>
          <div style={{ ...sectionTitleStyle, marginTop: 0 }}>
            {t("femme.fiscalStamp.registeredTitle")}
          </div>
          <Text variant="muted">{t("femme.fiscalStamp.empty")}</Text>
        </section>
      ) : (
        <div data-tour="fiscal-stamp-list" style={{ marginBottom: 16 }}>
          <div style={{ ...sectionTitleStyle, marginTop: 0 }}>
            {t("femme.fiscalStamp.registeredTitle")}
          </div>
          <div style={{ marginBottom: 12 }}>
            <ListSearchField
              id="fiscal-stamp-list-filter"
              value={stampListQuery}
              onChange={setStampListQuery}
              label={t("femme.listFilter.label")}
              placeholder={t("femme.listFilter.placeholder")}
            />
          </div>
          <div
            data-testid="fiscal-stamp-current-section"
            style={{
              background: "var(--color-white)",
              borderRadius: "var(--radius-xl)",
              border: "var(--border-default)",
              overflow: "hidden",
            }}
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t("femme.fiscalStamp.tableStampNumber")}</th>
                    <th style={thStyle}>{t("femme.fiscalStamp.tableStatus")}</th>
                    <th style={thStyle}>{t("femme.fiscalStamp.tableValidFrom")}</th>
                    <th style={thStyle}>{t("femme.fiscalStamp.tableValidUntil")}</th>
                    <th style={thStyle}>{t("femme.fiscalStamp.tableRangeFrom")}</th>
                    <th style={thStyle}>{t("femme.fiscalStamp.tableRangeTo")}</th>
                    <th style={thStyle}>{t("femme.fiscalStamp.tableNextEmission")}</th>
                    <th style={thStyle}>{t("femme.fiscalStamp.tableActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        style={{ padding: "24px 12px", textAlign: "center", fontSize: 12, color: "var(--color-ink-3)" }}
                      >
                        {t("femme.listFilter.noMatches")}
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                      const tdStyle: React.CSSProperties = {
                        padding: "10px 12px",
                        fontSize: 12,
                        color: "var(--color-ink)",
                        verticalAlign: "middle",
                        borderBottom: "0.5px solid var(--color-stone)",
                      };
                      return (
                        <tr key={row.id} data-testid={`fiscal-stamp-row-${row.id}`}>
                          <td style={{ ...tdStyle, fontWeight: 500 }}>{row.stampNumber}</td>
                          <td style={tdStyle}>
                            <StatusBadge status={row.active ? "ACTIVE" : "INACTIVE"} />
                          </td>
                          <td style={tdStyle}>{fmtDateShort(row.validFrom, dateLocale)}</td>
                          <td style={tdStyle}>{fmtDateShort(row.validUntil, dateLocale)}</td>
                          <td style={tdStyle}>{row.rangeFrom}</td>
                          <td style={tdStyle}>{row.rangeTo}</td>
                          <td style={tdStyle}>{row.nextEmissionNumber}</td>
                          <td style={tdStyle}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => openEdit(row)}
                              >
                                {t("femme.fiscalStamp.edit")}
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={!row.active}
                                onClick={() => void onDeactivate(row.id)}
                              >
                                {t("femme.fiscalStamp.deactivate")}
                              </Button>
                              <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                disabled={row.active}
                                onClick={() => void onActivate(row.id)}
                              >
                                {t("femme.fiscalStamp.activate")}
                              </Button>
                              {!row.hasInvoices ? (
                                <Button
                                  type="button"
                                  variant="danger"
                                  size="sm"
                                  disabled={deleting}
                                  onClick={() => setDeleteTarget(row)}
                                >
                                  {t("femme.fiscalStamp.delete")}
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <section data-testid="fiscal-stamp-create-section" style={createSectionCardStyle}>
      <div style={{ ...sectionTitleStyle, marginTop: 0 }}>{t("femme.fiscalStamp.addTitle")}</div>
      <form
        data-tour="fiscal-stamp-form"
        onSubmit={onCreate}
        noValidate
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="fs-stamp" style={labelStyle}>
            {t("femme.fiscalStamp.stampNumber")}
          </label>
          <input
            id="fs-stamp"
            inputMode="numeric"
            value={stampNumber}
            onChange={(e) => {
              setStampNumber(e.target.value);
              clearCreateErrors();
            }}
            placeholder="12345678"
            aria-invalid={!!fieldErrors.stampNumber}
            aria-describedby={fieldErrors.stampNumber ? "fs-stamp-err" : "fs-stamp-hint"}
            onFocus={() => setFocusField("fs-stamp")}
            onBlur={() => setFocusField(null)}
            style={buildInputStyle(!!fieldErrors.stampNumber, focusField === "fs-stamp")}
          />
          <FieldValidationError id="fs-stamp-err">{fieldErrors.stampNumber}</FieldValidationError>
          <p id="fs-stamp-hint" style={hintStyle}>
            {t("femme.fiscalStamp.stampNumberHint")}
          </p>
        </div>
        <div>
          <label htmlFor="fs-vf" style={labelStyle}>
            {t("femme.fiscalStamp.validFrom")}
          </label>
          <input
            id="fs-vf"
            type="date"
            value={validFrom}
            onChange={(e) => {
              setValidFrom(e.target.value);
              clearCreateErrors();
            }}
            aria-invalid={!!fieldErrors.validFrom}
            aria-describedby={fieldErrors.validFrom ? "fs-vf-err" : undefined}
            onFocus={() => setFocusField("fs-vf")}
            onBlur={() => setFocusField(null)}
            style={buildInputStyle(!!fieldErrors.validFrom, focusField === "fs-vf")}
          />
          <FieldValidationError id="fs-vf-err">{fieldErrors.validFrom}</FieldValidationError>
        </div>
        <div>
          <label htmlFor="fs-vu" style={labelStyle}>
            {t("femme.fiscalStamp.validUntil")}
          </label>
          <input
            id="fs-vu"
            type="date"
            value={validUntil}
            onChange={(e) => {
              setValidUntil(e.target.value);
              clearCreateErrors();
            }}
            aria-invalid={!!fieldErrors.validUntil}
            aria-describedby={fieldErrors.validUntil ? "fs-vu-err" : undefined}
            onFocus={() => setFocusField("fs-vu")}
            onBlur={() => setFocusField(null)}
            style={buildInputStyle(!!fieldErrors.validUntil, focusField === "fs-vu")}
          />
          <FieldValidationError id="fs-vu-err">{fieldErrors.validUntil}</FieldValidationError>
        </div>
        <div>
          <label htmlFor="fs-rf" style={labelStyle}>
            {t("femme.fiscalStamp.rangeFrom")}
          </label>
          <input
            id="fs-rf"
            inputMode="numeric"
            value={rangeFrom}
            onChange={(e) => {
              setRangeFrom(e.target.value);
              clearCreateErrors();
            }}
            aria-invalid={!!fieldErrors.rangeFrom}
            aria-describedby={fieldErrors.rangeFrom ? "fs-rf-err" : undefined}
            onFocus={() => setFocusField("fs-rf")}
            onBlur={() => setFocusField(null)}
            style={buildInputStyle(!!fieldErrors.rangeFrom, focusField === "fs-rf")}
          />
          <FieldValidationError id="fs-rf-err">{fieldErrors.rangeFrom}</FieldValidationError>
        </div>
        <div>
          <label htmlFor="fs-rt" style={labelStyle}>
            {t("femme.fiscalStamp.rangeTo")}
          </label>
          <input
            id="fs-rt"
            inputMode="numeric"
            value={rangeTo}
            onChange={(e) => {
              setRangeTo(e.target.value);
              clearCreateErrors();
            }}
            aria-invalid={!!fieldErrors.rangeTo}
            aria-describedby={fieldErrors.rangeTo ? "fs-rt-err" : undefined}
            onFocus={() => setFocusField("fs-rt")}
            onBlur={() => setFocusField(null)}
            style={buildInputStyle(!!fieldErrors.rangeTo, focusField === "fs-rt")}
          />
          <FieldValidationError id="fs-rt-err">{fieldErrors.rangeTo}</FieldValidationError>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="fs-ie" style={labelStyle}>
            {t("femme.fiscalStamp.initialEmission")}
          </label>
          <input
            id="fs-ie"
            inputMode="numeric"
            value={initialEmission}
            onChange={(e) => {
              setInitialEmission(e.target.value);
              clearCreateErrors();
            }}
            placeholder="1"
            aria-invalid={!!fieldErrors.initialEmission}
            aria-describedby={fieldErrors.initialEmission ? "fs-ie-err" : "fs-ie-hint"}
            onFocus={() => setFocusField("fs-ie")}
            onBlur={() => setFocusField(null)}
            style={buildInputStyle(!!fieldErrors.initialEmission, focusField === "fs-ie")}
          />
          <FieldValidationError id="fs-ie-err">{fieldErrors.initialEmission}</FieldValidationError>
          <p id="fs-ie-hint" style={hintStyle}>
            {t("femme.fiscalStamp.initialEmissionHintLegacy")}
          </p>
        </div>
        <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
          <button type="submit" style={primaryBtn} disabled={creating}>
            {creating ? t("femme.fiscalStamp.saving") : t("femme.fiscalStamp.add")}
          </button>
        </div>
      </form>
      </section>

      {editingId !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="presentation"
          onClick={() => !editSaving && closeEdit()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fiscal-edit-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-xl)] border bg-[var(--color-white)] p-5 shadow-lg"
            style={{ border: "var(--border-default)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <Heading as="h2" id="fiscal-edit-title" className="text-lg">
              {t("femme.fiscalStamp.editTitle")}
            </Heading>
            <Text variant="small" className="mt-1 text-[var(--color-ink-3)]">
              {t("femme.fiscalStamp.editLead")}
            </Text>
            <form className="mt-4 flex flex-col gap-4" onSubmit={onSaveEdit} noValidate>
              <div>
                <Label htmlFor="edit-start">{t("femme.fiscalStamp.initialEmission")}</Label>
                <Input
                  id="edit-start"
                  inputMode="numeric"
                  value={editStartingEmission}
                  onChange={(e) => setEditStartingEmission(e.target.value)}
                  className="mt-1 w-full"
                  aria-invalid={!!fieldErrors.editStartingEmission}
                  aria-describedby={
                    fieldErrors.editStartingEmission ? "edit-start-err" : "edit-start-hint"
                  }
                />
                <FieldValidationError id="edit-start-err">
                  {fieldErrors.editStartingEmission}
                </FieldValidationError>
                {!fieldErrors.editStartingEmission ? (
                  <p id="edit-start-hint" style={hintStyle}>
                    {editingRow?.lockedAfterInvoice
                      ? t("femme.fiscalStamp.initialEmissionHintLocked")
                      : t("femme.fiscalStamp.initialEmissionHint")}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" className="min-h-11" disabled={editSaving}>
                  {editSaving ? t("femme.fiscalStamp.saving") : t("femme.fiscalStamp.save")}
                </Button>
                <Button type="button" variant="secondary" className="min-h-11" disabled={editSaving} onClick={closeEdit}>
                  {t("femme.fiscalStamp.cancel")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          open
          title={t("femme.fiscalStamp.deleteConfirmTitle")}
          description={t("femme.fiscalStamp.deleteConfirmBody", {
            stampNumber: deleteTarget.stampNumber,
          })}
          cancelLabel={t("femme.fiscalStamp.cancel")}
          confirmLabel={t("femme.fiscalStamp.delete")}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  );
}

