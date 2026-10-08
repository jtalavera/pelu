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

/** The DNIT's CSC: exactly 32 alphanumeric characters (Manual Técnico V150 §13.8.1). */
const CSC_FORMAT = /^[A-Za-z0-9]{32}$/;
const MIN_ID_CSC = 1;
const MAX_ID_CSC = 9999;

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--color-ink-2)",
  marginBottom: 4,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.06em",
  color: "var(--color-ink-3)",
  textTransform: "uppercase",
  margin: "0 0 10px",
  paddingBottom: 6,
  borderBottom: "var(--border-default)",
};

const cardStyle: React.CSSProperties = {
  border: "var(--border-default)",
  borderRadius: "var(--radius-xl)",
  padding: 16,
  marginBottom: 16,
  background: "var(--color-stone)",
};

const tableWrapStyle: React.CSSProperties = {
  border: "var(--border-default)",
  borderRadius: "var(--radius-xl)",
  overflow: "hidden",
};

const thStyle: React.CSSProperties = {
  padding: "9px 12px",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--color-ink-3)",
  background: "var(--color-stone)",
  textAlign: "left",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 12,
  borderTop: "var(--border-default)",
  verticalAlign: "middle",
};

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
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
}

/**
 * Configuración → SIFEN → "Código de seguridad (CSC)". Each salon loads the CSC the DNIT issued to
 * it (a distinct one per taxpayer); the QR of its invoices is hashed with the active one. The CSC
 * is a secret: it is write-only here — once saved it is never shown again, only replaced.
 */
export function SifenCscSection() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();

  const [rows, setRows] = useState<SifenCscRow[]>([]);
  const [environment, setEnvironment] = useState<SifenEnvironment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [idCsc, setIdCsc] = useState("");
  const [csc, setCsc] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ idCsc?: string; csc?: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ idCsc: number; replaced: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setRows(await listSifenCsc());
    } catch {
      setLoadError(t("femme.sifenCsc.loadError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
    void fetchSifenEnvironment().then(setEnvironment);
  }, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
      await saveSifenCsc(idNum, cscValue);
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
    setActionError(null);
    setSaved(null);
    setActivating(id);
    try {
      await activateSifenCsc(id);
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
            {t("femme.sifenCsc.missingProductionBody")}
          </Alert>
        </div>
      ) : null}
      {!hasActive && environment === "TEST" ? (
        <div data-testid="sifen-csc-test-fallback">
          <Alert variant="info" title={t("femme.sifenCsc.testFallbackTitle")}>
            {t("femme.sifenCsc.testFallbackBody")}
          </Alert>
        </div>
      ) : null}

      <div data-testid="sifen-csc-form-card" style={{ ...cardStyle, marginTop: 12 }}>
        <div style={sectionTitleStyle}>{t("femme.sifenCsc.formTitle")}</div>
        <Text variant="small" style={{ color: "var(--color-ink-3)", marginBottom: 14 }}>
          {t("femme.sifenCsc.lead")}
        </Text>
        <form
          onSubmit={onSubmit}
          noValidate
          autoComplete="off"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
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
              aria-describedby={fieldErrors.idCsc ? "sifen-csc-id-err" : undefined}
              style={{ ...inputStyle(!!fieldErrors.idCsc), maxWidth: 160 }}
            />
            <FieldValidationError id="sifen-csc-id-err">{fieldErrors.idCsc}</FieldValidationError>
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
              aria-describedby={fieldErrors.csc ? "sifen-csc-value-err" : undefined}
              style={{ ...inputStyle(!!fieldErrors.csc), maxWidth: 420 }}
            />
            <FieldValidationError id="sifen-csc-value-err">{fieldErrors.csc}</FieldValidationError>
            <Text variant="small" style={{ color: "var(--color-ink-3)", marginTop: 4 }}>
              {t("femme.sifenCsc.secretNote")}
            </Text>
          </div>
          <div>
            <Button type="submit" variant="primary" className="min-h-11" disabled={saving}>
              {saving ? t("femme.sifenCsc.saving") : t("femme.sifenCsc.save")}
            </Button>
          </div>
        </form>
      </div>

      <div style={sectionTitleStyle}>{t("femme.sifenCsc.listTitle")}</div>
      {rows.length === 0 ? (
        <Text variant="muted" data-testid="sifen-csc-empty">
          {t("femme.sifenCsc.empty")}
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
                      {row.active ? null : (
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
    </section>
  );
}
