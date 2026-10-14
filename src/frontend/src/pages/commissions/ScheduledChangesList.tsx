import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Alert, Button, Text } from "@design-system";
import { cancelScheduledChange, type ConfigScope, type VersionView } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { TableWrap, formatPercent, tdClass, thClass } from "./common";

export function describeVersionValue(t: TFunction, scope: ConfigScope, value: string | null): string {
  if (value === null || value === undefined) {
    return scope === "RULE" ? t("femme.commissions.rules.noRule") : "—";
  }
  if (scope === "BASE") return t(`femme.commissions.base.${value}`);
  if (scope === "PERIODICITY") return t(`femme.commissions.periodicity.${value}`);
  return formatPercent(value);
}

/** HU-COM-09: scheduled changes (what, current → new, effective date, author) with cancel. */
export function ScheduledChangesList({ versions, onChanged }: { versions: VersionView[]; onChanged: () => void }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [toCancel, setToCancel] = useState<VersionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (versions.length === 0) {
    return <Text variant="muted">{t("femme.commissions.scheduled.empty")}</Text>;
  }
  return (
    <>
      <TableWrap testId="commission-scheduled-changes">
        <thead>
          <tr>
            <th className={thClass}>{t("femme.commissions.history.what")}</th>
            <th className={thClass}>{t("femme.commissions.history.previous")}</th>
            <th className={thClass}>{t("femme.commissions.history.value")}</th>
            <th className={thClass}>{t("femme.commissions.history.effectiveFrom")}</th>
            <th className={thClass}>{t("femme.commissions.history.user")}</th>
            <th className={thClass} />
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id} className="border-t" data-testid="commission-scheduled-row">
              <td className={tdClass}>
                {t(`femme.commissions.scope.${v.scope}`)}
                {v.serviceName ? ` · ${v.serviceName}` : ""}
                {v.professionalName ? ` · ${v.professionalName}` : ""}
              </td>
              <td className={tdClass}>{describeVersionValue(t, v.scope, v.previousValue)}</td>
              <td className={tdClass}>{describeVersionValue(t, v.scope, v.value)}</td>
              <td className={tdClass}>{formatParaguayDateTime(v.effectiveFrom, dateLocale)}</td>
              <td className={tdClass}>{v.createdByEmail}</td>
              <td className={tdClass}>
                <Button type="button" size="sm" variant="secondary" onClick={() => setToCancel(v)}>
                  {t("femme.commissions.scheduled.cancel")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {error && <Alert variant="destructive">{error}</Alert>}
      <ConfirmDialog
        open={toCancel !== null}
        title={t("femme.commissions.scheduled.cancelTitle")}
        description={t("femme.commissions.scheduled.cancelDescription")}
        cancelLabel={t("femme.commissions.common.back")}
        confirmLabel={t("femme.commissions.scheduled.cancel")}
        onCancel={() => setToCancel(null)}
        onConfirm={async () => {
          if (!toCancel) return;
          try {
            await cancelScheduledChange(toCancel.id);
            setError(null);
            onChanged();
          } catch (err) {
            setError(translateApiError(err, t));
          } finally {
            setToCancel(null);
          }
        }}
      />
    </>
  );
}
