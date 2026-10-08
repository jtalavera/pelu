import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Spinner, Text } from "@design-system";
import {
  listSifenCertificates,
  uploadSifenCertificate,
  type SifenCertificateRow,
  type SifenCertificateStatus,
} from "../api/sifenCertificates";
import { translateApiError } from "../api/parseApiErrorMessage";
import { useDateLocale } from "../i18n/dateLocale";
import { FieldValidationError } from "./FieldValidationError";
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

function stripDataUrlPrefix(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(",");
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) {
        reject(new Error("read failed"));
        return;
      }
      resolve(stripDataUrlPrefix(result));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * The tenant's SIFEN digital certificate(s). Two modes, one component:
 *  - **read-only** (no `tenantId`): the salon's administrator sees which certificates are loaded and
 *    their validity (Configuración → SIFEN). There is no upload form — the certificate is a fiscal
 *    credential loaded by the platform.
 *  - **manage** (`tenantId`): the platform's root user loads a certificate (.p12 + password) for
 *    that tenant (Plataforma → Salones → SIFEN).
 * The .p12 and its password are write-only: they are never shown again after the upload.
 */
export function SifenCertificatesPanel({ tenantId }: { tenantId?: number }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const manage = tenantId != null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SifenCertificateRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setRows(await listSifenCertificates(tenantId));
    } catch {
      setLoadError(t("femme.sifenCertificates.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setFieldErrors((prev) => ({ ...prev, file: null }));
    setSaveError(null);
    setSuccess(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (tenantId == null) return;
    setSuccess(false);
    setSaveError(null);
    const errs: Record<string, string | null> = {};
    if (!file) errs.file = t("femme.sifenCertificates.fileRequired");
    if (!password) errs.password = t("femme.sifenCertificates.passwordRequired");
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setUploading(true);
    try {
      const fileBase64 = await readFileAsBase64(file!);
      await uploadSifenCertificate(tenantId, fileBase64, password);
      setSuccess(true);
      setFile(null);
      setPassword("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (err) {
      setSaveError(translateApiError(err, t, "femme.sifenCertificates.saveError"));
    } finally {
      setUploading(false);
    }
  }

  function fmtDate(iso: string): string {
    try {
      return new Intl.DateTimeFormat(dateLocale, { dateStyle: "medium" }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  function statusBadge(status: SifenCertificateStatus) {
    const badgeStyle: React.CSSProperties = {
      fontSize: 10,
      fontWeight: 500,
      padding: "2px 8px",
      borderRadius: "var(--radius-pill)",
      whiteSpace: "nowrap",
    };
    if (status === "VALID") {
      return (
        <span
          style={{
            ...badgeStyle,
            background: "var(--color-timbrado-valid-bg)",
            color: "var(--color-timbrado-valid-fg)",
          }}
        >
          {t("femme.sifenCertificates.statusValid")}
        </span>
      );
    }
    if (status === "EXPIRED") {
      return (
        <span
          style={{ ...badgeStyle, background: "var(--color-danger-lt)", color: "var(--color-danger)" }}
        >
          {t("femme.sifenCertificates.statusExpired")}
        </span>
      );
    }
    return (
      <span style={{ ...badgeStyle, background: "var(--color-stone)", color: "var(--color-ink-2)" }}>
        {t("femme.sifenCertificates.statusNotYetValid")}
      </span>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "24px 0" }}>
        <Spinner size="md" />
        <Text>{t("femme.sifenCertificates.loading")}</Text>
      </div>
    );
  }

  return (
    <div data-testid="sifen-certificates-panel">
      {loadError ? (
        <Alert variant="destructive" title={t("femme.sifenCertificates.errorTitle")}>
          {loadError}
        </Alert>
      ) : null}
      {saveError ? (
        <Alert variant="destructive" title={t("femme.sifenCertificates.errorTitle")}>
          {saveError}
        </Alert>
      ) : null}
      {success ? (
        <Alert variant="success" title={t("femme.sifenCertificates.savedTitle")}>
          {t("femme.sifenCertificates.savedBody")}
        </Alert>
      ) : null}

      {manage ? (
        <section data-testid="sifen-certificate-upload-section" style={createSectionCardStyle}>
          <div style={sectionTitleStyle}>{t("femme.sifenCertificates.uploadTitle")}</div>
          <Text variant="small" style={{ color: "var(--color-ink-3)", marginBottom: 12 }}>
            {t("femme.sifenCertificates.uploadLead")}
          </Text>
          <form onSubmit={onSubmit} noValidate style={formGridStyle}>
            <div>
              <label htmlFor="sifen-cert-file" style={labelStyle}>
                {t("femme.sifenCertificates.fileLabel")}
              </label>
              <input
                id="sifen-cert-file"
                ref={fileInputRef}
                type="file"
                accept=".p12,application/x-pkcs12"
                onChange={onFileChange}
                aria-invalid={!!fieldErrors.file}
                aria-describedby={fieldErrors.file ? "sifen-cert-file-err" : "sifen-cert-file-hint"}
                style={{ ...buildInputStyle(!!fieldErrors.file, false), padding: "6px 8px" }}
              />
              <FieldValidationError id="sifen-cert-file-err">{fieldErrors.file}</FieldValidationError>
              <p id="sifen-cert-file-hint" style={hintStyle}>
                {t("femme.sifenCertificates.fileHint")}
              </p>
            </div>
            <div>
              <label htmlFor="sifen-cert-password" style={labelStyle}>
                {t("femme.sifenCertificates.passwordLabel")}
              </label>
              <input
                id="sifen-cert-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, password: null }));
                  setSaveError(null);
                  setSuccess(false);
                }}
                aria-invalid={!!fieldErrors.password}
                aria-describedby={
                  fieldErrors.password ? "sifen-cert-password-err" : "sifen-cert-password-hint"
                }
                onFocus={() => setFocusField("sifen-cert-password")}
                onBlur={() => setFocusField(null)}
                style={buildInputStyle(
                  !!fieldErrors.password,
                  focusField === "sifen-cert-password",
                )}
              />
              <FieldValidationError id="sifen-cert-password-err">
                {fieldErrors.password}
              </FieldValidationError>
              <p id="sifen-cert-password-hint" style={hintStyle}>
                {t("femme.sifenCertificates.passwordHint")}
              </p>
            </div>
            <div style={{ ...fullRowStyle, marginTop: 4 }}>
              <Button type="submit" variant="primary" className="min-h-11" disabled={uploading}>
                {uploading
                  ? t("femme.sifenCertificates.uploading")
                  : t("femme.sifenCertificates.upload")}
              </Button>
            </div>
          </form>
        </section>
      ) : (
        <div data-testid="sifen-certificate-readonly-note">
          <Alert variant="info" title={t("femme.sifenCertificates.readOnlyTitle")}>
            {t("femme.sifenCertificates.readOnlyBody")}
          </Alert>
        </div>
      )}

      <section
        data-testid="sifen-certificate-list-section"
        style={{ ...sectionCardStyle, marginTop: manage ? 0 : 12 }}
      >
        <div style={sectionTitleStyle}>{t("femme.sifenCertificates.listTitle")}</div>
        {rows.length === 0 ? (
          <div data-testid="sifen-certificate-empty-state">
            <Text variant="muted">
              {t(manage ? "femme.sifenCertificates.empty" : "femme.sifenCertificates.emptyReadOnly")}
            </Text>
          </div>
        ) : (
          <div style={tableWrapStyle}>
            <div className="overflow-x-auto">
              <table className="min-w-full" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t("femme.sifenCertificates.colUploadedAt")}</th>
                    <th style={thStyle}>{t("femme.sifenCertificates.colNotBefore")}</th>
                    <th style={thStyle}>{t("femme.sifenCertificates.colNotAfter")}</th>
                    <th style={thStyle}>{t("femme.sifenCertificates.colStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} data-testid="sifen-certificate-row">
                      <td style={tdStyle}>{fmtDate(row.uploadedAt)}</td>
                      <td style={tdStyle}>{fmtDate(row.notBefore)}</td>
                      <td style={tdStyle}>{fmtDate(row.notAfter)}</td>
                      <td style={tdStyle}>{statusBadge(row.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
