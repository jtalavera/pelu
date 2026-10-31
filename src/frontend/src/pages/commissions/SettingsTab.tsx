import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Modal, Radio, RadioGroup, Select, Spinner, Text } from "@design-system";
import { applyChanges, getSettings, type ConfigChange, type SettingsResponse } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { ApplyChangeDialog } from "./ApplyChangeDialog";
import { ScheduledChangesList, describeVersionValue } from "./ScheduledChangesList";
import { TableWrap, formatPercent, parsePercentInput, tdClass, thClass } from "./common";

type Editing = "BASE" | "DEFAULT_SERVICE" | "DEFAULT_PRODUCT" | "PERIODICITY" | null;

const FOLD =
  "flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left font-heading font-extrabold text-ink";

/**
 * HU-COM-01 / HU-COM-09: calculation base, default percentages and settlement periodicity (one row each,
 * changed from a small dialog), plus the scheduled changes and the change history, folded.
 */
export function SettingsTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [apply, setApply] = useState<{ change: ConfigChange; summary: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await getSettings());
      setLoadError(null);
    } catch (err) {
      setLoadError(translateApiError(err, t));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) return <Alert variant="destructive">{loadError}</Alert>;
  if (!settings) return <Spinner />;

  const rows: { scope: Exclude<Editing, null>; label: string; current: string }[] = [
    { scope: "BASE", label: t("femme.commissions.settings.baseTitle"), current: t(`femme.commissions.base.${settings.base}`) },
    {
      scope: "DEFAULT_SERVICE",
      label: t("femme.commissions.settings.DEFAULT_SERVICE"),
      current: formatPercent(settings.defaultPercentService),
    },
    {
      scope: "DEFAULT_PRODUCT",
      label: t("femme.commissions.settings.DEFAULT_PRODUCT"),
      current: formatPercent(settings.defaultPercentProduct),
    },
    {
      scope: "PERIODICITY",
      label: t("femme.commissions.settings.periodicity"),
      current: t(`femme.commissions.periodicity.${settings.periodicity}`),
    },
  ];

  function openEdit(scope: Exclude<Editing, null>) {
    setFieldError(null);
    setSaveError(null);
    setNotice(null);
    setValue(
      scope === "BASE"
        ? settings!.base
        : scope === "PERIODICITY"
          ? settings!.periodicity
          : String(scope === "DEFAULT_SERVICE" ? settings!.defaultPercentService : settings!.defaultPercentProduct).replace(".", ","),
    );
    setEditing(scope);
  }

  async function submitEdit() {
    if (!editing) return;
    if (editing === "PERIODICITY") {
      try {
        // C13: periodicity does not change the calculation → no apply-mode question.
        await applyChanges({
          changes: [{ scope: "PERIODICITY", value }],
          applyMode: null,
          replacePending: true,
          preview: false,
        });
        setEditing(null);
        setNotice(t("femme.commissions.settings.periodicitySaved"));
        await load();
      } catch (err) {
        setSaveError(translateApiError(err, t));
      }
      return;
    }
    if (editing === "BASE") {
      if (value === settings!.base) return setEditing(null);
      setApply({
        change: { scope: "BASE", value },
        summary: t("femme.commissions.settings.baseChangeSummary", {
          from: t(`femme.commissions.base.${settings!.base}`),
          to: t(`femme.commissions.base.${value}`),
        }),
      });
      return setEditing(null);
    }
    const parsed = parsePercentInput(value);
    if (parsed === null) {
      setFieldError(t("femme.commissions.validation.percent"));
      return;
    }
    const saved = editing === "DEFAULT_SERVICE" ? settings!.defaultPercentService : settings!.defaultPercentProduct;
    if (Number(parsed) === Number(saved)) return setEditing(null);
    setApply({
      change: { scope: editing, value: parsed },
      summary: t(editing === "DEFAULT_SERVICE" ? "femme.commissions.settings.defaultServiceSummary" : "femme.commissions.settings.defaultProductSummary", {
        value: formatPercent(parsed),
      }),
    });
    setEditing(null);
  }

  const editingLabel = rows.find((r) => r.scope === editing)?.label ?? "";

  return (
    <div className="flex flex-col gap-3" data-testid="commission-settings">
      <p className="px-0.5 text-sm text-ink-3">{t("femme.commissions.settings.intro")}</p>
      {notice && (
        <Alert variant="success" role="status">
          {notice}
        </Alert>
      )}
      <div className="rounded-card border border-line bg-surface shadow-sm">
        {rows.map((r) => (
          <div
            key={r.scope}
            className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-2 first:border-t-0"
            data-testid={`commission-setting-${r.scope}`}
          >
            <div className="min-w-0">
              <div className="font-semibold text-ink">{r.label}</div>
              <div className="text-sm text-ink-3">{r.current}</div>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => openEdit(r.scope)}
              data-testid={`commission-setting-change-${r.scope}`}
              aria-label={`${t("femme.commissions.rules.change")}: ${r.label}`}
            >
              {t("femme.commissions.rules.change")}
            </Button>
          </div>
        ))}
      </div>

      <button
        type="button"
        aria-expanded={scheduledOpen}
        aria-controls="commission-scheduled"
        className={FOLD}
        data-testid="commission-scheduled-toggle"
        onClick={() => setScheduledOpen((o) => !o)}
      >
        <span>
          {t("femme.commissions.scheduled.title")}
          {settings.scheduledChanges.length > 0 && (
            <span className="ml-2 text-sm font-normal text-ink-3">{settings.scheduledChanges.length}</span>
          )}
        </span>
        <span aria-hidden className={`text-ink-3 transition-transform ${scheduledOpen ? "rotate-180" : ""}`}>
          ⌄
        </span>
      </button>
      {scheduledOpen && (
        <div id="commission-scheduled" className="rounded-card border border-line bg-surface p-4">
          <ScheduledChangesList versions={settings.scheduledChanges} onChanged={() => void load()} />
        </div>
      )}

      <button
        type="button"
        aria-expanded={historyOpen}
        aria-controls="commission-history"
        className={FOLD}
        data-testid="commission-history-toggle"
        onClick={() => setHistoryOpen((o) => !o)}
      >
        {t("femme.commissions.settings.historyTitle")}
        <span aria-hidden className={`text-ink-3 transition-transform ${historyOpen ? "rotate-180" : ""}`}>
          ⌄
        </span>
      </button>
      {historyOpen && (
        <div id="commission-history" className="rounded-card border border-line bg-surface p-4">
          <TableWrap testId="commission-settings-history">
            <thead>
              <tr>
                <th className={thClass}>{t("femme.commissions.history.date")}</th>
                <th className={thClass}>{t("femme.commissions.history.what")}</th>
                <th className={thClass}>{t("femme.commissions.history.previous")}</th>
                <th className={thClass}>{t("femme.commissions.history.value")}</th>
                <th className={thClass}>{t("femme.commissions.history.effectiveFrom")}</th>
                <th className={thClass}>{t("femme.commissions.history.mode")}</th>
                <th className={thClass}>{t("femme.commissions.history.status")}</th>
                <th className={thClass}>{t("femme.commissions.history.user")}</th>
              </tr>
            </thead>
            <tbody>
              {settings.history.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className={tdClass}>{formatParaguayDateTime(v.createdAt, dateLocale)}</td>
                  <td className={tdClass}>
                    {t(`femme.commissions.scope.${v.scope}`)}
                    {v.serviceName ? ` · ${v.serviceName}` : ""}
                    {v.professionalName ? ` · ${v.professionalName}` : ""}
                  </td>
                  <td className={tdClass}>{describeVersionValue(t, v.scope, v.previousValue)}</td>
                  <td className={tdClass}>{describeVersionValue(t, v.scope, v.value)}</td>
                  <td className={tdClass}>{formatParaguayDateTime(v.effectiveFrom, dateLocale)}</td>
                  <td className={tdClass}>{t(`femme.commissions.applyDialog.modes.${v.applyMode}`)}</td>
                  <td className={tdClass}>{t(`femme.commissions.versionStatus.${v.scheduled ? "SCHEDULED" : v.status}`)}</td>
                  <td className={tdClass}>{v.createdByEmail}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editingLabel}
        className="max-w-lg"
        footer={
          <>
            <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={() => setEditing(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button
              type="button"
              className="min-h-11 w-full sm:w-auto"
              onClick={() => void submitEdit()}
              data-testid="commission-setting-save"
            >
              {editing === "PERIODICITY" ? t("femme.commissions.common.save") : t("femme.commissions.rules.apply")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {editing === "BASE" && (
            <>
              <RadioGroup value={value} onChange={setValue} aria-label={t("femme.commissions.settings.baseTitle")}>
                {(["NET_OF_TAX", "TAX_INCLUDED"] as const).map((b) => (
                  <label key={b} className="flex min-h-11 cursor-pointer items-start gap-2 text-sm">
                    <Radio value={b} data-testid={`commission-base-${b}`} className="mt-1" />
                    <span>
                      <span className="font-medium">{t(`femme.commissions.base.${b}`)}</span>
                      <span className="block text-xs text-ink-3">{t(`femme.commissions.baseHelp.${b}`)}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              <Text variant="small" className="text-ink-3">
                {t("femme.commissions.settings.baseExample")}
              </Text>
            </>
          )}
          {(editing === "DEFAULT_SERVICE" || editing === "DEFAULT_PRODUCT") && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="commission-setting-percent">{editingLabel}</Label>
              <Input
                id="commission-setting-percent"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                invalid={!!fieldError}
                aria-describedby={fieldError ? "commission-setting-percent-error" : undefined}
                className="max-w-[8rem]"
              />
              <FieldValidationError id="commission-setting-percent-error">{fieldError}</FieldValidationError>
              <Text variant="small" className="text-ink-3">
                {t(`femme.commissions.settings.${editing}Help`)}
              </Text>
            </div>
          )}
          {editing === "PERIODICITY" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="commission-periodicity">{t("femme.commissions.settings.periodicity")}</Label>
              <Select id="commission-periodicity" value={value} onChange={(e) => setValue(e.target.value)}>
                {(["WEEKLY", "BIWEEKLY", "MONTHLY", "MANUAL"] as const).map((p) => (
                  <option key={p} value={p}>
                    {t(`femme.commissions.periodicity.${p}`)}
                  </option>
                ))}
              </Select>
              <Text variant="small" className="text-ink-3">
                {t("femme.commissions.settings.periodicityHelp")}
              </Text>
              {saveError && <Alert variant="destructive">{saveError}</Alert>}
            </div>
          )}
        </div>
      </Modal>

      <ApplyChangeDialog
        open={apply !== null}
        changes={apply ? [apply.change] : []}
        summary={apply?.summary ?? ""}
        onClose={() => setApply(null)}
        onApplied={() => {
          setApply(null);
          setNotice(t("femme.commissions.applyDialog.applied"));
          void load();
        }}
      />
    </div>
  );
}
