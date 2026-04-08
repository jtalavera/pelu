import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Heading,
  Input,
  Label,
  Spinner,
  Text,
} from "@design-system";
import { femmeJson, femmePostJson, femmePutJson } from "../api/femmeClient";
import { parseApiErrorMessage } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";

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

export default function FiscalStampSettingsPage() {
  const { t } = useTranslation();
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

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValidFrom, setEditValidFrom] = useState("");
  const [editValidUntil, setEditValidUntil] = useState("");
  const [editNext, setEditNext] = useState("");
  const [editSaving, setEditSaving] = useState(false);

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
      const msg = parseApiErrorMessage(err);
      setSaveError(msg || t("femme.fiscalStamp.saveError"));
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
      setSaveError(parseApiErrorMessage(err) || t("femme.fiscalStamp.saveError"));
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
      setSaveError(parseApiErrorMessage(err) || t("femme.fiscalStamp.saveError"));
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
      setSaveError(parseApiErrorMessage(err) || t("femme.fiscalStamp.saveError"));
    } finally {
      setEditSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.fiscalStamp.loading")}</Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Heading as="h1">{t("femme.fiscalStamp.title")}</Heading>
        <Text variant="muted" className="mt-1">
          {t("femme.fiscalStamp.lead")}
        </Text>
      </div>

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

      <Card className="p-4 sm:p-6">
        <Heading as="h2" className="text-lg">
          {t("femme.fiscalStamp.registeredTitle")}
        </Heading>
        <div className="mt-4 flex flex-col gap-4">
          {rows.length === 0 ? (
            <Text variant="muted">{t("femme.fiscalStamp.empty")}</Text>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="rounded-lg border border-[rgb(var(--color-border))] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Text className="font-medium">
                    {t("femme.fiscalStamp.stampNumber")}: {row.stampNumber}
                  </Text>
                  {row.active ? (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-800/40 dark:text-emerald-100">
                      {t("femme.fiscalStamp.active")}
                    </span>
                  ) : (
                    <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                      {t("femme.fiscalStamp.inactive")}
                    </span>
                  )}
                </div>
                <Text variant="small" className="mt-2 text-[rgb(var(--color-muted-foreground))]">
                  {t("femme.fiscalStamp.rangeLabel", {
                    from: row.rangeFrom,
                    to: row.rangeTo,
                  })}
                  {" · "}
                  {t("femme.fiscalStamp.nextLabel")}: {row.nextEmissionNumber}
                </Text>
                <Text variant="small" className="mt-1 text-[rgb(var(--color-muted-foreground))]">
                  {t("femme.fiscalStamp.validityLabel", {
                    from: row.validFrom,
                    until: row.validUntil,
                  })}
                </Text>
                {row.lockedAfterInvoice ? (
                  <p className="mt-2 text-sm text-[rgb(var(--color-muted-foreground))]">
                    {t("femme.fiscalStamp.lockedHint")}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!row.active ? (
                    <Button
                      type="button"
                      variant="primary"
                      className="min-h-11"
                      onClick={() => void onActivate(row.id)}
                    >
                      {t("femme.fiscalStamp.activate")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => void onDeactivate(row.id)}
                    >
                      {t("femme.fiscalStamp.deactivate")}
                    </Button>
                  )}
                  {!row.lockedAfterInvoice ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => openEdit(row)}
                    >
                      {t("femme.fiscalStamp.edit")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="p-4 sm:p-6">
        <Heading as="h2" className="text-lg">
          {t("femme.fiscalStamp.addTitle")}
        </Heading>
        <form className="mt-4 flex flex-col gap-4" onSubmit={onCreate} noValidate>
          <div>
            <Label htmlFor="fs-stamp">{t("femme.fiscalStamp.stampNumber")}</Label>
            <Input
              id="fs-stamp"
              inputMode="numeric"
              value={stampNumber}
              onChange={(e) => {
                setStampNumber(e.target.value);
                clearCreateErrors();
              }}
              className="mt-1 w-full"
              placeholder="12345678"
              aria-invalid={!!fieldErrors.stampNumber}
              aria-describedby={fieldErrors.stampNumber ? "fs-stamp-err" : "fs-stamp-hint"}
            />
            <FieldValidationError id="fs-stamp-err">{fieldErrors.stampNumber}</FieldValidationError>
            <Text variant="small" id="fs-stamp-hint" className="mt-1 text-[rgb(var(--color-muted-foreground))]">
              {t("femme.fiscalStamp.stampNumberHint")}
            </Text>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="fs-vf">{t("femme.fiscalStamp.validFrom")}</Label>
              <Input
                id="fs-vf"
                type="date"
                value={validFrom}
                onChange={(e) => {
                  setValidFrom(e.target.value);
                  clearCreateErrors();
                }}
                className="mt-1 w-full"
                aria-invalid={!!fieldErrors.validFrom}
                aria-describedby={fieldErrors.validFrom ? "fs-vf-err" : undefined}
              />
              <FieldValidationError id="fs-vf-err">{fieldErrors.validFrom}</FieldValidationError>
            </div>
            <div>
              <Label htmlFor="fs-vu">{t("femme.fiscalStamp.validUntil")}</Label>
              <Input
                id="fs-vu"
                type="date"
                value={validUntil}
                onChange={(e) => {
                  setValidUntil(e.target.value);
                  clearCreateErrors();
                }}
                className="mt-1 w-full"
                aria-invalid={!!fieldErrors.validUntil}
                aria-describedby={fieldErrors.validUntil ? "fs-vu-err" : undefined}
              />
              <FieldValidationError id="fs-vu-err">{fieldErrors.validUntil}</FieldValidationError>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="fs-rf">{t("femme.fiscalStamp.rangeFrom")}</Label>
              <Input
                id="fs-rf"
                inputMode="numeric"
                value={rangeFrom}
                onChange={(e) => {
                  setRangeFrom(e.target.value);
                  clearCreateErrors();
                }}
                className="mt-1 w-full"
                aria-invalid={!!fieldErrors.rangeFrom}
                aria-describedby={fieldErrors.rangeFrom ? "fs-rf-err" : undefined}
              />
              <FieldValidationError id="fs-rf-err">{fieldErrors.rangeFrom}</FieldValidationError>
            </div>
            <div>
              <Label htmlFor="fs-rt">{t("femme.fiscalStamp.rangeTo")}</Label>
              <Input
                id="fs-rt"
                inputMode="numeric"
                value={rangeTo}
                onChange={(e) => {
                  setRangeTo(e.target.value);
                  clearCreateErrors();
                }}
                className="mt-1 w-full"
                aria-invalid={!!fieldErrors.rangeTo}
                aria-describedby={fieldErrors.rangeTo ? "fs-rt-err" : undefined}
              />
              <FieldValidationError id="fs-rt-err">{fieldErrors.rangeTo}</FieldValidationError>
            </div>
          </div>
          <div>
            <Label htmlFor="fs-ie">{t("femme.fiscalStamp.initialEmission")}</Label>
            <Input
              id="fs-ie"
              inputMode="numeric"
              value={initialEmission}
              onChange={(e) => {
                setInitialEmission(e.target.value);
                clearCreateErrors();
              }}
              className="mt-1 w-full"
              placeholder="1"
              aria-invalid={!!fieldErrors.initialEmission}
              aria-describedby={fieldErrors.initialEmission ? "fs-ie-err" : "fs-ie-hint"}
            />
            <FieldValidationError id="fs-ie-err">{fieldErrors.initialEmission}</FieldValidationError>
            <Text variant="small" id="fs-ie-hint" className="mt-1 text-[rgb(var(--color-muted-foreground))]">
              {t("femme.fiscalStamp.initialEmissionHint")}
            </Text>
          </div>
          <Button type="submit" variant="primary" className="min-h-11 w-full sm:w-auto" disabled={creating}>
            {creating ? t("femme.fiscalStamp.saving") : t("femme.fiscalStamp.add")}
          </Button>
        </form>
      </Card>

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
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[rgb(var(--color-border))] bg-[rgb(var(--color-card))] p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <Heading as="h2" id="fiscal-edit-title" className="text-lg">
              {t("femme.fiscalStamp.editTitle")}
            </Heading>
            <form className="mt-4 flex flex-col gap-4" onSubmit={onSaveEdit} noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
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
