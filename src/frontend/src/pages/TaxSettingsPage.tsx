import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, KebabMenu, Label, Modal, Spinner, Switch, Text } from "@design-system";
import { femmeJson, femmePostJson, femmePutJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FieldValidationError } from "../components/FieldValidationError";
import { SettingsHeaderAction } from "./settings/settingsContext";

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <div className="flex flex-col gap-3">
      <SettingsHeaderAction>
        <Button type="button" onClick={openNew} className="min-h-11" data-testid="tax-add">
          {t("femme.taxes.addNew")}
        </Button>
      </SettingsHeaderAction>
      <p className="px-0.5 text-sm text-ink-3">{t("femme.taxes.pageSubtitle")}</p>

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
        <div className="rounded-card border border-line bg-surface px-4 py-6 text-center">
          <Text className="font-medium">{t("femme.taxes.emptyTitle")}</Text>
          <Text variant="muted" className="mt-1 text-sm">
            {t("femme.taxes.emptyBody")}
          </Text>
        </div>
      ) : (
        <ul className="rounded-card border border-line bg-surface shadow-sm" data-testid="taxes-list">
          {taxes.map((tax) => (
            <li
              key={tax.id}
              data-testid={`tax-row-${tax.id}`}
              className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-2 first:border-t-0"
            >
              <div className="min-w-0">
                <div className={`truncate font-semibold ${tax.active ? "text-ink" : "text-ink-3"}`}>{tax.name}</div>
                <div className="text-sm text-ink-3">{tax.rate}%</div>
              </div>
              <div className="flex items-center gap-1">
                <span className="flex min-h-11 items-center">
                  <Switch
                    checked={tax.active}
                    aria-label={t("femme.taxes.activeSwitch", { name: tax.name })}
                    data-testid={`tax-switch-${tax.id}`}
                    onChange={() => (tax.active ? setDeactivateTarget(tax) : void activate(tax))}
                  />
                </span>
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
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? t("femme.taxes.editTitle") : t("femme.taxes.addTitle")}
        className="max-w-md"
        footer={
          <>
            <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={() => setModalOpen(false)}>
              {t("femme.taxes.cancel")}
            </Button>
            <Button
              type="submit"
              form="tax-form"
              className="min-h-11 w-full sm:w-auto"
              disabled={saving}
              data-testid="tax-save"
            >
              {saving ? t("femme.taxes.saving") : t("femme.taxes.save")}
            </Button>
          </>
        }
      >
        <form
          id="tax-form"
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {saveError && (
            <Alert variant="destructive" title={t("femme.taxes.errorTitle")}>
              {saveError}
            </Alert>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="tax-name">{t("femme.taxes.name")}</Label>
            <Input
              id="tax-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              invalid={!!fieldError?.name}
              aria-describedby={fieldError?.name ? "tax-name-err" : undefined}
            />
            <FieldValidationError id="tax-name-err">{fieldError?.name}</FieldValidationError>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="tax-rate">{t("femme.taxes.rate")}</Label>
            <Input
              id="tax-rate"
              inputMode="decimal"
              value={formRate}
              onChange={(e) => setFormRate(e.target.value)}
              invalid={!!fieldError?.rate}
              aria-describedby={fieldError?.rate ? "tax-rate-err" : undefined}
            />
            <FieldValidationError id="tax-rate-err">{fieldError?.rate}</FieldValidationError>
          </div>
        </form>
      </Modal>

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
