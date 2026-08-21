import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, Text } from "@design-system";
import {
  listImportTemplates,
  validateImportHeaders,
  type HeaderValidationResult,
  type ImportColumnTemplate,
} from "../api/platformImportTemplates";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";

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
 * spec file), plus an AC-5/AC-6 headers-only file check. Deliberately does NOT import any data —
 * that is HU-51 (servicios), HU-52 (clientes), HU-53 (profesionales). Downloading a ready-made
 * example spreadsheet with sample rows is HU-55's separate scope, not built here.
 */
export default function PlatformImportPage() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [templates, setTemplates] = useState<ImportColumnTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeEntity, setActiveEntity] = useState<string>("services");
  const [file, setFile] = useState<File | null>(null);
  const [fileFieldError, setFileFieldError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<HeaderValidationResult | null>(null);

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

  function onTabChange(entity: string) {
    setActiveEntity(entity);
    setFile(null);
    setFileFieldError(null);
    setCheckError(null);
    setCheckResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setFileFieldError(null);
    setCheckError(null);
    setCheckResult(null);
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
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
