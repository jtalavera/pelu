import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Heading, Input, Label, Spinner, Text } from "@design-system";
import { femmeJson, femmePostJson, femmePutJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";
import { ListSearchField } from "../components/ListSearchField";
import { useDateLocale } from "../i18n/dateLocale";
import { filterByListQuery } from "../util/matchesListQuery";
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

/** Days until end of validity (local calendar). Negative if expired. */
function daysUntilValidUntil(validUntilIso: string): number {
  const end = new Date(validUntilIso.includes("T") ? validUntilIso : `${validUntilIso}T12:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - now.getTime()) / 86400000);
}

type Health = "valid" | "expiring" | "expired";

function stampHealth(row: FiscalStampRow): Health {
  const d = daysUntilValidUntil(row.validUntil);
  if (d < 0) return "expired";
  if (d < 30) return "expiring";
  return "valid";
}

function rangeUsagePct(row: FiscalStampRow): number {
  const total = row.rangeTo - row.rangeFrom + 1;
  if (total <= 0) return 0;
  const used = row.nextEmissionNumber - row.rangeFrom;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

function fillColor(pct: number): string {
  if (pct > 90) return "var(--color-danger)";
  if (pct >= 70) return "var(--color-warning)";
  return "var(--color-timbrado-valid-meter)";
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
  useTour("fiscal-stamp", fiscalStampSteps);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FiscalStampRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
  const [editNext, setEditNext] = useState("");
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
    setSuccess(false);
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
      setSuccess(true);
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
    setSuccess(false);
    try {
      await femmePostJson<FiscalStampRow>(`/api/fiscal-stamps/${id}/activate`, {});
      setSuccess(true);
      await load();
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.fiscalStamp.saveError"));
    }
  }

  async function onDeactivate(id: number) {
    setSaveError(null);
    setSuccess(false);
    try {
      await femmePostJson<FiscalStampRow>(`/api/fiscal-stamps/${id}/deactivate`, {});
      setSuccess(true);
      await load();
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.fiscalStamp.saveError"));
    }
  }

  function openEdit(row: FiscalStampRow) {
    setEditingId(row.id);
    setEditValidFrom(row.validFrom);
    setEditValidUntil(row.validUntil);
    setEditNext(String(row.nextEmissionNumber));
    setSaveError(null);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.editValidFrom;
      delete next.editValidUntil;
      delete next.editNext;
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
    if (!editValidFrom) err.editValidFrom = t("femme.fiscalStamp.dateRequired");
    if (!editValidUntil) err.editValidUntil = t("femme.fiscalStamp.dateRequired");
    if (editValidFrom && editValidUntil && editValidFrom >= editValidUntil) {
      err.editValidUntil = t("femme.fiscalStamp.validUntilBeforeFrom");
    }
    const row = rows.find((r) => r.id === editingId);
    const nextN = parsePositiveInt(editNext);
    if (nextN === null) err.editNext = t("femme.fiscalStamp.integerInvalid");
    else if (row && (nextN < row.rangeFrom || nextN > row.rangeTo)) {
      err.editNext = t("femme.fiscalStamp.nextEmissionRange", {
        from: row.rangeFrom,
        to: row.rangeTo,
      });
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
      setSuccess(true);
      closeEdit();
      await load();
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.fiscalStamp.saveError"));
    } finally {
      setEditSaving(false);
    }
  }

  const activeRow = rows.find((r) => r.active);
  const otherRows = rows.filter((r) => !r.active);

  const filteredOtherRows = useMemo(
    () =>
      filterByListQuery(otherRows, stampListQuery, (r) => [
        r.stampNumber,
        String(r.rangeFrom),
        String(r.rangeTo),
        String(r.nextEmissionNumber),
        r.validFrom,
        r.validUntil,
      ]),
    [otherRows, stampListQuery],
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
      {success ? (
        <Alert variant="success" title={t("femme.businessSettings.savedTitle")}>
          {t("femme.fiscalStamp.savedBody")}
        </Alert>
      ) : null}

      <div data-tour="fiscal-stamp-header">
      {activeRow ? (
        <>
          <ActiveStampCard row={activeRow} />
          {activeRow.lockedAfterInvoice ? (
            <p style={{ marginBottom: 14, fontSize: 12, color: "var(--color-ink-3)" }}>
              {t("femme.fiscalStamp.lockedHint")}
            </p>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => void onDeactivate(activeRow.id)}>
              {t("femme.fiscalStamp.deactivate")}
            </Button>
            {!activeRow.lockedAfterInvoice ? (
              <Button type="button" variant="secondary" className="min-h-11" onClick={() => openEdit(activeRow)}>
                {t("femme.fiscalStamp.edit")}
              </Button>
            ) : null}
          </div>
        </>
      ) : rows.length === 0 ? (
        <Text variant="muted" style={{ marginBottom: 14 }}>
          {t("femme.fiscalStamp.empty")}
        </Text>
      ) : null}
      </div>

      {otherRows.length > 0 ? (
        <div data-tour="fiscal-stamp-list" style={{ marginBottom: 16 }}>
          <div style={sectionTitleStyle}>
            {activeRow ? t("femme.fiscalStamp.otherStampsTitle") : t("femme.fiscalStamp.registeredTitle")}
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
          {filteredOtherRows.length === 0 ? (
            <Text variant="muted" style={{ marginBottom: 8 }}>
              {t("femme.listFilter.noMatches")}
            </Text>
          ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredOtherRows.map((row) => (
              <div
                key={row.id}
                style={{
                  border: "var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  padding: 12,
                  background: "var(--color-white)",
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{row.stampNumber}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      padding: "2px 8px",
                      borderRadius: "var(--radius-pill)",
                      background: "var(--color-stone)",
                      color: "var(--color-ink-2)",
                    }}
                  >
                    {t("femme.fiscalStamp.inactive")}
                  </span>
                </div>
                <Text variant="small" style={{ marginTop: 6, color: "var(--color-ink-3)", fontSize: 11 }}>
                  {t("femme.fiscalStamp.rangeLabel", { from: row.rangeFrom, to: row.rangeTo })}
                  {" · "}
                  {t("femme.fiscalStamp.nextLabel")}: {row.nextEmissionNumber}
                </Text>
                <Text variant="small" style={{ marginTop: 4, color: "var(--color-ink-3)", fontSize: 11 }}>
                  {t("femme.fiscalStamp.validityLabel", {
                    from: row.validFrom,
                    until: row.validUntil,
                  })}
                </Text>
                {row.lockedAfterInvoice ? (
                  <p style={{ marginTop: 8, fontSize: 12, color: "var(--color-ink-3)" }}>
                    {t("femme.fiscalStamp.lockedHint")}
                  </p>
                ) : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  <Button type="button" variant="primary" className="min-h-11" onClick={() => void onActivate(row.id)}>
                    {t("femme.fiscalStamp.activate")}
                  </Button>
                  {!row.lockedAfterInvoice ? (
                    <Button type="button" variant="secondary" className="min-h-11" onClick={() => openEdit(row)}>
                      {t("femme.fiscalStamp.edit")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      ) : null}

      <div style={sectionTitleStyle}>{t("femme.fiscalStamp.addTitle")}</div>
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
            <form className="mt-4 flex flex-col gap-4" onSubmit={onSaveEdit} noValidate>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="edit-vf">{t("femme.fiscalStamp.validFrom")}</Label>
                  <Input
                    id="edit-vf"
                    type="date"
                    value={editValidFrom}
                    onChange={(e) => setEditValidFrom(e.target.value)}
                    className="mt-1 w-full"
                    aria-invalid={!!fieldErrors.editValidFrom}
                    aria-describedby={fieldErrors.editValidFrom ? "edit-vf-err" : undefined}
                  />
                  <FieldValidationError id="edit-vf-err">{fieldErrors.editValidFrom}</FieldValidationError>
                </div>
                <div>
                  <Label htmlFor="edit-vu">{t("femme.fiscalStamp.validUntil")}</Label>
                  <Input
                    id="edit-vu"
                    type="date"
                    value={editValidUntil}
                    onChange={(e) => setEditValidUntil(e.target.value)}
                    className="mt-1 w-full"
                    aria-invalid={!!fieldErrors.editValidUntil}
                    aria-describedby={fieldErrors.editValidUntil ? "edit-vu-err" : undefined}
                  />
                  <FieldValidationError id="edit-vu-err">{fieldErrors.editValidUntil}</FieldValidationError>
                </div>
              </div>
              <div>
                <Label htmlFor="edit-next">{t("femme.fiscalStamp.nextEmission")}</Label>
                <Input
                  id="edit-next"
                  inputMode="numeric"
                  value={editNext}
                  onChange={(e) => setEditNext(e.target.value)}
                  className="mt-1 w-full"
                  aria-invalid={!!fieldErrors.editNext}
                  aria-describedby={fieldErrors.editNext ? "edit-next-err" : undefined}
                />
                <FieldValidationError id="edit-next-err">{fieldErrors.editNext}</FieldValidationError>
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
    </div>
  );
}

function ActiveStampCard({ row }: { row: FiscalStampRow }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const health = stampHealth(row);
  const pct = rangeUsagePct(row);
  const fill = fillColor(pct);

  const iconBg =
    health === "expired"
      ? "var(--color-danger-lt)"
      : health === "expiring"
        ? "var(--color-warning-lt)"
        : "var(--color-timbrado-valid-icon)";

  const badge =
    health === "expired" ? (
      <span
        style={{
          fontSize: 10,
          fontWeight: 500,
          padding: "2px 8px",
          borderRadius: "var(--radius-pill)",
          background: "var(--color-danger-lt)",
          color: "var(--color-danger)",
          whiteSpace: "nowrap",
        }}
      >
        {t("femme.fiscalStamp.statusExpired")}
      </span>
    ) : health === "expiring" ? (
      <span
        style={{
          fontSize: 10,
          fontWeight: 500,
          padding: "2px 8px",
          borderRadius: "var(--radius-pill)",
          background: "var(--color-warning-lt)",
          color: "var(--color-warning)",
          whiteSpace: "nowrap",
        }}
      >
        {t("femme.fiscalStamp.statusExpiringSoon")}
      </span>
    ) : (
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: "var(--radius-pill)",
          background: "var(--color-timbrado-valid-bg)",
          color: "var(--color-timbrado-valid-fg)",
          whiteSpace: "nowrap",
        }}
      >
        {t("femme.fiscalStamp.statusValid")}
      </span>
    );

  return (
    <div
      style={{
        background: "var(--color-stone)",
        borderRadius: "var(--radius-md)",
        border: "var(--border-default)",
        padding: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "var(--radius-md)",
          background: iconBg,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-ink)" }}>{row.stampNumber}</div>
        <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
          {t("femme.fiscalStamp.activeCardMeta", {
            until: fmtDateShort(row.validUntil, dateLocale),
            from: row.rangeFrom,
            to: row.rangeTo,
          })}
        </div>
      </div>
      <div style={{ marginLeft: "auto", textAlign: "right", flexShrink: 0 }}>
        {badge}
        <div
          style={{
            width: 80,
            height: 4,
            background: "var(--color-stone-md)",
            borderRadius: 2,
            marginTop: 6,
            marginLeft: "auto",
            overflow: "hidden",
          }}
        >
          <div style={{ width: `${pct}%`, height: "100%", background: fill }} />
        </div>
      </div>
    </div>
  );
}
