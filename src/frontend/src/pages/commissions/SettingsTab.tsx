import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Input, Label, Radio, RadioGroup, Select, Spinner, Text } from "@design-system";
import {
  applyChanges,
  getSettings,
  type ConfigChange,
  type SettingsResponse,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { ApplyChangeDialog } from "./ApplyChangeDialog";
import { ScheduledChangesList, describeVersionValue } from "./ScheduledChangesList";
import { SectionTitle, TableWrap, formatPercent, parsePercentInput, tdClass, thClass } from "./common";

/** HU-COM-01: base, default percents (services / products) and settlement periodicity. */
export function SettingsTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [base, setBase] = useState("");
  const [defService, setDefService] = useState("");
  const [defProduct, setDefProduct] = useState("");
  const [periodicity, setPeriodicity] = useState("");
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ changes: ConfigChange[]; summary: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [periodicityError, setPeriodicityError] = useState<string | null>(null);

  /** `resetForm` only on the first load: a reload after saving one field keeps unsaved edits of the others. */
  const load = useCallback(async (resetForm = false) => {
    try {
      const s = await getSettings();
      setSettings(s);
      if (resetForm) {
        setBase(s.base);
        setDefService(String(s.defaultPercentService).replace(".", ","));
        setDefProduct(String(s.defaultPercentProduct).replace(".", ","));
        setPeriodicity(s.periodicity);
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(translateApiError(err, t));
    }
  }, [t]);

  useEffect(() => {
    void load(true);
  }, [load]);

  function saveBase() {
    if (!settings || base === settings.base) return;
    setPending({
      changes: [{ scope: "BASE", value: base }],
      summary: t("femme.commissions.settings.baseChangeSummary", {
        from: t(`femme.commissions.base.${settings.base}`),
        to: t(`femme.commissions.base.${base}`),
      }),
    });
  }

  function saveDefault(scope: "DEFAULT_SERVICE" | "DEFAULT_PRODUCT") {
    const raw = scope === "DEFAULT_SERVICE" ? defService : defProduct;
    const parsed = parsePercentInput(raw);
    const setErr = scope === "DEFAULT_SERVICE" ? setServiceError : setProductError;
    if (parsed === null) {
      setErr(t("femme.commissions.validation.percent"));
      return;
    }
    setErr(null);
    setPending({
      changes: [{ scope, value: parsed }],
      summary: t(
        scope === "DEFAULT_SERVICE"
          ? "femme.commissions.settings.defaultServiceSummary"
          : "femme.commissions.settings.defaultProductSummary",
        { value: formatPercent(parsed) },
      ),
    });
  }

  async function savePeriodicity() {
    setPeriodicityError(null);
    try {
      // C13: periodicity does not change the calculation → no apply-mode question.
      await applyChanges({
        changes: [{ scope: "PERIODICITY", value: periodicity }],
        applyMode: null,
        replacePending: true,
        preview: false,
      });
      setNotice(t("femme.commissions.settings.periodicitySaved"));
      await load();
    } catch (err) {
      setPeriodicityError(translateApiError(err, t));
    }
  }

  if (loadError) return <Alert variant="destructive">{loadError}</Alert>;
  if (!settings) return <Spinner />;

  return (
    <div className="flex flex-col gap-4" data-testid="commission-settings">
      {notice && (
        <Alert variant="success" role="status">
          {notice}
        </Alert>
      )}
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle>{t("femme.commissions.settings.baseTitle")}</SectionTitle>
        <RadioGroup value={base} onChange={setBase} aria-label={t("femme.commissions.settings.baseTitle")}>
          {(["NET_OF_TAX", "TAX_INCLUDED"] as const).map((b) => (
            <label key={b} className="flex min-h-11 cursor-pointer items-start gap-2 text-sm">
              <Radio value={b} data-testid={`commission-base-${b}`} className="mt-1" />
              <span>
                <span className="font-medium">{t(`femme.commissions.base.${b}`)}</span>
                <span className="block text-xs text-[var(--color-ink-3)]">{t(`femme.commissions.baseHelp.${b}`)}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
        <Text variant="small" className="text-[var(--color-ink-3)]">
          {t("femme.commissions.settings.baseExample")}
        </Text>
        <div>
          <Button type="button" onClick={saveBase} disabled={base === settings.base} data-testid="commission-save-base">
            {t("femme.commissions.common.save")}
          </Button>
        </div>
      </Card>

      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        {(
          [
            ["DEFAULT_SERVICE", defService, setDefService, serviceError],
            ["DEFAULT_PRODUCT", defProduct, setDefProduct, productError],
          ] as const
        ).map(([scope, value, setValue, err]) => (
          <div key={scope} className="flex flex-col gap-1">
            <Label htmlFor={`commission-${scope}`}>{t(`femme.commissions.settings.${scope}`)}</Label>
            <div className="flex gap-2">
              <Input
                id={`commission-${scope}`}
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                invalid={!!err}
                aria-describedby={err ? `commission-${scope}-error` : undefined}
                className="max-w-[8rem]"
              />
              <Button type="button" onClick={() => saveDefault(scope)} data-testid={`commission-save-${scope}`}>
                {t("femme.commissions.common.save")}
              </Button>
            </div>
            <FieldValidationError id={`commission-${scope}-error`}>{err}</FieldValidationError>
            <Text variant="small" className="text-[var(--color-ink-3)]">
              {t(`femme.commissions.settings.${scope}Help`)}
            </Text>
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <Label htmlFor="commission-periodicity">{t("femme.commissions.settings.periodicity")}</Label>
        <div className="flex flex-wrap gap-2">
          <Select
            id="commission-periodicity"
            value={periodicity}
            onChange={(e) => setPeriodicity(e.target.value)}
            className="max-w-xs"
          >
            {(["WEEKLY", "BIWEEKLY", "MONTHLY", "MANUAL"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`femme.commissions.periodicity.${p}`)}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            onClick={() => void savePeriodicity()}
            disabled={periodicity === settings.periodicity}
            data-testid="commission-save-periodicity"
          >
            {t("femme.commissions.common.save")}
          </Button>
        </div>
        <Text variant="small" className="text-[var(--color-ink-3)]">
          {t("femme.commissions.settings.periodicityHelp")}
        </Text>
        {periodicityError && <Alert variant="destructive">{periodicityError}</Alert>}
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <SectionTitle>{t("femme.commissions.scheduled.title")}</SectionTitle>
        <ScheduledChangesList versions={settings.scheduledChanges} onChanged={() => void load()} />
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <SectionTitle>{t("femme.commissions.settings.historyTitle")}</SectionTitle>
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
      </Card>

      <ApplyChangeDialog
        open={pending !== null}
        changes={pending?.changes ?? []}
        summary={pending?.summary ?? ""}
        onClose={() => setPending(null)}
        onApplied={() => {
          setPending(null);
          setNotice(t("femme.commissions.applyDialog.applied"));
          void load();
        }}
      />
    </div>
  );
}
