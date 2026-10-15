import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Label, Select, Spinner, Text } from "@design-system";
import {
  applyChanges,
  getSettings,
  type SettingsResponse,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { ScheduledChangesList, describeVersionValue } from "./ScheduledChangesList";
import { SectionTitle, TableWrap, tdClass, thClass } from "./common";

/** HU-COM-01: settlement periodicity, scheduled changes and change history (base and general % live in Reglas). */
export function SettingsTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [periodicity, setPeriodicity] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [periodicityError, setPeriodicityError] = useState<string | null>(null);

  /** `resetForm` only on the first load: a reload after saving one field keeps unsaved edits of the others. */
  const load = useCallback(async (resetForm = false) => {
    try {
      const s = await getSettings();
      setSettings(s);
      if (resetForm) {
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

    </div>
  );
}
