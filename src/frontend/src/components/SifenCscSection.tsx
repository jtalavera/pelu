import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Text } from "@design-system";
import {
  activateSifenCsc,
  fetchSifenEnvironment,
  listSifenCsc,
  saveSifenCsc,
  type SifenCscRow,
  type SifenEnvironment,
} from "../api/sifenCsc";
import { translateApiError } from "../api/parseApiErrorMessage";
import { useDateLocale } from "../i18n/dateLocale";
import { FieldValidationError } from "./FieldValidationError";
import { StatusBadge } from "./StatusBadge";
import {
  buildInputStyle,
  createSectionCardStyle,
  formGridStyle,
  fullRowStyle,
  hintStyle,
  labelStyle,
  sectionCardStyle,
  sectionTitleStyle,
  tableWrapStyle,
  tdStyle,
  thStyle,
} from "./sifenFormStyles";

/** The DNIT's CSC: exactly 32 alphanumeric characters (Manual Técnico V150 §13.8.1). */
const CSC_FORMAT = /^[A-Za-z0-9]{32}$/;
const MIN_ID_CSC = 1;
const MAX_ID_CSC = 9999;

/**
 * The tenant's "Código de seguridad (CSC)". The DNIT issues each taxpayer its own CSC and the QR of
 * its invoices is hashed with the active one. Two modes, one component:
 *  - **read-only** (no `tenantId`): the salon's administrator sees which CSCs the platform loaded
 *    for the salon and which is active (Configuración → SIFEN). No form, no activation.
 *  - **manage** (`tenantId`): the platform's root user loads / replaces / activates a CSC for that
 *    tenant (Plataforma → Salones → SIFEN).
 * The CSC is a secret: write-only — once saved it is never shown again, only replaced.
 */
export function SifenCscSection({
  tenantId,
  environment: knownEnvironment,
}: {
  tenantId?: number;
  /** Given by the root user's page (it has no tenant, so it cannot call /api/sifen/environment). */
  environment?: SifenEnvironment | null;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const manage = tenantId != null;

  const [rows, setRows] = useState<SifenCscRow[]>([]);
  const [fetchedEnvironment, setFetchedEnvironment] = useState<SifenEnvironment | null>(null);
  const environment = knownEnvironment ?? fetchedEnvironment;
  const [loadError, setLoadError] = useState<string | null>(null);

  const [idCsc, setIdCsc] = useState("");
  const [csc, setCsc] = useState("");
  const [focusField, setFocusField] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ idCsc?: string; csc?: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ idCsc: number; replaced: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setRows(await listSifenCsc(tenantId));
    } catch {
      setLoadError(t("femme.sifenCsc.loadError"));
    }
  }, [t, tenantId]);

  useEffect(() => {
    void load();
    if (knownEnvironment == null) void fetchSifenEnvironment().then(setFetchedEnvironment);
  }, [load, knownEnvironment]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (tenantId == null) return;
    setSaveError(null);
    setSaved(null);
    setActionError(null);

    const errs: { idCsc?: string; csc?: string } = {};
    const idRaw = idCsc.trim();
    const idNum = /^\d+$/.test(idRaw) ? Number(idRaw) : NaN;
    if (!Number.isInteger(idNum) || idNum < MIN_ID_CSC || idNum > MAX_ID_CSC) {
      errs.idCsc = t("femme.sifenCsc.idInvalid");
    }
    const cscValue = csc.trim();
    if (!CSC_FORMAT.test(cscValue)) {
      errs.csc = t("femme.sifenCsc.cscInvalid");
    }
    setFieldErrors(errs);
    if (errs.idCsc || errs.csc) return;

    setSaving(true);
    try {
      const replaced = rows.some((r) => r.idCsc === idNum);
      await saveSifenCsc(tenantId, idNum, cscValue);
      setSaved({ idCsc: idNum, replaced });
      // The secret must not linger in the DOM/state after it was stored.
      setCsc("");
      setIdCsc("");
      await load();
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.sifenCsc.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function onActivate(id: number) {
    if (tenantId == null) return;
    setActionError(null);
    setSaved(null);
    setActivating(id);
    try {
      await activateSifenCsc(tenantId, id);
      await load();
    } catch (err) {
      setActionError(translateApiError(err, t, "femme.sifenCsc.saveError"));
    } finally {
      setActivating(null);
    }
  }

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(dateLocale, { dateStyle: "medium" }).format(new Date(iso));

  const hasActive = rows.some((r) => r.active);

  return (
    <section data-testid="sifen-csc-section">
      {loadError ? (
        <Alert variant="destructive" title={t("femme.sifenCsc.errorTitle")}>
          {loadError}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="destructive" title={t("femme.sifenCsc.errorTitle")}>
          {actionError}
        </Alert>
      ) : null}
      {saveError ? (
        <Alert variant="destructive" title={t("femme.sifenCsc.errorTitle")}>
          {saveError}
        </Alert>
      ) : null}
      {saved ? (
        <Alert variant="success" title={t("femme.sifenCsc.savedTitle")} data-testid="sifen-csc-saved">
          {t(saved.replaced ? "femme.sifenCsc.replacedBody" : "femme.sifenCsc.savedBody", {
            idCsc: String(saved.idCsc).padStart(4, "0"),
          })}
        </Alert>
      ) : null}

      {!hasActive && environment === "PRODUCTION" ? (
        <div data-testid="sifen-csc-missing-production">
          <Alert variant="destructive" title={t("femme.sifenCsc.missingProductionTitle")}>
            {t(
              manage
                ? "femme.sifenCsc.missingProductionBody"
                : "femme.sifenCsc.missingProductionBodyReadOnly",
            )}
          </Alert>
        </div>
      ) : null}
      {!hasActive && environment === "TEST" ? (
        <div data-testid="sifen-csc-test-fallback">
          <Alert variant="info" title={t("femme.sifenCsc.testFallbackTitle")}>
            {t(
              manage
                ? "femme.sifenCsc.testFallbackBody"
                : "femme.sifenCsc.testFallbackBodyReadOnly",
            )}
          </Alert>
        </div>
      ) : null}

      {manage ? (
        <div data-testid="sifen-csc-form-card" style={{ ...createSectionCardStyle, marginTop: 12 }}>
          <div style={sectionTitleStyle}>{t("femme.sifenCsc.formTitle")}</div>
          <Text variant="small" style={{ color: "var(--color-ink-3)", marginBottom: 12 }}>
            {t("femme.sifenCsc.lead")}
          </Text>
          <form onSubmit={onSubmit} noValidate autoComplete="off" style={formGridStyle}>
            <div>
              <label htmlFor="sifen-csc-id" style={labelStyle}>
                {t("femme.sifenCsc.idLabel")}
              </label>
              <input
                id="sifen-csc-id"
                inputMode="numeric"
                value={idCsc}
                maxLength={4}
                placeholder="0001"
                onChange={(e) => {
                  setIdCsc(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, idCsc: undefined }));
                }}
                aria-invalid={fieldErrors.idCsc ? "true" : "false"}
                aria-describedby={fieldErrors.idCsc ? "sifen-csc-id-err" : "sifen-csc-id-hint"}
                onFocus={() => setFocusField("sifen-csc-id")}
                onBlur={() => setFocusField(null)}
                style={buildInputStyle(!!fieldErrors.idCsc, focusField === "sifen-csc-id")}
              />
              <FieldValidationError id="sifen-csc-id-err">{fieldErrors.idCsc}</FieldValidationError>
              <p id="sifen-csc-id-hint" style={hintStyle}>
                {t("femme.sifenCsc.idHint")}
              </p>
            </div>
            <div>
              <label htmlFor="sifen-csc-value" style={labelStyle}>
                {t("femme.sifenCsc.cscLabel")}
              </label>
              <input
                id="sifen-csc-value"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={csc}
                maxLength={40}
                onChange={(e) => {
                  setCsc(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, csc: undefined }));
                }}
                aria-invalid={fieldErrors.csc ? "true" : "false"}
                aria-describedby={
                  fieldErrors.csc ? "sifen-csc-value-err" : "sifen-csc-value-hint"
                }
                onFocus={() => setFocusField("sifen-csc-value")}
                onBlur={() => setFocusField(null)}
                style={buildInputStyle(!!fieldErrors.csc, focusField === "sifen-csc-value")}
              />
              <FieldValidationError id="sifen-csc-value-err">{fieldErrors.csc}</FieldValidationError>
              <p id="sifen-csc-value-hint" style={hintStyle}>
                {t("femme.sifenCsc.cscHint")}
              </p>
            </div>
            <div style={{ ...fullRowStyle, marginTop: 4 }}>
              <Text variant="small" style={{ color: "var(--color-ink-3)", marginBottom: 10 }}>
                {t("femme.sifenCsc.secretNote")}
              </Text>
              <Button type="submit" variant="primary" className="min-h-11" disabled={saving}>
                {saving ? t("femme.sifenCsc.saving") : t("femme.sifenCsc.save")}
              </Button>
            </div>
          </form>
        </div>
      ) : (
        <div data-testid="sifen-csc-readonly-note" style={{ marginTop: 12, marginBottom: 16 }}>
          <Alert variant="info" title={t("femme.sifenCsc.readOnlyTitle")}>
            {t("femme.sifenCsc.readOnlyBody")}
          </Alert>
        </div>
      )}

      <div data-testid="sifen-csc-list-card" style={sectionCardStyle}>
        <div style={sectionTitleStyle}>{t("femme.sifenCsc.listTitle")}</div>
        {rows.length === 0 ? (
          <Text variant="muted" data-testid="sifen-csc-empty">
            {t(manage ? "femme.sifenCsc.empty" : "femme.sifenCsc.emptyReadOnly")}
          </Text>
        ) : (
          <div style={tableWrapStyle}>
            <div className="overflow-x-auto">
              <table className="min-w-full" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t("femme.sifenCsc.colId")}</th>
                    <th style={thStyle}>{t("femme.sifenCsc.colStatus")}</th>
                    <th style={thStyle}>{t("femme.sifenCsc.colUpdated")}</th>
                    <th style={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.idCsc} data-testid={`sifen-csc-row-${row.idCsc}`}>
                      <td style={tdStyle}>{String(row.idCsc).padStart(4, "0")}</td>
                      <td style={tdStyle}>
                        <StatusBadge status={row.active ? "ACTIVE" : "INACTIVE"} />
                      </td>
                      <td style={tdStyle}>{fmtDate(row.updatedAt)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        {row.active || !manage ? null : (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="min-h-11"
                            disabled={activating === row.idCsc}
                            data-testid={`sifen-csc-activate-${row.idCsc}`}
                            onClick={() => void onActivate(row.idCsc)}
                          >
                            {activating === row.idCsc
                              ? t("femme.sifenCsc.activating")
                              : t("femme.sifenCsc.activate")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
