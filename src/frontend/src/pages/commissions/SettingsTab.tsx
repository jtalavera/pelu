import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Alert, Button, Input, Label, Modal, Radio, RadioGroup, Select, Spinner, Text } from "@design-system";
import { applyChanges, getSettings, type ConfigChange, type SettingsResponse } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { ApplyChangeDialog } from "./ApplyChangeDialog";
import { useOverview } from "./overview";
import { ScheduledChangesList, describeVersionValue } from "./ScheduledChangesList";
import { TableWrap, formatPercent, parsePercentInput, tdClass, thClass } from "./common";

type Editing =
  | "BASE"
  | "DEFAULT_SERVICE"
  | "DEFAULT_PRODUCT"
  | "PERIODICITY"
  | "FIXED_DESTINATION"
  | "AGUINALDO_ENABLED"
  | "AGUINALDO_DEFAULT"
  | null;

const FOLD =
  "flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left font-heading font-extrabold text-ink";

/**
 * HU-COM-01 / HU-COM-09: calculation base, default percentages and settlement periodicity (one row each,
 * changed from a small dialog), plus the scheduled changes and the change history, folded.
 */
export function SettingsTab({ part = "setup" }: { part?: "setup" | "advanced" } = {}) {
  const { t } = useTranslation();
  const { refresh: refreshOverview } = useOverview();
  const firstLoad = useRef(true);
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
  /** HU-COM-14: the professional whose usual retention % is being edited. */
  const [retention, setRetention] = useState<{ professionalId: number; name: string; value: string } | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await getSettings());
      setLoadError(null);
      // The rest of the screen (Aguinaldo tab, setup badge…) follows what was just changed.
      if (firstLoad.current) firstLoad.current = false;
      else void refreshOverview();
    } catch (err) {
      setLoadError(translateApiError(err, t));
    }
  }, [t, refreshOverview]);

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
      scope: "FIXED_DESTINATION",
      label: t("femme.commissions.settings.FIXED_DESTINATION"),
      current: t(`femme.commissions.settings.fixedDestinationValue.${settings.fixedDestination}`),
    },
    {
      scope: "AGUINALDO_ENABLED",
      label: t("femme.commissions.settings.AGUINALDO_ENABLED"),
      current: t(`femme.commissions.settings.aguinaldoValue.${settings.aguinaldoEnabled}`),
    },
    ...(settings.aguinaldoEnabled
      ? [
          {
            scope: "AGUINALDO_DEFAULT" as const,
            label: t("femme.commissions.settings.AGUINALDO_DEFAULT"),
            current: formatPercent(settings.aguinaldoDefaultPercent),
          },
        ]
      : []),
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
    const percents = {
      DEFAULT_SERVICE: settings!.defaultPercentService,
      DEFAULT_PRODUCT: settings!.defaultPercentProduct,
      AGUINALDO_DEFAULT: settings!.aguinaldoDefaultPercent,
    } as const;
    setValue(
      scope === "BASE"
        ? settings!.base
        : scope === "PERIODICITY"
          ? settings!.periodicity
          : scope === "FIXED_DESTINATION"
            ? settings!.fixedDestination
            : scope === "AGUINALDO_ENABLED"
              ? String(settings!.aguinaldoEnabled)
              : String(percents[scope]).replace(".", ","),
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
    if (editing === "FIXED_DESTINATION") {
      if (value === settings!.fixedDestination) return setEditing(null);
      setApply({
        change: { scope: "FIXED_DESTINATION", value },
        summary: t("femme.commissions.settings.fixedDestinationSummary", {
          value: t(`femme.commissions.settings.fixedDestinationValue.${value}`),
        }),
      });
      return setEditing(null);
    }
    if (editing === "AGUINALDO_ENABLED") {
      if (value === String(settings!.aguinaldoEnabled)) return setEditing(null);
      setApply({
        change: { scope: "AGUINALDO_ENABLED", value },
        summary: t("femme.commissions.settings.aguinaldoEnabledSummary", {
          value: t(`femme.commissions.settings.aguinaldoValue.${value}`),
        }),
      });
      return setEditing(null);
    }
    const parsed = parsePercentInput(value);
    if (parsed === null) {
      setFieldError(t("femme.commissions.validation.percent"));
      return;
    }
    if (editing === "AGUINALDO_DEFAULT") {
      if (Number(parsed) === Number(settings!.aguinaldoDefaultPercent)) return setEditing(null);
      try {
        // It only prefills new rules: no calculation changes, so no apply-mode question.
        await applyChanges({
          changes: [{ scope: "AGUINALDO_DEFAULT", value: parsed }],
          applyMode: null,
          replacePending: true,
          preview: false,
        });
        setEditing(null);
        setNotice(t("femme.commissions.applyDialog.applied"));
        await load();
      } catch (err) {
        setFieldError(translateApiError(err, t));
      }
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

  /** One numbered step of the setup (HU-COM-15): its title, why, and its rows with «Cambiar». */
  function setupStep(n: 1 | 4, scopes: Exclude<Editing, null>[]) {
    const stepRows = rows.filter((r) => scopes.includes(r.scope));
    return (
      <section className="rounded-card border border-line bg-surface shadow-sm" data-testid={`config-step-${n}`}>
        <div className="px-4 pt-3">
          <h3 className="font-heading font-extrabold text-ink">
            {n} · {t(`femme.commissions.config.step${n}.title`)}
          </h3>
          <p className="text-sm text-ink-3">{t(`femme.commissions.config.step${n}.help`)}</p>
        </div>
        {stepRows.map((r) => (
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
      </section>
    );
  }

  function linkStep(n: 2 | 3, to: string) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-sm" data-testid={`config-step-${n}`}>
        <div className="min-w-0">
          <h3 className="font-heading font-extrabold text-ink">
            {n} · {t(`femme.commissions.config.step${n}.title`)}
          </h3>
          <p className="text-sm text-ink-3">{t(`femme.commissions.config.step${n}.help`)}</p>
        </div>
        <Link to={to} className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-extrabold text-primary" data-testid={`config-step-${n}-link`}>
          {t(`femme.commissions.config.step${n}.open`)}
        </Link>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="commission-settings">
      {notice && (
        <Alert variant="success" role="status" data-testid="commission-settings-notice">
          {notice}
        </Alert>
      )}
      {part === "setup" && (
        <>
          <p className="px-0.5 text-sm text-ink-3">{t("femme.commissions.settings.intro")}</p>
          {setupStep(1, ["BASE", "DEFAULT_SERVICE", "DEFAULT_PRODUCT", "PERIODICITY"])}
          {linkStep(2, "/app/commissions/configurar/grupos")}
          {linkStep(3, "/app/commissions/equipo")}
          {setupStep(4, ["AGUINALDO_ENABLED", "AGUINALDO_DEFAULT", "FIXED_DESTINATION"])}
      {settings.aguinaldoEnabled && (
        <section className="rounded-card border border-line bg-surface shadow-sm" data-testid="commission-retention-profiles">
          <div className="px-4 pt-3">
            <h3 className="font-heading font-extrabold text-ink">{t("femme.commissions.settings.retentionTitle")}</h3>
            <p className="text-sm text-ink-3">{t("femme.commissions.settings.retentionHelp")}</p>
          </div>
          {settings.retentionProfiles
            .filter((p) => p.active)
            .map((p) => (
              <div
                key={p.professionalId}
                data-testid="commission-retention-row"
                className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-2 first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-ink">{p.professionalName}</div>
                  <div className="text-sm text-ink-3" data-testid="commission-retention-current">
                    {p.percent
                      ? t("femme.commissions.settings.retentionRetains", { percent: formatPercent(p.percent) })
                      : t("femme.commissions.settings.retentionNone")}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11"
                  data-testid="commission-retention-change"
                  aria-label={`${t("femme.commissions.rules.change")}: ${p.professionalName}`}
                  onClick={() => {
                    setRetentionError(null);
                    setRetention({
                      professionalId: p.professionalId,
                      name: p.professionalName ?? "",
                      value: p.percent ? String(p.percent).replace(".", ",") : "",
                    });
                  }}
                >
                  {t("femme.commissions.rules.change")}
                </Button>
              </div>
            ))}
        </section>
      )}

          <Link
            to="/app/commissions/configurar/avanzado"
            className="inline-flex min-h-11 items-center self-start font-bold text-primary"
            data-testid="config-advanced-link"
          >
            {t("femme.commissions.config.advancedLink")} →
          </Link>
        </>
      )}

      {part === "advanced" && (
        <>
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
                    {v.groupName ? ` · ${v.groupName}` : ""}
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

        </>
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
              {editing === "PERIODICITY" || editing === "AGUINALDO_DEFAULT"
                ? t("femme.commissions.common.save")
                : t("femme.commissions.rules.apply")}
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
          {editing === "FIXED_DESTINATION" && (
            <>
              <Text variant="small" className="text-ink-3">
                {t("femme.commissions.settings.FIXED_DESTINATIONHelp")}
              </Text>
              <RadioGroup value={value} onChange={setValue} aria-label={t("femme.commissions.settings.FIXED_DESTINATION")}>
                {(["PROFESSIONAL", "SALON"] as const).map((d) => (
                  <label key={d} className="flex min-h-11 cursor-pointer items-start gap-2 text-sm">
                    <Radio value={d} data-testid={`commission-fixed-${d}`} className="mt-1" />
                    <span>
                      <span className="font-medium">{t(`femme.commissions.settings.fixedDestinationValue.${d}`)}</span>
                      <span className="block text-xs text-ink-3">{t(`femme.commissions.settings.fixedDestinationHelp.${d}`)}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </>
          )}
          {editing === "AGUINALDO_ENABLED" && (
            <>
              <Text variant="small" className="text-ink-3">
                {t("femme.commissions.settings.AGUINALDO_ENABLEDHelp")}
              </Text>
              <RadioGroup value={value} onChange={setValue} aria-label={t("femme.commissions.settings.AGUINALDO_ENABLED")}>
                {(["true", "false"] as const).map((v) => (
                  <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                    <Radio value={v} data-testid={`commission-aguinaldo-${v}`} />
                    <span className="font-medium">{t(`femme.commissions.settings.aguinaldoValue.${v}`)}</span>
                  </label>
                ))}
              </RadioGroup>
            </>
          )}
          {(editing === "DEFAULT_SERVICE" || editing === "DEFAULT_PRODUCT" || editing === "AGUINALDO_DEFAULT") && (
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

      <Modal
        open={retention !== null}
        onClose={() => setRetention(null)}
        title={t("femme.commissions.settings.retentionEditTitle", { name: retention?.name ?? "" })}
        className="max-w-lg"
        footer={
          <>
            <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={() => setRetention(null)}>
              {t("femme.commissions.common.cancel")}
            </Button>
            <Button
              type="button"
              className="min-h-11 w-full sm:w-auto"
              data-testid="commission-retention-save"
              onClick={async () => {
                if (!retention) return;
                const raw = retention.value.trim();
                const parsed = raw === "" ? null : parsePercentInput(raw);
                if (raw !== "" && parsed === null) {
                  setRetentionError(t("femme.commissions.validation.percent"));
                  return;
                }
                try {
                  // It only prefills the rules: no calculation changes, so no apply-mode question.
                  await applyChanges({
                    changes: [{ scope: "RETENTION_PROFILE", professionalId: retention.professionalId, value: parsed }],
                    applyMode: null,
                    replacePending: true,
                    preview: false,
                  });
                  setRetention(null);
                  setNotice(t("femme.commissions.applyDialog.applied"));
                  await load();
                } catch (err) {
                  setRetentionError(translateApiError(err, t));
                }
              }}
            >
              {t("femme.commissions.common.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="commission-retention-percent">{t("femme.commissions.settings.retentionInputLabel")}</Label>
          <Input
            id="commission-retention-percent"
            inputMode="decimal"
            value={retention?.value ?? ""}
            invalid={!!retentionError}
            aria-describedby={retentionError ? "commission-retention-error" : undefined}
            className="max-w-[8rem]"
            data-testid="commission-retention-percent"
            onChange={(e) => {
              setRetentionError(null);
              setRetention((cur) => (cur ? { ...cur, value: e.target.value } : cur));
            }}
          />
          <FieldValidationError id="commission-retention-error">{retentionError}</FieldValidationError>
          <Text variant="small" className="text-ink-3">
            {t("femme.commissions.settings.retentionInputHelp")}
          </Text>
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
