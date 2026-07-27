import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Heading, Spinner, Text } from "@design-system";
import { femmeJson, femmePostJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";
import { useDateLocale } from "../i18n/dateLocale";
import { useMe } from "../hooks/useMe";

type SifenCertificateRow = {
  id: number;
  uploadedAt: string;
  notBefore: string;
  notAfter: string;
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--color-ink-2)",
  marginBottom: 4,
};

const sectionCardStyle: React.CSSProperties = {
  border: "var(--border-default)",
  borderRadius: "var(--radius-xl)",
  padding: 16,
  marginBottom: 16,
  background: "var(--color-white)",
};

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

export default function SifenCertificatesPage() {
  const { t } = useTranslation();
  const { me } = useMe();
  const dateLocale = useDateLocale();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isTenantAdmin = me?.role === "ADMIN";

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SifenCertificateRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!isTenantAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await femmeJson<SifenCertificateRow[]>("/api/sifen/certificates");
      setRows(data);
    } catch {
      setLoadError(t("femme.sifenCertificates.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t, isTenantAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setFieldErrors((prev) => ({ ...prev, file: null }));
    setSaveError(null);
    setSuccess(false);
  }

  function fmtDate(iso: string): string {
    try {
      return new Intl.DateTimeFormat(dateLocale, { dateStyle: "medium" }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      await femmePostJson("/api/sifen/certificates", { fileBase64, password });
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

  if (!isTenantAdmin) {
    return (
      <div>
        <Heading as="h2" className="text-[var(--color-ink)]">
          {t("femme.sifenCertificates.title")}
        </Heading>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]" role="alert">
          {t("femme.sifenCertificates.forbidden")}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "40vh",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        <Spinner size="lg" />
        <Text>{t("femme.sifenCertificates.loading")}</Text>
      </div>
    );
  }

  return (
    <div>
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

      <section data-testid="sifen-certificate-upload-section" style={sectionCardStyle}>
        <Text style={{ fontWeight: 500, marginBottom: 4 }}>
          {t("femme.sifenCertificates.uploadTitle")}
        </Text>
        <Text variant="small" style={{ color: "var(--color-ink-3)", marginBottom: 14 }}>
          {t("femme.sifenCertificates.uploadLead")}
        </Text>
        <form onSubmit={onSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
              aria-describedby={fieldErrors.file ? "sifen-cert-file-err" : undefined}
              style={{ fontSize: 12 }}
            />
            <FieldValidationError id="sifen-cert-file-err">{fieldErrors.file}</FieldValidationError>
          </div>
          <div>
            <label htmlFor="sifen-cert-password" style={labelStyle}>
              {t("femme.sifenCertificates.passwordLabel")}
            </label>
            <input
              id="sifen-cert-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setFieldErrors((prev) => ({ ...prev, password: null }));
                setSaveError(null);
                setSuccess(false);
              }}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={fieldErrors.password ? "sifen-cert-password-err" : undefined}
              style={{
                padding: "8px 11px",
                border: fieldErrors.password
                  ? "1px solid var(--color-danger)"
                  : "1px solid var(--color-stone-md)",
                borderRadius: "var(--radius-md)",
                fontSize: 12,
                width: "100%",
                boxSizing: "border-box",
              }}
            />
            <FieldValidationError id="sifen-cert-password-err">
              {fieldErrors.password}
            </FieldValidationError>
          </div>
          <div>
            <Button type="submit" variant="primary" className="min-h-11" disabled={uploading}>
              {uploading
                ? t("femme.sifenCertificates.uploading")
                : t("femme.sifenCertificates.upload")}
            </Button>
          </div>
        </form>
      </section>

      <section data-testid="sifen-certificate-list-section">
        <Text style={{ fontWeight: 500, marginBottom: 10 }}>
          {t("femme.sifenCertificates.listTitle")}
        </Text>
        {rows.length === 0 ? (
          <Text variant="muted">{t("femme.sifenCertificates.empty")}</Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((row) => (
              <div
                key={row.id}
                data-testid="sifen-certificate-row"
                style={{
                  border: "var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  padding: 12,
                  background: "var(--color-white)",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 16,
                  fontSize: 12,
                }}
              >
                <div>
                  <div style={{ color: "var(--color-ink-3)", fontSize: 10 }}>
                    {t("femme.sifenCertificates.colUploadedAt")}
                  </div>
                  <div>{fmtDate(row.uploadedAt)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--color-ink-3)", fontSize: 10 }}>
                    {t("femme.sifenCertificates.colNotBefore")}
                  </div>
                  <div>{fmtDate(row.notBefore)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--color-ink-3)", fontSize: 10 }}>
                    {t("femme.sifenCertificates.colNotAfter")}
                  </div>
                  <div>{fmtDate(row.notAfter)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
