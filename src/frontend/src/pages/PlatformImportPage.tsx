import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Label,
  PageSizeSelect,
  Pagination,
  Select,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "@design-system";
import {
  getImportReport,
  importEntityData,
  listImportTemplates,
  validateImportHeaders,
  type HeaderValidationResult,
  type ImportColumnTemplate,
  type ImportReport,
  type ImportResult,
} from "../api/platformImportTemplates";
import { downloadImportExampleFile } from "../api/downloadImportExampleFile";
import { listTenantsPaged, type PlatformTenant } from "../api/platformTenants";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";

/** HU-51/HU-52/HU-53: "services", "clients" and "professionals" all have an actual upload -> import flow wired. */
const IMPORTABLE_ENTITIES = new Set(["services", "clients", "professionals"]);

const ENTITY_ORDER = ["services", "clients", "professionals"] as const;

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
const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 12,
  color: "var(--color-ink)",
  verticalAlign: "top",
  borderBottom: "0.5px solid var(--color-stone)",
};

/**
 * HU-50 (Épica E — Importación de datos vía Excel): AC-1/AC-2/AC-3/AC-4 documented per-entity
 * column templates + AC-7 (visible to the Platform Admin at import time, not only in the HU-50
 * spec file), plus an AC-5/AC-6 headers-only file check. HU-51 wired the actual import for
 * servicios, HU-52 for clientes, HU-53 for profesionales. HU-55 adds a "Download example" button
 * per entity tab, fetching a ready-to-fill `.xlsx` (exact headers + 1-2 fictional sample rows)
 * from the backend.
 */
export default function PlatformImportPage() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [templates, setTemplates] = useState<ImportColumnTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeEntity, setActiveEntity] = useState<string>("services");

  // HU-55 AC-1/AC-4: download a ready-to-fill example .xlsx for the active entity.
  const [downloadingExample, setDownloadingExample] = useState(false);
  const [downloadExampleError, setDownloadExampleError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fileFieldError, setFileFieldError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<HeaderValidationResult | null>(null);

  // HU-51 AC-1: tenant selection + actual import (services only so far).
  const runFileInputRef = useRef<HTMLInputElement | null>(null);
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [tenantsLoadError, setTenantsLoadError] = useState<string | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [tenantFieldError, setTenantFieldError] = useState<string | null>(null);
  const [runFile, setRunFile] = useState<File | null>(null);
  const [runFileFieldError, setRunFileFieldError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<ImportResult | null>(null);

  // HU-54 AC-4: persisted report of the last import attempt for the selected tenant/entity pair,
  // reloaded whenever either changes and again right after a new run completes.
  const [report, setReport] = useState<ImportReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportPage, setReportPage] = useState(0);
  const [reportPageSize, setReportPageSize] = useState(10);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await listTenantsPaged({ page: 0, size: 200 });
        if (!cancelled) setTenants(page.content);
      } catch (err) {
        if (!cancelled) setTenantsLoadError(translateApiError(err, t, "femme.platform.import.tenantsLoadError"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listImportTemplates();
      setTemplates(data);
    } catch (err) {
      setLoadError(translateApiError(err, t, "femme.platform.import.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // HU-54 AC-4: reload the persisted last-import report whenever the destination tenant or the
  // active entity tab changes (including the very first render), so it's there without requiring a
  // fresh import — e.g. after leaving and coming back to this page.
  const loadReport = useCallback(
    async (tenantId: string, entity: string) => {
      if (!tenantId || !IMPORTABLE_ENTITIES.has(entity)) {
        setReport(null);
        setReportError(null);
        return;
      }
      setReportLoading(true);
      setReportError(null);
      try {
        const data = await getImportReport(Number(tenantId), entity);
        setReport(data);
      } catch (err) {
        setReport(null);
        setReportError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
      } finally {
        setReportLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    setReportPage(0);
    void loadReport(selectedTenantId, activeEntity);
  }, [selectedTenantId, activeEntity, loadReport]);

  function onTabChange(entity: string) {
    setActiveEntity(entity);
    setDownloadExampleError(null);
    setFile(null);
    setFileFieldError(null);
    setCheckError(null);
    setCheckResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setRunFile(null);
    setRunFileFieldError(null);
    setRunError(null);
    setRunResult(null);
    if (runFileInputRef.current) runFileInputRef.current.value = "";
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setFileFieldError(null);
    setCheckError(null);
    setCheckResult(null);
  }

  function onRunFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRunFile(e.target.files?.[0] ?? null);
    setRunFileFieldError(null);
    setRunError(null);
    setRunResult(null);
  }

  async function onRunSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRunError(null);
    setRunResult(null);
    let hasFieldError = false;
    if (!selectedTenantId) {
      setTenantFieldError(t("femme.platform.import.tenantRequired"));
      hasFieldError = true;
    } else {
      setTenantFieldError(null);
    }
    if (!runFile) {
      setRunFileFieldError(t("femme.platform.import.runFileRequired"));
      hasFieldError = true;
    } else {
      setRunFileFieldError(null);
    }
    if (hasFieldError) return;
    setRunning(true);
    try {
      const fileBase64 = await readFileAsBase64(runFile as File);
      const result = await importEntityData(
        Number(selectedTenantId),
        activeEntity,
        (runFile as File).name,
        fileBase64,
      );
      setRunResult(result);
      // HU-54 AC-4: the run just persisted a new report server-side — refresh it so the section
      // below reflects this attempt without requiring a tab switch or page reload.
      setReportPage(0);
      void loadReport(selectedTenantId, activeEntity);
    } catch (err) {
      setRunError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setRunning(false);
    }
  }

  // HU-55 AC-1: downloads a ready-to-fill example .xlsx (exact headers + fictional sample rows)
  // for the given entity, generated server-side from the same template HU-50's checker validates.
  async function onDownloadExample(entity: string) {
    setDownloadExampleError(null);
    setDownloadingExample(true);
    try {
      await downloadImportExampleFile(entity);
    } catch (err) {
      setDownloadExampleError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setDownloadingExample(false);
    }
  }

  async function onCheckSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCheckError(null);
    setCheckResult(null);
    if (!file) {
      setFileFieldError(t("femme.platform.import.checkFileRequired"));
      return;
    }
    setFileFieldError(null);
    setChecking(true);
    try {
      const fileBase64 = await readFileAsBase64(file);
      const result = await validateImportHeaders(activeEntity, file.name, fileBase64);
      setCheckResult(result);
    } catch (err) {
      setCheckError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setChecking(false);
    }
  }

  if (loading && templates === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.platform.import.loading")}</Text>
      </div>
    );
  }

  const orderedTemplates = ENTITY_ORDER.map((entity) =>
    (templates ?? []).find((tpl) => tpl.entity === entity),
  ).filter((tpl): tpl is ImportColumnTemplate => !!tpl);

  return (
    <div>
      <div className="mb-4">
        <h1 className="m-0 text-[15px] font-medium leading-tight text-[var(--color-ink)]">
          {t("femme.platform.import.title")}
        </h1>
        <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">
          {t("femme.platform.import.lead")}
        </div>
      </div>

      {loadError ? (
        <Alert
          variant="destructive"
          title={t("femme.platform.import.errorTitle")}
          className="mb-4"
          style={{ fontSize: 12, padding: "8px 12px" }}
        >
          {loadError}
        </Alert>
      ) : null}

      <Text variant="small" className="mb-4 text-[var(--color-ink-3)]">
        {t("femme.platform.import.fileFormatNote")}
      </Text>

      <Tabs value={activeEntity} onValueChange={onTabChange}>
        <TabsList aria-label={t("femme.platform.import.title")}>
          {orderedTemplates.map((tpl) => (
            <TabsTrigger key={tpl.entity} value={tpl.entity} data-testid={`import-tab-${tpl.entity}`}>
              {t(`femme.platform.import.entityTabs.${tpl.entity}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        {orderedTemplates.map((tpl) => (
          <TabsContent key={tpl.entity} value={tpl.entity}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <Text variant="small" style={{ color: "var(--color-ink-3)" }}>
                {t("femme.platform.import.downloadExampleLead", {
                  entity: t(`femme.platform.import.entityTabs.${tpl.entity}`).toLowerCase(),
                })}
              </Text>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={downloadingExample}
                onClick={() => onDownloadExample(tpl.entity)}
                data-testid={`import-download-example-${tpl.entity}`}
              >
                {downloadingExample
                  ? t("femme.platform.import.downloadingExample")
                  : t("femme.platform.import.downloadExampleButton")}
              </Button>
            </div>
            {downloadExampleError ? (
              <Alert
                variant="destructive"
                data-testid={`import-download-example-error-${tpl.entity}`}
                style={{ fontSize: 12, padding: "8px 12px", marginBottom: 12 }}
              >
                {downloadExampleError}
              </Alert>
            ) : null}

            <div
              className="overflow-hidden rounded-[var(--radius-xl)]"
              style={{ background: "var(--color-white)", border: "var(--border-default)" }}
              data-testid={`import-template-table-${tpl.entity}`}
            >
              <div className="overflow-x-auto">
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("femme.platform.import.colColumn")}</th>
                      <th style={thStyle}>{t("femme.platform.import.colRequirement")}</th>
                      <th style={thStyle}>{t("femme.platform.import.colDescription")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tpl.columns.map((col) => (
                      <tr key={col.key} data-testid={`import-column-row-${tpl.entity}-${col.key}`}>
                        <td style={{ ...tdStyle, fontFamily: "monospace", fontWeight: 500 }}>
                          {col.key}
                        </td>
                        <td style={tdStyle}>
                          {col.required
                            ? t("femme.platform.import.required")
                            : t("femme.platform.import.optional")}
                        </td>
                        <td style={tdStyle}>
                          {t(`femme.platform.import.columns.${col.key}`, { defaultValue: "" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <section
              className="mt-4 rounded-[var(--radius-xl)] p-4"
              style={{ background: "var(--color-white)", border: "var(--border-default)" }}
              data-testid={`import-check-section-${tpl.entity}`}
            >
              <Text style={{ fontWeight: 500, marginBottom: 4 }}>
                {t("femme.platform.import.checkSectionTitle")}
              </Text>
              <Text variant="small" style={{ color: "var(--color-ink-3)", marginBottom: 14 }}>
                {t("femme.platform.import.checkSectionLead")}
              </Text>

              {checkResult ? (
                checkResult.valid ? (
                  <Alert
                    variant="success"
                    data-testid={`import-check-valid-${tpl.entity}`}
                    style={{ fontSize: 12, padding: "8px 12px", marginBottom: 12 }}
                  >
                    {t("femme.platform.import.checkValid", {
                      entity: t(`femme.platform.import.entityTabs.${tpl.entity}`),
                    })}
                  </Alert>
                ) : (
                  <Alert
                    variant="destructive"
                    data-testid={`import-check-invalid-${tpl.entity}`}
                    style={{ fontSize: 12, padding: "8px 12px", marginBottom: 12 }}
                  >
                    {checkResult.errorCode
                      ? t(`femme.apiErrors.${checkResult.errorCode}`, {
                          defaultValue: t("femme.apiErrors.GENERIC"),
                        })
                      : t("femme.platform.import.checkMissingColumns", {
                          columns: checkResult.missingRequiredColumns.join(", "),
                        })}
                  </Alert>
                )
              ) : null}
              {checkError ? (
                <Alert
                  variant="destructive"
                  style={{ fontSize: 12, padding: "8px 12px", marginBottom: 12 }}
                >
                  {checkError}
                </Alert>
              ) : null}

              <form
                onSubmit={onCheckSubmit}
                noValidate
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <div>
                  <label
                    htmlFor={`import-file-${tpl.entity}`}
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 500,
                      color: "var(--color-ink-2)",
                      marginBottom: 4,
                    }}
                  >
                    {t("femme.platform.import.fileLabel")}
                  </label>
                  <input
                    id={`import-file-${tpl.entity}`}
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={onFileChange}
                    aria-invalid={!!fileFieldError}
                    aria-describedby={fileFieldError ? `import-file-${tpl.entity}-err` : undefined}
                    style={{ fontSize: 12 }}
                  />
                  <FieldValidationError id={`import-file-${tpl.entity}-err`}>
                    {fileFieldError}
                  </FieldValidationError>
                </div>
                <div>
                  <Button type="submit" variant="secondary" className="min-h-11" disabled={checking}>
                    {checking
                      ? t("femme.platform.import.checking")
                      : t("femme.platform.import.checkButton")}
                  </Button>
                </div>
              </form>
            </section>

            {IMPORTABLE_ENTITIES.has(tpl.entity) ? (
              <>
              <section
                className="mt-4 rounded-[var(--radius-xl)] p-4"
                style={{ background: "var(--color-white)", border: "var(--border-default)" }}
                data-testid={`import-run-section-${tpl.entity}`}
              >
                <Text style={{ fontWeight: 500, marginBottom: 4 }}>
                  {t("femme.platform.import.runSectionTitle", {
                    entity: t(`femme.platform.import.entityTabs.${tpl.entity}`).toLowerCase(),
                  })}
                </Text>
                <Text variant="small" style={{ color: "var(--color-ink-3)", marginBottom: 14 }}>
                  {t("femme.platform.import.runSectionLead", {
                    entity: t(`femme.platform.import.entityTabs.${tpl.entity}`).toLowerCase(),
                  })}
                </Text>

                {tenantsLoadError ? (
                  <Alert
                    variant="destructive"
                    style={{ fontSize: 12, padding: "8px 12px", marginBottom: 12 }}
                  >
                    {tenantsLoadError}
                  </Alert>
                ) : null}

                {runResult ? (
                  runResult.fileAccepted ? (
                    <div style={{ marginBottom: 12 }} data-testid={`import-run-result-${tpl.entity}`}>
                      <Alert
                        variant={runResult.failedCount > 0 ? "warning" : "success"}
                        data-testid={`import-run-summary-${tpl.entity}`}
                        style={{ fontSize: 12, padding: "8px 12px", marginBottom: 8 }}
                      >
                        {t("femme.platform.import.runSummary", {
                          imported: runResult.importedCount,
                          total: runResult.totalRows,
                          failed: runResult.failedCount,
                        })}
                      </Alert>
                      {runResult.failedCount > 0 ? (
                        <ul
                          style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}
                          data-testid={`import-run-failed-rows-${tpl.entity}`}
                        >
                          {runResult.rows
                            .filter((row) => !row.imported)
                            .map((row) => (
                              <li key={row.rowNumber} data-testid={`import-run-failed-row-${row.rowNumber}`}>
                                {t("femme.platform.import.runRowError", {
                                  row: row.rowNumber,
                                  reason: row.errorCode
                                    ? t(`femme.apiErrors.${row.errorCode}`, {
                                        defaultValue: t("femme.apiErrors.GENERIC"),
                                      })
                                    : t("femme.apiErrors.GENERIC"),
                                })}
                              </li>
                            ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : (
                    <Alert
                      variant="destructive"
                      data-testid={`import-run-rejected-${tpl.entity}`}
                      style={{ fontSize: 12, padding: "8px 12px", marginBottom: 12 }}
                    >
                      {runResult.errorCode
                        ? t(`femme.apiErrors.${runResult.errorCode}`, {
                            defaultValue: t("femme.apiErrors.GENERIC"),
                          })
                        : t("femme.platform.import.checkMissingColumns", {
                            columns: runResult.missingRequiredColumns.join(", "),
                          })}
                    </Alert>
                  )
                ) : null}
                {runError ? (
                  <Alert
                    variant="destructive"
                    style={{ fontSize: 12, padding: "8px 12px", marginBottom: 12 }}
                  >
                    {runError}
                  </Alert>
                ) : null}

                <form
                  onSubmit={onRunSubmit}
                  noValidate
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <div>
                    <Label htmlFor={`import-run-tenant-${tpl.entity}`}>
                      {t("femme.platform.import.tenantLabel")}
                    </Label>
                    <Select
                      id={`import-run-tenant-${tpl.entity}`}
                      value={selectedTenantId}
                      onChange={(e) => {
                        setSelectedTenantId(e.target.value);
                        setTenantFieldError(null);
                      }}
                      invalid={!!tenantFieldError}
                      aria-describedby={
                        tenantFieldError ? `import-run-tenant-${tpl.entity}-err` : undefined
                      }
                    >
                      <option value="">{t("femme.platform.import.tenantPlaceholder")}</option>
                      {tenants.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.name}
                        </option>
                      ))}
                    </Select>
                    <FieldValidationError id={`import-run-tenant-${tpl.entity}-err`}>
                      {tenantFieldError}
                    </FieldValidationError>
                  </div>
                  <div>
                    <label
                      htmlFor={`import-run-file-${tpl.entity}`}
                      style={{
                        display: "block",
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--color-ink-2)",
                        marginBottom: 4,
                      }}
                    >
                      {t("femme.platform.import.fileLabel")}
                    </label>
                    <input
                      id={`import-run-file-${tpl.entity}`}
                      ref={runFileInputRef}
                      type="file"
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={onRunFileChange}
                      aria-invalid={!!runFileFieldError}
                      aria-describedby={
                        runFileFieldError ? `import-run-file-${tpl.entity}-err` : undefined
                      }
                      style={{ fontSize: 12 }}
                    />
                    <FieldValidationError id={`import-run-file-${tpl.entity}-err`}>
                      {runFileFieldError}
                    </FieldValidationError>
                  </div>
                  <div>
                    <Button type="submit" className="min-h-11" disabled={running}>
                      {running ? t("femme.platform.import.running") : t("femme.platform.import.runButton")}
                    </Button>
                  </div>
                </form>
              </section>

              <section
                className="mt-4 rounded-[var(--radius-xl)] p-4"
                style={{ background: "var(--color-white)", border: "var(--border-default)" }}
                data-testid={`import-last-report-${tpl.entity}`}
              >
                <Text style={{ fontWeight: 500, marginBottom: 4 }}>
                  {t("femme.platform.import.reportSectionTitle")}
                </Text>
                <Text variant="small" style={{ color: "var(--color-ink-3)", marginBottom: 14 }}>
                  {t("femme.platform.import.reportSectionLead")}
                </Text>

                {!selectedTenantId ? (
                  <Text
                    variant="small"
                    style={{ color: "var(--color-ink-3)" }}
                    data-testid={`import-last-report-select-tenant-${tpl.entity}`}
                  >
                    {t("femme.platform.import.reportSelectTenant")}
                  </Text>
                ) : reportLoading ? (
                  <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    <Text variant="small">{t("femme.platform.import.reportLoading")}</Text>
                  </div>
                ) : reportError ? (
                  <Alert
                    variant="destructive"
                    style={{ fontSize: 12, padding: "8px 12px" }}
                  >
                    {reportError}
                  </Alert>
                ) : !report || !report.available ? (
                  <Text
                    variant="small"
                    style={{ color: "var(--color-ink-3)" }}
                    data-testid={`import-last-report-empty-${tpl.entity}`}
                  >
                    {t("femme.platform.import.reportEmpty")}
                  </Text>
                ) : (
                  <div data-testid={`import-last-report-content-${tpl.entity}`}>
                    <Text
                      variant="small"
                      style={{ color: "var(--color-ink-3)", marginBottom: 8 }}
                      data-testid={`import-last-report-meta-${tpl.entity}`}
                    >
                      {t("femme.platform.import.reportMeta", {
                        fileName: report.fileName,
                        date: report.importedAt ? new Date(report.importedAt).toLocaleString() : "",
                        email: report.importedByEmail,
                      })}
                    </Text>

                    {report.fileAccepted ? (
                      <>
                        <Alert
                          variant={report.failedCount > 0 ? "warning" : "success"}
                          data-testid={`import-last-report-summary-${tpl.entity}`}
                          style={{ fontSize: 12, padding: "8px 12px", marginBottom: 12 }}
                        >
                          {t("femme.platform.import.runSummary", {
                            imported: report.importedCount,
                            total: report.totalRows,
                            failed: report.failedCount,
                          })}
                        </Alert>

                        {report.rows.length > 0 ? (
                          <>
                            <div
                              className="overflow-x-auto rounded-[var(--radius-xl)]"
                              style={{ border: "var(--border-default)" }}
                            >
                              <table
                                style={{ width: "100%", borderCollapse: "collapse" }}
                                data-testid={`import-last-report-table-${tpl.entity}`}
                              >
                                <thead>
                                  <tr>
                                    <th style={thStyle}>{t("femme.platform.import.colRow")}</th>
                                    <th style={thStyle}>{t("femme.platform.import.colStatus")}</th>
                                    <th style={thStyle}>{t("femme.platform.import.colName")}</th>
                                    <th style={thStyle}>{t("femme.platform.import.colReason")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {report.rows
                                    .slice(
                                      reportPage * reportPageSize,
                                      reportPage * reportPageSize + reportPageSize,
                                    )
                                    .map((row) => (
                                      <tr
                                        key={row.rowNumber}
                                        data-testid={`import-last-report-row-${tpl.entity}-${row.rowNumber}`}
                                      >
                                        <td style={tdStyle}>{row.rowNumber}</td>
                                        <td style={tdStyle}>
                                          {row.imported
                                            ? t("femme.platform.import.statusImported")
                                            : t("femme.platform.import.statusFailed")}
                                        </td>
                                        <td style={tdStyle}>{row.name ?? "—"}</td>
                                        <td style={tdStyle}>
                                          {row.imported
                                            ? "—"
                                            : row.errorCode
                                              ? t(`femme.apiErrors.${row.errorCode}`, {
                                                  defaultValue: t("femme.apiErrors.GENERIC"),
                                                })
                                              : t("femme.apiErrors.GENERIC")}
                                        </td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                              <PageSizeSelect
                                value={reportPageSize}
                                onChange={(s) => {
                                  setReportPageSize(s);
                                  setReportPage(0);
                                }}
                                label={t("femme.pagination.rowsPerPage")}
                              />
                              <Text variant="small" className="text-[var(--color-ink-3)]">
                                {t("femme.pagination.showingRange", {
                                  from:
                                    report.rows.length === 0 ? 0 : reportPage * reportPageSize + 1,
                                  to: Math.min(
                                    (reportPage + 1) * reportPageSize,
                                    report.rows.length,
                                  ),
                                  total: report.rows.length,
                                })}
                              </Text>
                              <Pagination
                                page={reportPage + 1}
                                pageCount={Math.max(
                                  1,
                                  Math.ceil(report.rows.length / reportPageSize),
                                )}
                                onPageChange={(p) => setReportPage(p - 1)}
                                previousLabel={t("femme.pagination.previous")}
                                nextLabel={t("femme.pagination.next")}
                              />
                            </div>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <Alert
                        variant="destructive"
                        data-testid={`import-last-report-rejected-${tpl.entity}`}
                        style={{ fontSize: 12, padding: "8px 12px" }}
                      >
                        {report.errorCode
                          ? t(`femme.apiErrors.${report.errorCode}`, {
                              defaultValue: t("femme.apiErrors.GENERIC"),
                            })
                          : t("femme.platform.import.checkMissingColumns", {
                              columns: report.missingRequiredColumns.join(", "),
                            })}
                      </Alert>
                    )}
                  </div>
                )}
              </section>
              </>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
