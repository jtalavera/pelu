import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Heading, Input, KebabMenu, Label, Spinner, Text } from "@design-system";
import { femmeJson, femmePostJson, femmePutJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FieldValidationError } from "../components/FieldValidationError";
import { StatusBadge } from "../components/StatusBadge";

type Tax = {
  id: number;
  name: string;
  rate: number;
  active: boolean;
};

function parseRate(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0 || v > 100) return null;
  return v;
}

export default function TaxSettingsPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taxes, setTaxes] = useState<Tax[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tax | null>(null);
  const [formName, setFormName] = useState("");
  const [formRate, setFormRate] = useState("");
  const [fieldError, setFieldError] = useState<{ name?: string; rate?: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<Tax | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await femmeJson<Tax[]>("/api/taxes");
      setTaxes(Array.isArray(data) ? data : []);
    } catch {
      setLoadError(t("femme.taxes.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    setEditing(null);
    setFormName("");
    setFormRate("");
    setFieldError(null);
    setSaveError(null);
    setModalOpen(true);
  }

  function openEdit(tax: Tax) {
    setEditing(tax);
    setFormName(tax.name);
    setFormRate(String(tax.rate));
    setFieldError(null);
    setSaveError(null);
    setModalOpen(true);
  }

  async function save() {
    setFieldError(null);
    setSaveError(null);
    const name = formName.trim();
    const rate = parseRate(formRate);
    const err: NonNullable<typeof fieldError> = {};
    if (!name) err.name = t("femme.taxes.nameRequired");
    if (rate === null) err.rate = t("femme.taxes.rateInvalid");
    if (Object.keys(err).length > 0) {
      setFieldError(err);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await femmePutJson<Tax>(`/api/taxes/${editing.id}`, { name, rate });
      } else {
        await femmePostJson<Tax>("/api/taxes", { name, rate });
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.taxes.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return;
    try {
      await femmePostJson<Tax>(`/api/taxes/${deactivateTarget.id}/deactivate`, {});
      setDeactivateTarget(null);
      await load();
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.taxes.saveError"));
      setDeactivateTarget(null);
    }
  }

  async function activate(tax: Tax) {
    try {
      await femmePostJson<Tax>(`/api/taxes/${tax.id}/activate`, {});
      await load();
    } catch (e) {
      setLoadError(translateApiError(e, t, "femme.taxes.saveError"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <Heading as="h2" className="text-lg">
            {t("femme.taxes.pageTitle")}
          </Heading>
          <Text variant="muted" className="text-sm mt-1">
            {t("femme.taxes.pageSubtitle")}
          </Text>
        </div>
        <Button type="button" onClick={openNew} className="min-h-11">
          {t("femme.taxes.addNew")}
        </Button>
      </div>

      {loadError && (
        <Alert variant="destructive" title={t("femme.taxes.errorTitle")}>
          {loadError}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <Text>{t("femme.taxes.loading")}</Text>
        </div>
      ) : taxes.length === 0 ? (
        <div className="rounded-md border border-[rgb(var(--color-border))] px-4 py-6 text-center">
          <Text className="font-medium">{t("femme.taxes.emptyTitle")}</Text>
          <Text variant="muted" className="text-sm mt-1">
            {t("femme.taxes.emptyBody")}
          </Text>
        </div>
      ) : (
        <div
          style={{
            background: "var(--color-white)",
            borderRadius: "var(--radius-xl)",
            border: "var(--border-default)",
            overflow: "hidden",
          }}
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "50%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead>
                <tr>
                  {[
                    { key: "colName", align: "left" },
                    { key: "colRate", align: "right" },
                    { key: "colStatus", align: "center" },
                    { key: "", align: "right" },
                  ].map(({ key, align }, i) => (
                    <th
                      key={i}
                      style={{
                        padding: "9px 12px",
                        fontSize: 10,
                        fontWeight: 500,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--color-ink-3)",
                        background: "var(--color-stone)",
                        textAlign: align as "left" | "right" | "center",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {key ? t(`femme.taxes.${key}`) : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {taxes.map((tax) => (
                  <tr
                    key={tax.id}
                    style={{ borderTop: "var(--border-default)" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background =
                        "var(--color-rose-lt)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = "";
                    }}
                  >
                    <td style={{ padding: "10px 12px", fontWeight: 500 }}>{tax.name}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>{tax.rate}%</td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <StatusBadge status={tax.active ? "ACTIVE" : "INACTIVE"} />
                    </td>
                    <td
                      style={{ padding: "10px 12px", textAlign: "right" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <KebabMenu
                        id={`tax-${tax.id}`}
                        triggerAriaLabel={t("femme.rowActions.trigger")}
                        items={[
                          {
                            id: "edit",
                            label: t("femme.taxes.editTitle"),
                            onSelect: () => openEdit(tax),
                          },
                          tax.active
                            ? {
                                id: "deactivate",
                                label: t("femme.taxes.deactivate"),
                                destructive: true,
                                onSelect: () => setDeactivateTarget(tax),
                              }
                            : {
                                id: "activate",
                                label: t("femme.taxes.activate"),
                                onSelect: () => void activate(tax),
                              },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editing ? t("femme.taxes.editTitle") : t("femme.taxes.addTitle")}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.4)",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            style={{
              background: "var(--color-white)",
              borderRadius: "var(--radius-xl)",
              padding: 24,
              width: "100%",
              maxWidth: 400,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <Heading as="h3" className="text-base font-semibold">
              {editing ? t("femme.taxes.editTitle") : t("femme.taxes.addTitle")}
            </Heading>

            {saveError && (
              <Alert variant="destructive" title={t("femme.taxes.errorTitle")}>
                {saveError}
              </Alert>
            )}

            <div>
              <Label htmlFor="tax-name">{t("femme.taxes.name")}</Label>
              <Input
                id="tax-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                aria-invalid={fieldError?.name ? "true" : "false"}
                aria-describedby={fieldError?.name ? "tax-name-err" : undefined}
              />
              <FieldValidationError id="tax-name-err">{fieldError?.name}</FieldValidationError>
            </div>

            <div>
              <Label htmlFor="tax-rate">{t("femme.taxes.rate")}</Label>
              <Input
                id="tax-rate"
                inputMode="decimal"
                value={formRate}
                onChange={(e) => setFormRate(e.target.value)}
                aria-invalid={fieldError?.rate ? "true" : "false"}
                aria-describedby={fieldError?.rate ? "tax-rate-err" : undefined}
              />
              <FieldValidationError id="tax-rate-err">{fieldError?.rate}</FieldValidationError>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => setModalOpen(false)}
              >
                {t("femme.taxes.cancel")}
              </Button>
              <Button
                type="button"
                className="min-h-11"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? t("femme.taxes.saving") : t("femme.taxes.save")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deactivateTarget && (
        <ConfirmDialog
          open
          title={t("femme.taxes.deactivateDialogTitle")}
          description={t("femme.taxes.deactivateDialogDescription", {
            name: deactivateTarget.name,
          })}
          cancelLabel={t("femme.taxes.cancel")}
          confirmLabel={t("femme.taxes.deactivate")}
          onCancel={() => setDeactivateTarget(null)}
          onConfirm={() => void confirmDeactivate()}
        />
      )}
    </div>
  );
}
