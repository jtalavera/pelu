import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Select, Spinner, Text } from "@design-system";
import { getItemRules, type ConfigChange, type ItemRules } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { ApplyChangeDialog } from "./ApplyChangeDialog";
import { ScheduledChangesList, describeVersionValue } from "./ScheduledChangesList";
import { TableWrap, formatPercent, parsePercentInput, tdClass, thClass, useProfessionals } from "./common";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";

/**
 * HU-COM-02: the «Comisión» section of a service / product — general percent plus per-professional
 * exceptions. Every save goes through the HU-COM-09 dialog.
 */
export function ItemRulesEditor({ serviceId }: { serviceId: number }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const professionals = useProfessionals();
  const [rules, setRules] = useState<ItemRules | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [general, setGeneral] = useState("");
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [exceptionProfessional, setExceptionProfessional] = useState("");
  const [exceptionPercent, setExceptionPercent] = useState("");
  const [exceptionError, setExceptionError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<{ changes: ConfigChange[]; summary: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** `resetForm` only on the first load: a reload after saving one rule keeps unsaved edits of the others. */
  const load = useCallback(async (resetForm = false) => {
    try {
      const r = await getItemRules(serviceId);
      setRules(r);
      if (resetForm) {
        setGeneral(r.generalPercent === null ? "" : String(r.generalPercent).replace(".", ","));
        setEdits({});
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(translateApiError(err, t));
    }
  }, [serviceId, t]);

  useEffect(() => {
    void load(true);
  }, [load]);

  const addable = useMemo(() => {
    const taken = new Set((rules?.exceptions ?? []).filter((e) => e.percent !== null).map((e) => e.professionalId));
    return professionals.filter((p) => p.active && !taken.has(p.id));
  }, [professionals, rules]);

  function saveGeneral() {
    const parsed = parsePercentInput(general);
    if (parsed === null) {
      setGeneralError(t("femme.commissions.validation.percent"));
      return;
    }
    setGeneralError(null);
    setPending({
      changes: [{ scope: "RULE", serviceId, professionalId: null, value: parsed }],
      summary: t("femme.commissions.rules.generalSummary", { item: rules?.serviceName, value: formatPercent(parsed) }),
    });
  }

  function removeGeneral() {
    setPending({
      changes: [{ scope: "RULE", serviceId, professionalId: null, value: null }],
      summary: t("femme.commissions.rules.generalRemoveSummary", { item: rules?.serviceName }),
    });
  }

  function saveException(professionalId: number, raw: string, name: string | null) {
    const parsed = parsePercentInput(raw);
    if (parsed === null) {
      setExceptionError(t("femme.commissions.validation.percent"));
      return;
    }
    setExceptionError(null);
    setPending({
      changes: [{ scope: "RULE", serviceId, professionalId, value: parsed }],
      summary: t("femme.commissions.rules.exceptionSummary", {
        item: rules?.serviceName,
        professional: name,
        value: formatPercent(parsed),
      }),
    });
  }

  function removeException(professionalId: number, name: string | null) {
    setPending({
      changes: [{ scope: "RULE", serviceId, professionalId, value: null }],
      summary: t("femme.commissions.rules.exceptionRemoveSummary", { item: rules?.serviceName, professional: name }),
    });
  }

  if (loadError) return <Alert variant="destructive">{loadError}</Alert>;
  if (!rules) return <Spinner />;

  return (
    <div className="flex flex-col gap-4" data-testid="item-commission-section">
      {notice && (
        <Alert variant="success" role="status">
          {notice}
        </Alert>
      )}
      {rules.generalPercent === null && (
        <Alert variant="warning" data-testid="item-commission-no-general">
          {t("femme.commissions.rules.usesDefault", { value: formatPercent(rules.defaultPercent) })}
        </Alert>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor={`commission-general-${serviceId}`}>{t("femme.commissions.rules.generalPercent")}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={`commission-general-${serviceId}`}
            inputMode="decimal"
            value={general}
            onChange={(e) => setGeneral(e.target.value)}
            invalid={!!generalError}
            aria-describedby={generalError ? `commission-general-${serviceId}-error` : undefined}
            className="max-w-[8rem]"
          />
          <Button type="button" onClick={saveGeneral} data-testid="commission-save-general">
            {t("femme.commissions.common.save")}
          </Button>
          {rules.generalPercent !== null && (
            <Button type="button" variant="secondary" onClick={removeGeneral} data-testid="commission-remove-general">
              {t("femme.commissions.rules.removeGeneral")}
            </Button>
          )}
        </div>
        <FieldValidationError id={`commission-general-${serviceId}-error`}>{generalError}</FieldValidationError>
        <Text variant="small" className="text-[var(--color-ink-3)]">
          {t("femme.commissions.rules.zeroHint")}
        </Text>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">{t("femme.commissions.rules.exceptionsTitle")}</h4>
        {rules.exceptions.length === 0 ? (
          <Text variant="muted">{t("femme.commissions.rules.noExceptions")}</Text>
        ) : (
          <TableWrap testId="commission-exceptions">
            <thead>
              <tr>
                <th className={thClass}>{t("femme.commissions.common.professional")}</th>
                <th className={thClass}>{t("femme.commissions.rules.percent")}</th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody>
              {rules.exceptions.map((e) => (
                <tr key={e.professionalId} className="border-t" data-testid="commission-exception-row">
                  <td className={tdClass}>
                    {e.professionalName}
                    {!e.professionalActive && (
                      <span className="ml-1 text-xs text-[var(--color-ink-3)]">({t("femme.commissions.common.inactive")})</span>
                    )}
                    {e.scheduled.length > 0 && (
                      <span className="block text-xs text-[var(--color-ink-3)]">
                        {t("femme.commissions.rules.scheduledBadge", {
                          value: describeVersionValue(t, "RULE", e.scheduled[0].value),
                          date: formatParaguayDateTime(e.scheduled[0].effectiveFrom, dateLocale),
                        })}
                      </span>
                    )}
                  </td>
                  <td className={tdClass}>
                    {e.professionalActive ? (
                      <Input
                        aria-label={t("femme.commissions.rules.exceptionFor", { name: e.professionalName })}
                        inputMode="decimal"
                        value={edits[e.professionalId] ?? (e.percent === null ? "" : String(e.percent).replace(".", ","))}
                        onChange={(ev) => setEdits({ ...edits, [e.professionalId]: ev.target.value })}
                        className="max-w-[7rem]"
                      />
                    ) : (
                      formatPercent(e.percent)
                    )}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {e.professionalActive && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          saveException(
                            e.professionalId,
                            edits[e.professionalId] ?? String(e.percent ?? ""),
                            e.professionalName,
                          )
                        }
                      >
                        {t("femme.commissions.common.save")}
                      </Button>
                    )}{" "}
                    {e.percent !== null && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => removeException(e.professionalId, e.professionalName)}
                      >
                        {t("femme.commissions.rules.removeException")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-[12rem] flex-col gap-1">
            <Label htmlFor={`commission-add-exception-${serviceId}`}>{t("femme.commissions.common.professional")}</Label>
            <Select
              id={`commission-add-exception-${serviceId}`}
              value={exceptionProfessional}
              onChange={(e) => setExceptionProfessional(e.target.value)}
            >
              <option value="">{t("femme.commissions.rules.chooseProfessional")}</option>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`commission-add-exception-pct-${serviceId}`}>{t("femme.commissions.rules.percent")}</Label>
            <Input
              id={`commission-add-exception-pct-${serviceId}`}
              inputMode="decimal"
              value={exceptionPercent}
              onChange={(e) => setExceptionPercent(e.target.value)}
              invalid={!!exceptionError}
              aria-describedby={exceptionError ? `commission-exception-error-${serviceId}` : undefined}
              className="max-w-[8rem]"
            />
          </div>
          <Button
            type="button"
            disabled={!exceptionProfessional}
            data-testid="commission-add-exception"
            onClick={() => {
              const p = professionals.find((x) => String(x.id) === exceptionProfessional);
              saveException(Number(exceptionProfessional), exceptionPercent, p?.fullName ?? null);
            }}
          >
            {t("femme.commissions.rules.addException")}
          </Button>
        </div>
        <FieldValidationError id={`commission-exception-error-${serviceId}`}>{exceptionError}</FieldValidationError>
      </div>

      {rules.generalScheduled.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-medium">{t("femme.commissions.scheduled.title")}</h4>
          <ScheduledChangesList versions={rules.generalScheduled} onChanged={() => void load()} />
        </div>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-medium">{t("femme.commissions.rules.historyTitle")}</summary>
        <TableWrap testId="commission-rule-history">
          <thead>
            <tr>
              <th className={thClass}>{t("femme.commissions.history.date")}</th>
              <th className={thClass}>{t("femme.commissions.common.professional")}</th>
              <th className={thClass}>{t("femme.commissions.history.previous")}</th>
              <th className={thClass}>{t("femme.commissions.history.value")}</th>
              <th className={thClass}>{t("femme.commissions.history.effectiveFrom")}</th>
              <th className={thClass}>{t("femme.commissions.history.status")}</th>
              <th className={thClass}>{t("femme.commissions.history.user")}</th>
            </tr>
          </thead>
          <tbody>
            {rules.history.map((v) => (
              <tr key={v.id} className="border-t">
                <td className={tdClass}>{formatParaguayDateTime(v.createdAt, dateLocale)}</td>
                <td className={tdClass}>{v.professionalName ?? t("femme.commissions.rules.general")}</td>
                <td className={tdClass}>{describeVersionValue(t, "RULE", v.previousValue)}</td>
                <td className={tdClass}>{describeVersionValue(t, "RULE", v.value)}</td>
                <td className={tdClass}>{formatParaguayDateTime(v.effectiveFrom, dateLocale)}</td>
                <td className={tdClass}>{t(`femme.commissions.versionStatus.${v.scheduled ? "SCHEDULED" : v.status}`)}</td>
                <td className={tdClass}>{v.createdByEmail}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </details>

      <ApplyChangeDialog
        open={pending !== null}
        changes={pending?.changes ?? []}
        summary={pending?.summary ?? ""}
        onClose={() => setPending(null)}
        onApplied={() => {
          if (pending?.changes.some((c) => c.professionalId == null && c.value === null)) {
            setGeneral("");
          }
          setPending(null);
          setExceptionPercent("");
          setExceptionProfessional("");
          setNotice(t("femme.commissions.applyDialog.applied"));
          void load();
        }}
      />
    </div>
  );
}
