import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Label, Spinner, Text, Textarea } from "@design-system";
import {
  getClientTechnicalSheet,
  TECHNICAL_SHEET_MAX_LENGTH,
  updateClientTechnicalSheet,
  type ClientTechnicalSheet,
} from "../api/clientTechnicalSheet";
import { translateApiError } from "../api/parseApiErrorMessage";
import { useDateLocale } from "../i18n/dateLocale";
import { FieldValidationError } from "./FieldValidationError";

function formatEdited(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

type Props = {
  clientId: number;
  /** Show the client's name as a heading (modal / professional page). */
  showClientName?: boolean;
  /** Called after Cancel (and with the saved sheet after Save) so a container can close. */
  onCancel?: () => void;
  onLoaded?: (sheet: ClientTechnicalSheet) => void;
};

/**
 * HU-68: "Ficha técnica" — notes + color formula, editable by admins and professionals. Shared by
 * the client profile (admin), the calendar modal and the professional's technical sheet page.
 */
export function ClientTechnicalSheetForm({ clientId, showClientName, onCancel, onLoaded }: Props) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [sheet, setSheet] = useState<ClientTechnicalSheet | null>(null);
  const [notes, setNotes] = useState("");
  const [colorFormula, setColorFormula] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = useCallback((s: ClientTechnicalSheet) => {
    setSheet(s);
    setNotes(s.notes ?? "");
    setColorFormula(s.colorFormula ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSheet(null);
    setLoadError(null);
    setSaved(false);
    getClientTechnicalSheet(clientId)
      .then((s) => {
        if (cancelled) return;
        reset(s);
        onLoaded?.(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
      });
    return () => {
      cancelled = true;
    };
    // onLoaded is a notification callback; re-fetching when its identity changes is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, reset, t]);

  if (loadError) {
    return (
      <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
        {loadError}
      </Alert>
    );
  }
  if (sheet == null) {
    return <Spinner size="sm" />;
  }

  const readOnly = !sheet.active;
  const notesTooLong = notes.length > TECHNICAL_SHEET_MAX_LENGTH;
  const formulaTooLong = colorFormula.length > TECHNICAL_SHEET_MAX_LENGTH;
  const maxLengthMessage = t("femme.clients.technicalSheet.maxLength", {
    max: TECHNICAL_SHEET_MAX_LENGTH,
  });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setSaveError(null);
    if (notesTooLong || formulaTooLong) return;
    setSaving(true);
    try {
      const updated = await updateClientTechnicalSheet(clientId, {
        notes: notes.trim() === "" ? null : notes,
        colorFormula: colorFormula.trim() === "" ? null : colorFormula,
      });
      reset(updated);
      setSaved(true);
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setSaving(false);
    }
  };

  const onCancelClick = () => {
    reset(sheet);
    setSaveError(null);
    setSaved(false);
    onCancel?.();
  };

  const field = (
    id: string,
    label: string,
    value: string,
    setValue: (v: string) => void,
    tooLong: boolean,
    updatedAt: string | null,
    updatedBy: string | null,
  ) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        rows={4}
        disabled={readOnly || saving}
        invalid={tooLong}
        aria-describedby={`${id}-count${tooLong ? ` ${id}-err` : ""}`}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Text variant="muted" className="text-xs" data-testid={`${id}-edited`}>
          {updatedAt && updatedBy
            ? t("femme.clients.technicalSheet.editedBy", {
                name: updatedBy,
                date: formatEdited(updatedAt, dateLocale),
              })
            : null}
        </Text>
        <Text variant="muted" className="text-xs" id={`${id}-count`}>
          {t("femme.clients.technicalSheet.charCount", {
            count: value.length,
            max: TECHNICAL_SHEET_MAX_LENGTH,
          })}
        </Text>
      </div>
      {tooLong ? <FieldValidationError id={`${id}-err`}>{maxLengthMessage}</FieldValidationError> : null}
    </div>
  );

  return (
    <form
      data-testid="client-technical-sheet"
      className="flex flex-col gap-4"
      onSubmit={(e) => void onSubmit(e)}
    >
      {showClientName ? (
        <Text className="text-base font-semibold" data-testid="technical-sheet-client-name">
          {sheet.clientName}
        </Text>
      ) : null}
      {readOnly ? (
        <Alert variant="info">{t("femme.clients.technicalSheet.inactiveReadOnly")}</Alert>
      ) : null}
      {saved ? <Alert variant="success">{t("femme.clients.technicalSheet.saved")}</Alert> : null}
      {saveError ? (
        <Alert variant="destructive" title={t("femme.clients.errorTitle")}>
          {saveError}
        </Alert>
      ) : null}
      {field(
        "technical-sheet-notes",
        t("femme.clients.technicalSheet.notes"),
        notes,
        setNotes,
        notesTooLong,
        sheet.notesUpdatedAt,
        sheet.notesUpdatedBy,
      )}
      {field(
        "technical-sheet-color-formula",
        t("femme.clients.technicalSheet.colorFormula"),
        colorFormula,
        setColorFormula,
        formulaTooLong,
        sheet.colorFormulaUpdatedAt,
        sheet.colorFormulaUpdatedBy,
      )}
      {!readOnly ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancelClick} disabled={saving}>
            {t("femme.clients.technicalSheet.cancel")}
          </Button>
          <Button type="submit" disabled={saving || notesTooLong || formulaTooLong}>
            {saving ? t("femme.clients.saving") : t("femme.clients.technicalSheet.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
