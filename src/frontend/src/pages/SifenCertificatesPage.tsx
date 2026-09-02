import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Heading, Spinner, Text } from "@design-system";
import { femmeJson, femmePostJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";
import { useDateLocale } from "../i18n/dateLocale";
import { useMe } from "../hooks/useMe";

type SifenCertificateStatus = "VALID" | "EXPIRED" | "NOT_YET_VALID";

type SifenCertificateRow = {
  id: number;
  uploadedAt: string;
  notBefore: string;
  notAfter: string;
  status: SifenCertificateStatus;
};

type SifenNumberVoidingStatus =
  | "PENDING"
  | "APPROVED"
  | "APPROVED_WITH_OBSERVATION"
  | "REJECTED"
  | "CANCELLED";

function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return n;
}

type SifenNumberVoidingRow = {
  id: number;
  documentType: string;
  rangeFrom: number;
  rangeTo: number;
  reason: string | null;
  status: SifenNumberVoidingStatus;
  deadlineDate: string;
  message: string | null;
  invoiceId: number | null;
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

// Issue #190: certificates and voided numbers are shown in real tables, styled like the
// "Historial de comprobantes" table (stone header, uppercase micro-labels).
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
  verticalAlign: "top",
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

  const [voidingRows, setVoidingRows] = useState<SifenNumberVoidingRow[] | null>(null);
  const [voidingLoadError, setVoidingLoadError] = useState<string | null>(null);
  const [voidingReasons, setVoidingReasons] = useState<Record<number, string>>({});
  const [voidingSubmitting, setVoidingSubmitting] = useState<number | null>(null);
  const [voidingSubmitErrors, setVoidingSubmitErrors] = useState<Record<number, string>>({});

  const [manualFrom, setManualFrom] = useState("");
  const [manualTo, setManualTo] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualErrors, setManualErrors] = useState<Record<string, string | null>>({});
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!isTenantAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setVoidingLoadError(null);
    try {
      const data = await femmeJson<SifenCertificateRow[]>("/api/sifen/certificates");
      setRows(data);
    } catch {
      setLoadError(t("femme.sifenCertificates.loadError"));
    } finally {
      setLoading(false);
    }
    try {
      const voiding = await femmeJson<SifenNumberVoidingRow[]>("/api/sifen/number-voiding");
      setVoidingRows(voiding);
    } catch {
      setVoidingLoadError(t("femme.sifenNumberVoiding.loadError"));
    }
  }, [t, isTenantAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitVoiding(id: number) {
    const reason = (voidingReasons[id] ?? "").trim();
    setVoidingSubmitErrors((prev) => ({ ...prev, [id]: "" }));
    if (reason.length < 5) {
      setVoidingSubmitErrors((prev) => ({
        ...prev,
        [id]: t("femme.sifenNumberVoiding.reasonTooShort"),
      }));
      return;
    }
    setVoidingSubmitting(id);
    try {
      const updated = await femmePostJson<SifenNumberVoidingRow>(
        `/api/sifen/number-voiding/${id}/submit`,
        { reason },
      );
      setVoidingRows((prev) => (prev ? prev.map((r) => (r.id === id ? updated : r)) : prev));
    } catch (err) {
      setVoidingSubmitErrors((prev) => ({
        ...prev,
        [id]: translateApiError(err, t, "femme.apiErrors.GENERIC"),
      }));
    } finally {
      setVoidingSubmitting(null);
    }
  }

  async function createManualVoiding() {
    setManualError(null);
    setManualSuccess(false);
    const from = parsePositiveInt(manualFrom);
    const to = parsePositiveInt(manualTo);
    const reason = manualReason.trim();
    const errs: Record<string, string | null> = {};
    if (from == null || to == null) {
      errs.range = t("femme.sifenNumberVoiding.manualRangeInvalid");
    } else if (from > to) {
      errs.range = t("femme.sifenNumberVoiding.manualRangeOrder");
    }
    if (reason.length < 5) {
      errs.reason = t("femme.sifenNumberVoiding.reasonTooShort");
    }
    setManualErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setManualSubmitting(true);
    try {
      const created = await femmePostJson<SifenNumberVoidingRow>("/api/sifen/number-voiding", {
        rangeFrom: from,
        rangeTo: to,
        reason,
      });
      setVoidingRows((prev) => [created, ...(prev ?? [])]);
      setManualFrom("");
      setManualTo("");
      setManualReason("");
      setManualSuccess(true);
    } catch (err) {
      setManualError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setManualSubmitting(false);
    }
  }

  function deadlineLabel(deadlineDate: string): { text: string; overdue: boolean } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(`${deadlineDate}T00:00:00`);
    const days = Math.round((deadline.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (days < 0) {
      return { text: t("femme.sifenNumberVoiding.deadlineOverdue"), overdue: true };
    }
    return { text: t("femme.sifenNumberVoiding.deadlineDaysLeft", { count: days }), overdue: false };
  }

  function voidingStatusBadge(status: SifenNumberVoidingStatus) {
    const badgeStyle: React.CSSProperties = {
      fontSize: 10,
      fontWeight: 500,
      padding: "2px 8px",
      borderRadius: "var(--radius-pill)",
      whiteSpace: "nowrap",
    };
    if (status === "APPROVED" || status === "APPROVED_WITH_OBSERVATION") {
      return (
        <span
          style={{
            ...badgeStyle,
            background: "var(--color-timbrado-valid-bg)",
            color: "var(--color-timbrado-valid-fg)",
          }}
        >
          {t(
            status === "APPROVED"
              ? "femme.sifenNumberVoiding.statusApproved"
              : "femme.sifenNumberVoiding.statusApprovedWithObservation",
          )}
        </span>
      );
    }
    if (status === "REJECTED") {
      return (
        <span
          style={{ ...badgeStyle, background: "var(--color-danger-lt)", color: "var(--color-danger)" }}
        >
          {t("femme.sifenNumberVoiding.statusRejected")}
        </span>
      );
    }
    return (
      <span style={{ ...badgeStyle, background: "var(--color-stone)", color: "var(--color-ink-2)" }}>
        {t("femme.sifenNumberVoiding.statusPending")}
      </span>
    );
  }

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
          <div
            data-testid="sifen-certificate-empty-state"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <Text variant="muted">{t("femme.sifenCertificates.empty")}</Text>
            <div>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={() => {
                  fileInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  fileInputRef.current?.focus();
                }}
              >
                {t("femme.sifenCertificates.emptyCta")}
              </Button>
            </div>
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

      <section data-testid="sifen-number-voiding-section" style={sectionCardStyle}>
        <Text style={{ fontWeight: 500, marginBottom: 4 }}>
          {t("femme.sifenNumberVoiding.title")}
        </Text>
        <Text variant="small" style={{ color: "var(--color-ink-3)", marginBottom: 14 }}>
          {t("femme.sifenNumberVoiding.lead")}
        </Text>
        {voidingRows && voidingRows.some((r) => r.status === "PENDING")
          ? (() => {
              const pending = voidingRows.filter((r) => r.status === "PENDING");
              const soonest = pending.reduce((a, b) =>
                a.deadlineDate <= b.deadlineDate ? a : b,
              );
              const dl = deadlineLabel(soonest.deadlineDate);
              return (
                <Text
                  variant="small"
                  data-testid="sifen-number-voiding-summary"
                  style={{
                    marginBottom: 12,
                    fontWeight: 500,
                    color: dl.overdue ? "var(--color-danger)" : "var(--color-ink-2)",
                  }}
                >
                  {t("femme.sifenNumberVoiding.pendingSummary", {
                    count: pending.length,
                    deadline: fmtDate(`${soonest.deadlineDate}T00:00:00`),
                  })}
                </Text>
              );
            })()
          : null}
        {voidingLoadError ? (
          <Alert variant="destructive" title={t("femme.sifenCertificates.errorTitle")}>
            {voidingLoadError}
          </Alert>
        ) : voidingRows == null ? (
          <Text variant="small" style={{ color: "var(--color-ink-3)" }}>
            {t("femme.sifenNumberVoiding.loading")}
          </Text>
        ) : voidingRows.length === 0 ? (
          <Text variant="muted">{t("femme.sifenNumberVoiding.empty")}</Text>
        ) : (
          <div style={tableWrapStyle}>
            <div className="overflow-x-auto">
              <table className="min-w-full" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t("femme.sifenNumberVoiding.colRange")}</th>
                    <th style={thStyle}>{t("femme.sifenNumberVoiding.colDeadline")}</th>
                    <th style={thStyle}>{t("femme.sifenNumberVoiding.colStatus")}</th>
                    <th style={thStyle}>{t("femme.sifenNumberVoiding.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {voidingRows.map((row) => {
                    const deadline = deadlineLabel(row.deadlineDate);
                    const submittable = row.status === "PENDING" || row.status === "REJECTED";
                    return (
                      <tr key={row.id} data-testid="sifen-number-voiding-row">
                        <td style={tdStyle}>
                          {row.documentType} {row.rangeFrom}
                          {row.rangeTo !== row.rangeFrom ? `–${row.rangeTo}` : ""}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            ...(deadline.overdue ? { color: "var(--color-danger)" } : {}),
                          }}
                        >
                          {deadline.text}
                        </td>
                        <td style={tdStyle}>
                          <span
                            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                          >
                            {voidingStatusBadge(row.status)}
                            {row.invoiceId != null ? (
                              <span style={{ fontSize: 10, color: "var(--color-ink-3)" }}>
                                {t("femme.sifenNumberVoiding.automaticBadge")}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, minWidth: 240 }}>
                          {row.message ? (
                            <Text
                              variant="small"
                              style={{ color: "var(--color-ink-3)", marginBottom: 8 }}
                            >
                              {t("femme.sifenNumberVoiding.resultMessage", {
                                message: row.message,
                              })}
                            </Text>
                          ) : null}
                          {submittable ? (
                            <div
                              style={{ display: "flex", flexDirection: "column", gap: 6 }}
                            >
                              <label htmlFor={`voiding-reason-${row.id}`} style={labelStyle}>
                                {t("femme.sifenNumberVoiding.reasonLabel")}
                              </label>
                              <textarea
                                id={`voiding-reason-${row.id}`}
                                value={voidingReasons[row.id] ?? row.reason ?? ""}
                                placeholder={t("femme.sifenNumberVoiding.reasonPlaceholder")}
                                onChange={(e) =>
                                  setVoidingReasons((prev) => ({
                                    ...prev,
                                    [row.id]: e.target.value,
                                  }))
                                }
                                aria-invalid={!!voidingSubmitErrors[row.id]}
                                aria-describedby={
                                  voidingSubmitErrors[row.id]
                                    ? `voiding-reason-${row.id}-err`
                                    : undefined
                                }
                                style={{
                                  padding: "8px 11px",
                                  border: voidingSubmitErrors[row.id]
                                    ? "1px solid var(--color-danger)"
                                    : "1px solid var(--color-stone-md)",
                                  borderRadius: "var(--radius-md)",
                                  fontSize: 12,
                                  width: "100%",
                                  boxSizing: "border-box",
                                  minHeight: 60,
                                }}
                              />
                              <FieldValidationError id={`voiding-reason-${row.id}-err`}>
                                {voidingSubmitErrors[row.id] || null}
                              </FieldValidationError>
                              <div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="min-h-11"
                                  disabled={voidingSubmitting === row.id}
                                  onClick={() => void submitVoiding(row.id)}
                                >
                                  {voidingSubmitting === row.id
                                    ? t("femme.sifenNumberVoiding.submitting")
                                    : t("femme.sifenNumberVoiding.submit")}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Text variant="small" style={{ color: "var(--color-ink-3)" }}>
                              —
                            </Text>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isTenantAdmin ? (
          <div
            data-testid="sifen-number-voiding-manual-form"
            style={{
              marginTop: 16,
              paddingTop: 14,
              borderTop: "var(--border-default)",
            }}
          >
            <Text style={{ fontWeight: 500, marginBottom: 4 }}>
              {t("femme.sifenNumberVoiding.manualTitle")}
            </Text>
            <Text variant="small" style={{ color: "var(--color-ink-3)", marginBottom: 12 }}>
              {t("femme.sifenNumberVoiding.manualLead")}
            </Text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
              <div>
                <label htmlFor="manual-range-from" style={labelStyle}>
                  {t("femme.sifenNumberVoiding.manualRangeFromLabel")}
                </label>
                <input
                  id="manual-range-from"
                  inputMode="numeric"
                  value={manualFrom}
                  onChange={(e) => {
                    setManualFrom(e.target.value);
                    setManualErrors((p) => ({ ...p, range: null }));
                  }}
                  style={{
                    padding: "8px 11px",
                    border: manualErrors.range
                      ? "1px solid var(--color-danger)"
                      : "1px solid var(--color-stone-md)",
                    borderRadius: "var(--radius-md)",
                    fontSize: 12,
                    width: 120,
                  }}
                />
              </div>
              <div>
                <label htmlFor="manual-range-to" style={labelStyle}>
                  {t("femme.sifenNumberVoiding.manualRangeToLabel")}
                </label>
                <input
                  id="manual-range-to"
                  inputMode="numeric"
                  value={manualTo}
                  onChange={(e) => {
                    setManualTo(e.target.value);
                    setManualErrors((p) => ({ ...p, range: null }));
                  }}
                  style={{
                    padding: "8px 11px",
                    border: manualErrors.range
                      ? "1px solid var(--color-danger)"
                      : "1px solid var(--color-stone-md)",
                    borderRadius: "var(--radius-md)",
                    fontSize: 12,
                    width: 120,
                  }}
                />
              </div>
            </div>
            <FieldValidationError id="manual-range-err">
              {manualErrors.range || null}
            </FieldValidationError>
            <div style={{ marginTop: 8 }}>
              <label htmlFor="manual-reason" style={labelStyle}>
                {t("femme.sifenNumberVoiding.manualReasonLabel")}
              </label>
              <textarea
                id="manual-reason"
                value={manualReason}
                placeholder={t("femme.sifenNumberVoiding.reasonPlaceholder")}
                onChange={(e) => {
                  setManualReason(e.target.value);
                  setManualErrors((p) => ({ ...p, reason: null }));
                }}
                aria-invalid={!!manualErrors.reason}
                aria-describedby={manualErrors.reason ? "manual-reason-err" : undefined}
                style={{
                  padding: "8px 11px",
                  border: manualErrors.reason
                    ? "1px solid var(--color-danger)"
                    : "1px solid var(--color-stone-md)",
                  borderRadius: "var(--radius-md)",
                  fontSize: 12,
                  width: "100%",
                  boxSizing: "border-box",
                  minHeight: 60,
                }}
              />
              <FieldValidationError id="manual-reason-err">
                {manualErrors.reason || null}
              </FieldValidationError>
            </div>
            {manualError ? (
              <Alert variant="destructive" title={t("femme.sifenCertificates.errorTitle")}>
                {manualError}
              </Alert>
            ) : null}
            {manualSuccess ? (
              <Text
                variant="small"
                data-testid="sifen-number-voiding-manual-success"
                style={{ color: "var(--color-timbrado-valid-fg)", marginTop: 6 }}
              >
                {t("femme.sifenNumberVoiding.manualCreated")}
              </Text>
            ) : null}
            <div style={{ marginTop: 10 }}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="min-h-11"
                disabled={manualSubmitting}
                onClick={() => void createManualVoiding()}
              >
                {manualSubmitting
                  ? t("femme.sifenNumberVoiding.manualSubmitting")
                  : t("femme.sifenNumberVoiding.manualSubmit")}
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
