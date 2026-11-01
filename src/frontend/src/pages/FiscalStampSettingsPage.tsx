import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, KebabMenu, Label, Modal, Spinner, Text } from "@design-system";
import { femmeDeleteJson, femmeJson, femmePostJson, femmePutJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FieldValidationError } from "../components/FieldValidationError";
import { ListSearchField } from "../components/ListSearchField";
import { StatusBadge } from "../components/StatusBadge";
import { useDateLocale } from "../i18n/dateLocale";
import { filterByListQuery } from "../util/matchesListQuery";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { SettingsHeaderAction } from "./settings/settingsContext";
import { useTour } from "../tour/useTour";
import { fiscalStampSteps } from "../tour/steps/fiscalStamp";

type FiscalStampRow = {
  id: number;
  stampNumber: string;
  validFrom: string;
  /** Optional (issue #290): SIFEN does not require an end of validity. */
  validUntil: string | null;
  rangeFrom: number;
  /** Optional (issue #290): SIFEN does not require an upper number. */
  rangeTo: number | null;
  nextEmissionNumber: number;
  active: boolean;
  lockedAfterInvoice: boolean;
  establishment: number;
  expeditionPoint: number;
  hasInvoices: boolean;
};

const EDIT_FIELD_KEYS = [
  "editStampNumber",
  "editValidFrom",
  "editValidUntil",
  "editRangeFrom",
  "editRangeTo",
] as const;

function parsePositiveInt(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

/** SIFEN establecimiento/punto de expedición occupy 3 digits in the CDC (0-999). */
function parseSifenField(raw: string): number | null {
  const n = parsePositiveInt(raw);
  if (n === null || n > 999) return null;
  return n;
}

/**
 * Issue #290: `iso` is a plain calendar date ("YYYY-MM-DD"). `new Date(iso)` would read it as UTC
 * midnight and show the previous day west of UTC (Paraguay), so parse it as a local date instead.
 */
function fmtDateShort(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(`${iso}T00:00:00`),
    );
  } catch {
    return iso;
  }
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
  const [establishment, setEstablishment] = useState("");
  const [expeditionPoint, setExpeditionPoint] = useState("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [createOpen, setCreateOpen] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editStampNumber, setEditStampNumber] = useState("");
  const [editRangeFrom, setEditRangeFrom] = useState("");
  const [editRangeTo, setEditRangeTo] = useState("");
  const [editValidFrom, setEditValidFrom] = useState("");
  const [editValidUntil, setEditValidUntil] = useState("");
  const [editStartingEmission, setEditStartingEmission] = useState("");
  const [editEstablishment, setEditEstablishment] = useState("");
  const [editExpeditionPoint, setEditExpeditionPoint] = useState("");
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    validateStampFields(err, {
      validFrom,
      validUntil,
      rangeFrom,
      rangeTo,
      emission: initialEmission,
      keys: {
        validFrom: "validFrom",
        validUntil: "validUntil",
        rangeFrom: "rangeFrom",
        rangeTo: "rangeTo",
        emission: "initialEmission",
      },
    });
    if (establishment.trim() !== "" && parseSifenField(establishment) === null) {
      err.establishment = t("femme.fiscalStamp.sifenFieldInvalid");
    }
    if (expeditionPoint.trim() !== "" && parseSifenField(expeditionPoint) === null) {
      err.expeditionPoint = t("femme.fiscalStamp.sifenFieldInvalid");
    }
    return err;
  }

  /**
   * Shared create/edit checks. Issue #290: the end of validity and the "to" number are optional, so
   * their order/range checks only run when they're filled in.
   */
  function validateStampFields(
    err: Record<string, string | null>,
    f: {
      validFrom: string;
      validUntil: string;
      rangeFrom: string;
      rangeTo: string;
      emission: string;
      keys: Record<"validFrom" | "validUntil" | "rangeFrom" | "rangeTo" | "emission", string>;
    },
  ) {
    if (!f.validFrom) err[f.keys.validFrom] = t("femme.fiscalStamp.dateRequired");
    const rf = parsePositiveInt(f.rangeFrom);
    const rt = f.rangeTo.trim() === "" ? null : parsePositiveInt(f.rangeTo);
    const ie = parsePositiveInt(f.emission);
    if (rf === null) err[f.keys.rangeFrom] = t("femme.fiscalStamp.integerInvalid");
    if (f.rangeTo.trim() !== "" && rt === null) {
      err[f.keys.rangeTo] = t("femme.fiscalStamp.integerInvalid");
    }
    if (ie === null) err[f.keys.emission] = t("femme.fiscalStamp.integerInvalid");
    if (rf !== null && rt !== null && rf > rt) {
      err[f.keys.rangeTo] = t("femme.fiscalStamp.rangeOrder");
    }
    if (f.validFrom && f.validUntil && f.validFrom >= f.validUntil) {
      err[f.keys.validUntil] = t("femme.fiscalStamp.validUntilBeforeFrom");
    }
    if (rf !== null && ie !== null && !err[f.keys.emission]) {
      if (rt !== null && (ie < rf || ie > rt)) {
        err[f.keys.emission] = t("femme.fiscalStamp.initialEmissionRange", { from: rf, to: rt });
      } else if (rt === null && ie < rf) {
        err[f.keys.emission] = t("femme.fiscalStamp.initialEmissionMin", { from: rf });
      }
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setSuccessMessage(null);
    const err = validateCreateForm();
    setFieldErrors(err);
    if (Object.keys(err).length > 0) return;

    const rf = parsePositiveInt(rangeFrom)!;
    const rt = rangeTo.trim() === "" ? null : parsePositiveInt(rangeTo)!;
    const ie = parsePositiveInt(initialEmission)!;
    const est = establishment.trim() === "" ? undefined : parseSifenField(establishment)!;
    const exp = expeditionPoint.trim() === "" ? undefined : parseSifenField(expeditionPoint)!;

    setCreating(true);
    setSaveError(null);
    try {
      await femmePostJson<FiscalStampRow>("/api/fiscal-stamps", {
        stampNumber: stampNumber.trim(),
        validFrom,
        validUntil: validUntil || null,
        rangeFrom: rf,
        rangeTo: rt,
        initialEmissionNumber: ie,
        establishment: est,
        expeditionPoint: exp,
      });
      setSuccessMessage(t("femme.fiscalStamp.savedBody"));
      setCreateOpen(false);
      setStampNumber("");
      setValidFrom("");
      setValidUntil("");
      setRangeFrom("");
      setRangeTo("");
      setInitialEmission("");
      setEstablishment("");
      setExpeditionPoint("");
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
    setEditStampNumber(row.stampNumber);
    setEditValidFrom(row.validFrom);
    setEditValidUntil(row.validUntil ?? "");
    setEditRangeFrom(String(row.rangeFrom));
    setEditRangeTo(row.rangeTo === null ? "" : String(row.rangeTo));
    setEditStartingEmission(String(row.nextEmissionNumber));
    setEditEstablishment(String(row.establishment));
    setEditExpeditionPoint(String(row.expeditionPoint));
    setSaveError(null);
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const k of EDIT_FIELD_KEYS) delete next[k];
      delete next.editStartingEmission;
      delete next.editEstablishment;
      delete next.editExpeditionPoint;
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
    const sn = editStampNumber.trim();
    if (!sn || !/^\d+$/.test(sn)) {
      err.editStampNumber = t("femme.fiscalStamp.stampNumberInvalid");
    }
    validateStampFields(err, {
      validFrom: editValidFrom,
      validUntil: editValidUntil,
      rangeFrom: editRangeFrom,
      rangeTo: editRangeTo,
      emission: editStartingEmission,
      keys: {
        validFrom: "editValidFrom",
        validUntil: "editValidUntil",
        rangeFrom: "editRangeFrom",
        rangeTo: "editRangeTo",
        emission: "editStartingEmission",
      },
    });
    const nextN = parsePositiveInt(editStartingEmission);
    if (
      !err.editStartingEmission &&
      nextN !== null &&
      row &&
      row.lockedAfterInvoice &&
      nextN < row.nextEmissionNumber
    ) {
      err.editStartingEmission = t("femme.fiscalStamp.cannotMoveBackwardLocked");
    }
    const canEditEstablishment = !!row && !row.hasInvoices;
    const est = canEditEstablishment ? parseSifenField(editEstablishment) : row!.establishment;
    const exp = canEditEstablishment ? parseSifenField(editExpeditionPoint) : row!.expeditionPoint;
    if (canEditEstablishment && est === null) {
      err.editEstablishment = t("femme.fiscalStamp.sifenFieldInvalid");
    }
    if (canEditEstablishment && exp === null) {
      err.editExpeditionPoint = t("femme.fiscalStamp.sifenFieldInvalid");
    }
    setFieldErrors((prev) => ({ ...prev, ...err }));
    if (Object.keys(err).length > 0) return;

    setEditSaving(true);
    setSaveError(null);
    try {
      await femmePutJson<FiscalStampRow>(`/api/fiscal-stamps/${editingId}`, {
        stampNumber: sn,
        validFrom: editValidFrom,
        validUntil: editValidUntil || null,
        rangeFrom: parsePositiveInt(editRangeFrom)!,
        rangeTo: editRangeTo.trim() === "" ? null : parsePositiveInt(editRangeTo)!,
        nextEmissionNumber: nextN!,
        establishment: est,
        expeditionPoint: exp,
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

  /** Edit-modal field; `locked` fields are frozen once the stamp has invoices (issue #290). */
  function renderEditField(f: {
    id: string;
    errorKey: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    locked: boolean;
    type?: "date";
    inputMode?: "numeric";
    hint?: string;
  }) {
    const error = fieldErrors[f.errorKey];
    const hint = f.locked ? t("femme.fiscalStamp.fieldLockedHint") : f.hint;
    return (
      <div>
        <Label htmlFor={f.id}>{f.label}</Label>
        <Input
          id={f.id}
          type={f.type}
          inputMode={f.inputMode}
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
          disabled={f.locked}
          className="mt-1 w-full"
          invalid={!!error}
          aria-invalid={!!error}
          aria-describedby={error ? `${f.id}-err` : hint ? `${f.id}-hint` : undefined}
        />
        <FieldValidationError id={`${f.id}-err`}>{error}</FieldValidationError>
        {!error && hint ? (
          <p id={`${f.id}-hint`} className="mt-1 text-sm text-ink-3">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => Number(b.active) - Number(a.active)),
    [rows],
  );

  const filteredRows = useMemo(
    () =>
      filterByListQuery(sortedRows, stampListQuery, (r) => [
        r.stampNumber,
        String(r.rangeFrom),
        r.rangeTo === null ? "" : String(r.rangeTo),
        String(r.nextEmissionNumber),
        r.validFrom,
        r.validUntil ?? "",
      ]),
    [sortedRows, stampListQuery],
  );

  /** Create-form field: label, input and the validation error / hint. */
  function createField(f: {
    id: string;
    errorKey: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    type?: "date";
    inputMode?: "numeric";
    placeholder?: string;
    hint?: string;
  }) {
    const error = fieldErrors[f.errorKey];
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={f.id}>{f.label}</Label>
        <Input
          id={f.id}
          type={f.type}
          inputMode={f.inputMode}
          value={f.value}
          placeholder={f.placeholder}
          onChange={(e) => {
            f.onChange(e.target.value);
            clearCreateErrors();
          }}
          invalid={!!error}
          aria-describedby={error ? `${f.id}-err` : f.hint ? `${f.id}-hint` : undefined}
        />
        <FieldValidationError id={`${f.id}-err`}>{error}</FieldValidationError>
        {!error && f.hint ? (
          <p id={`${f.id}-hint`} className="text-sm text-ink-3">
            {f.hint}
          </p>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.fiscalStamp.loading")}</Text>
      </div>
    );
  }

  const stampLabel = (row: FiscalStampRow) =>
    `${String(row.establishment).padStart(3, "0")}-${String(row.expeditionPoint).padStart(3, "0")}-${String(row.nextEmissionNumber).padStart(7, "0")}`;

  return (
    <div className="flex flex-col gap-3">
      <SettingsHeaderAction>
        <Button
          type="button"
          className="min-h-11"
          data-tour="fiscal-stamp-form"
          data-testid="fiscal-stamp-add"
          onClick={() => {
            clearCreateErrors();
            setCreateOpen(true);
          }}
        >
          {t("femme.fiscalStamp.addNew")}
        </Button>
      </SettingsHeaderAction>
      {loadError ? (
        <Alert variant="destructive" title={t("femme.businessSettings.errorTitle")}>
          {loadError}
        </Alert>
      ) : null}
      {saveError && !createOpen && editingId === null ? (
        <Alert variant="destructive" title={t("femme.businessSettings.errorTitle")}>
          {saveError}
        </Alert>
      ) : null}
      {successMessage ? (
        <Alert variant="success" title={t("femme.businessSettings.savedTitle")}>
          {successMessage}
        </Alert>
      ) : null}

      <p className="px-0.5 text-sm text-ink-3">{t("femme.fiscalStamp.intro")}</p>

      {rows.length === 0 ? (
        <section data-testid="fiscal-stamp-current-section" className="rounded-card border border-line bg-surface p-4">
          <Text variant="muted">{t("femme.fiscalStamp.empty")}</Text>
        </section>
      ) : (
        <div data-tour="fiscal-stamp-list" className="flex flex-col gap-3">
          <ListSearchField
            id="fiscal-stamp-list-filter"
            value={stampListQuery}
            onChange={setStampListQuery}
            label={t("femme.listFilter.label")}
            placeholder={t("femme.listFilter.placeholder")}
          />
          <div
            data-testid="fiscal-stamp-current-section"
            className="rounded-card border border-line bg-surface shadow-sm"
          >
            {filteredRows.length === 0 ? (
              <p className="p-4 text-center text-sm text-ink-3">{t("femme.listFilter.noMatches")}</p>
            ) : (
              <ul>
                {filteredRows.map((row) => (
                  <li
                    key={row.id}
                    data-testid={`fiscal-stamp-row-${row.id}`}
                    className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-2 first:border-t-0"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-ink">
                          {t("femme.fiscalStamp.stampRowTitle", { number: row.stampNumber })}
                        </span>
                        <StatusBadge status={row.active ? "ACTIVE" : "INACTIVE"} />
                      </div>
                      <div className="text-sm text-ink-3">
                        {t("femme.fiscalStamp.stampRowLine", {
                          from: fmtDateShort(row.validFrom, dateLocale),
                          until: row.validUntil ? fmtDateShort(row.validUntil, dateLocale) : t("femme.fiscalStamp.notSet"),
                          next: stampLabel(row),
                        })}
                      </div>
                    </div>
                    <KebabMenu
                      id={`fiscal-stamp-${row.id}`}
                      triggerAriaLabel={t("femme.fiscalStamp.rowActions", { number: row.stampNumber })}
                      items={[
                        { id: "edit", label: t("femme.fiscalStamp.edit"), onSelect: () => openEdit(row) },
                        row.active
                          ? {
                              id: "deactivate",
                              label: t("femme.fiscalStamp.deactivate"),
                              onSelect: () => void onDeactivate(row.id),
                            }
                          : {
                              id: "activate",
                              label: t("femme.fiscalStamp.activate"),
                              onSelect: () => void onActivate(row.id),
                            },
                        ...(!row.hasInvoices
                          ? [
                              {
                                id: "delete",
                                label: t("femme.fiscalStamp.delete"),
                                destructive: true,
                                disabled: deleting,
                                onSelect: () => setDeleteTarget(row),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title={t("femme.fiscalStamp.addTitle")}
        className="max-w-lg"
        footer={
          <>
            <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" disabled={creating} onClick={() => setCreateOpen(false)}>
              {t("femme.fiscalStamp.cancel")}
            </Button>
            <Button
              type="submit"
              form="fiscal-stamp-create-form"
              className="min-h-11 w-full sm:w-auto"
              disabled={creating}
              data-testid="fiscal-stamp-create-submit"
            >
              {creating ? t("femme.fiscalStamp.saving") : t("femme.fiscalStamp.add")}
            </Button>
          </>
        }
      >
        <section data-testid="fiscal-stamp-create-section">
          <form id="fiscal-stamp-create-form" onSubmit={onCreate} noValidate className="flex flex-col gap-3">
            {saveError ? (
              <Alert variant="destructive" title={t("femme.businessSettings.errorTitle")}>
                {saveError}
              </Alert>
            ) : null}
            {createField({
              id: "fs-stamp",
              errorKey: "stampNumber",
              label: t("femme.fiscalStamp.stampNumber"),
              value: stampNumber,
              onChange: setStampNumber,
              inputMode: "numeric",
              placeholder: "12345678",
              hint: t("femme.fiscalStamp.stampNumberHint"),
            })}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {createField({ id: "fs-vf", errorKey: "validFrom", label: t("femme.fiscalStamp.validFrom"), value: validFrom, onChange: setValidFrom, type: "date" })}
              {createField({ id: "fs-vu", errorKey: "validUntil", label: t("femme.fiscalStamp.validUntil"), value: validUntil, onChange: setValidUntil, type: "date", hint: t("femme.fiscalStamp.optionalHint") })}
              {createField({ id: "fs-rf", errorKey: "rangeFrom", label: t("femme.fiscalStamp.rangeFrom"), value: rangeFrom, onChange: setRangeFrom, inputMode: "numeric" })}
              {createField({ id: "fs-rt", errorKey: "rangeTo", label: t("femme.fiscalStamp.rangeTo"), value: rangeTo, onChange: setRangeTo, inputMode: "numeric", hint: t("femme.fiscalStamp.optionalHint") })}
            </div>
            {createField({
              id: "fs-ie",
              errorKey: "initialEmission",
              label: t("femme.fiscalStamp.initialEmission"),
              value: initialEmission,
              onChange: setInitialEmission,
              inputMode: "numeric",
              placeholder: "1",
              hint: t("femme.fiscalStamp.initialEmissionHintLegacy"),
            })}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {createField({ id: "fs-est", errorKey: "establishment", label: t("femme.fiscalStamp.establishment"), value: establishment, onChange: setEstablishment, inputMode: "numeric", placeholder: "1", hint: t("femme.fiscalStamp.establishmentHint") })}
              {createField({ id: "fs-exp", errorKey: "expeditionPoint", label: t("femme.fiscalStamp.expeditionPoint"), value: expeditionPoint, onChange: setExpeditionPoint, inputMode: "numeric", placeholder: "1", hint: t("femme.fiscalStamp.expeditionPointHint") })}
            </div>
          </form>
        </section>
      </Modal>

      <Modal
        open={editingId !== null}
        onClose={() => !editSaving && closeEdit()}
        title={t("femme.fiscalStamp.editTitle")}
        description={t("femme.fiscalStamp.editLead")}
        className="max-w-lg"
        footer={
          <>
            <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" disabled={editSaving} onClick={closeEdit}>
              {t("femme.fiscalStamp.cancel")}
            </Button>
            <Button
              type="submit"
              form="fiscal-stamp-edit-form"
              variant="primary"
              className="min-h-11 w-full sm:w-auto"
              disabled={editSaving}
            >
              {editSaving ? t("femme.fiscalStamp.saving") : t("femme.fiscalStamp.save")}
            </Button>
          </>
        }
      >
        <form id="fiscal-stamp-edit-form" className="flex flex-col gap-3" onSubmit={onSaveEdit} noValidate>
          {saveError ? (
            <Alert variant="destructive" title={t("femme.businessSettings.errorTitle")}>
              {saveError}
            </Alert>
          ) : null}
              {renderEditField({
                id: "edit-stamp-number",
                errorKey: "editStampNumber",
                label: t("femme.fiscalStamp.stampNumber"),
                value: editStampNumber,
                onChange: setEditStampNumber,
                inputMode: "numeric",
                locked: !!editingRow?.hasInvoices,
                hint: t("femme.fiscalStamp.stampNumberHint"),
              })}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {renderEditField({
                  id: "edit-valid-from",
                  errorKey: "editValidFrom",
                  label: t("femme.fiscalStamp.validFrom"),
                  value: editValidFrom,
                  onChange: setEditValidFrom,
                  type: "date",
                  locked: !!editingRow?.hasInvoices,
                })}
                {renderEditField({
                  id: "edit-valid-until",
                  errorKey: "editValidUntil",
                  label: t("femme.fiscalStamp.validUntil"),
                  value: editValidUntil,
                  onChange: setEditValidUntil,
                  type: "date",
                  locked: false,
                  hint: t("femme.fiscalStamp.optionalHint"),
                })}
                {renderEditField({
                  id: "edit-range-from",
                  errorKey: "editRangeFrom",
                  label: t("femme.fiscalStamp.rangeFrom"),
                  value: editRangeFrom,
                  onChange: setEditRangeFrom,
                  inputMode: "numeric",
                  locked: !!editingRow?.hasInvoices,
                })}
                {renderEditField({
                  id: "edit-range-to",
                  errorKey: "editRangeTo",
                  label: t("femme.fiscalStamp.rangeTo"),
                  value: editRangeTo,
                  onChange: setEditRangeTo,
                  inputMode: "numeric",
                  locked: false,
                  hint: t("femme.fiscalStamp.optionalHint"),
                })}
              </div>
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
                  <p id="edit-start-hint" className="mt-1 text-sm text-ink-3">
                    {editingRow?.lockedAfterInvoice
                      ? t("femme.fiscalStamp.initialEmissionHintLocked")
                      : t("femme.fiscalStamp.initialEmissionHint")}
                  </p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="edit-establishment">{t("femme.fiscalStamp.establishment")}</Label>
                <Input
                  id="edit-establishment"
                  inputMode="numeric"
                  value={editEstablishment}
                  onChange={(e) => setEditEstablishment(e.target.value)}
                  disabled={!!editingRow?.hasInvoices}
                  className="mt-1 w-full"
                  aria-invalid={!!fieldErrors.editEstablishment}
                  aria-describedby={
                    fieldErrors.editEstablishment ? "edit-establishment-err" : "edit-establishment-hint"
                  }
                />
                <FieldValidationError id="edit-establishment-err">
                  {fieldErrors.editEstablishment}
                </FieldValidationError>
                {!fieldErrors.editEstablishment ? (
                  <p id="edit-establishment-hint" className="mt-1 text-sm text-ink-3">
                    {editingRow?.hasInvoices
                      ? t("femme.fiscalStamp.establishmentEditLockedHint")
                      : t("femme.fiscalStamp.establishmentHint")}
                  </p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="edit-expedition-point">
                  {t("femme.fiscalStamp.expeditionPoint")}
                </Label>
                <Input
                  id="edit-expedition-point"
                  inputMode="numeric"
                  value={editExpeditionPoint}
                  onChange={(e) => setEditExpeditionPoint(e.target.value)}
                  disabled={!!editingRow?.hasInvoices}
                  className="mt-1 w-full"
                  aria-invalid={!!fieldErrors.editExpeditionPoint}
                  aria-describedby={
                    fieldErrors.editExpeditionPoint
                      ? "edit-expedition-point-err"
                      : "edit-expedition-point-hint"
                  }
                />
                <FieldValidationError id="edit-expedition-point-err">
                  {fieldErrors.editExpeditionPoint}
                </FieldValidationError>
                {!fieldErrors.editExpeditionPoint ? (
                  <p id="edit-expedition-point-hint" className="mt-1 text-sm text-ink-3">
                    {editingRow?.hasInvoices
                      ? t("femme.fiscalStamp.establishmentEditLockedHint")
                      : t("femme.fiscalStamp.expeditionPointHint")}
                  </p>
                ) : null}
              </div>
        </form>
      </Modal>

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
