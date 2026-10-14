import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Modal, Radio, RadioGroup, Spinner, Text } from "@design-system";
import {
  applyChanges,
  getApplyModeOptions,
  type ApplyChangesResponse,
  type ApplyMode,
  type ApplyModeOptions,
  type ConfigChange,
  type RecalculationPreview,
} from "../../api/commissions";
import { parseApiErrorMessage, translateApiError } from "../../api/parseApiErrorMessage";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDate, formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { useDateLocale } from "../../i18n/dateLocale";

type Props = {
  open: boolean;
  changes: ConfigChange[];
  /** Human-readable description of what changes (already translated). */
  summary: string;
  onClose: () => void;
  onApplied: (res: ApplyChangesResponse) => void;
};

/**
 * HU-COM-09 / §4.4: every change that affects the calculation asks how to apply it — from now, from
 * the next period, or from the start of the current period (recalculating with a mandatory preview).
 * No option is preselected.
 */
export function ApplyChangeDialog({ open, changes, summary, onClose, onApplied }: Props) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [options, setOptions] = useState<ApplyModeOptions | null>(null);
  const [mode, setMode] = useState<string>("");
  const [preview, setPreview] = useState<RecalculationPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReplace, setNeedsReplace] = useState(false);
  const isBaseChange = changes.some((c) => c.scope === "BASE");

  useEffect(() => {
    if (!open) {
      // Reset on close so a reopened dialog never shows (and lets the user pick) stale options.
      setMode("");
      setPreview(null);
      setError(null);
      setNeedsReplace(false);
      setOptions(null);
      return;
    }
    getApplyModeOptions()
      .then(setOptions)
      .catch((err) => setError(translateApiError(err, t)));
  }, [open, t]);

  useEffect(() => {
    if (!open || mode !== "PERIOD_START") {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    setError(null);
    applyChanges({ changes, applyMode: "PERIOD_START", replacePending: true, preview: true })
      .then((res) => setPreview(res.recalculation))
      .catch((err) => setError(translateApiError(err, t)))
      .finally(() => setPreviewLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, open]);

  const manual = options?.currentPeriod.periodicity === "MANUAL";

  async function submit(replacePending: boolean) {
    if (!mode) {
      setError(t("femme.apiErrors.COMMISSION_CHANGE_APPLY_MODE_REQUIRED"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await applyChanges({
        changes,
        applyMode: mode as ApplyMode,
        replacePending,
        preview: false,
      });
      onApplied(res);
    } catch (err) {
      if (parseApiErrorMessage(err) === "COMMISSION_PENDING_CHANGE_EXISTS") {
        setNeedsReplace(true);
      } else {
        setError(translateApiError(err, t));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function modeDate(m: ApplyMode): string {
    if (!options) return "";
    const iso =
      m === "IMMEDIATE" ? options.immediateFrom : m === "NEXT_PERIOD" ? options.nextPeriodFrom : options.periodStartFrom;
    return iso ? formatParaguayDateTime(iso, dateLocale) : "";
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("femme.commissions.applyDialog.title")}
      description={summary}
      footer={
        <>
          <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={onClose}>
            {t("femme.commissions.common.cancel")}
          </Button>
          <Button
            type="button"
            className="min-h-11 w-full sm:w-auto"
            data-testid="commission-apply-confirm"
            disabled={submitting || !mode || (mode === "PERIOD_START" && (previewLoading || !preview))}
            onClick={() => void submit(needsReplace)}
          >
            {needsReplace
              ? t("femme.commissions.applyDialog.replaceAndApply")
              : t("femme.commissions.applyDialog.apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="commission-apply-dialog">
        <Alert variant="info">{t("femme.commissions.applyDialog.notRetroactiveHint")}</Alert>
        {options ? (
          <Text variant="small" data-testid="commission-apply-period">
            {manual
              ? t("femme.commissions.applyDialog.manualPeriod")
              : t("femme.commissions.applyDialog.currentPeriod", {
                  from: options.currentPeriod.from ? formatParaguayDate(options.currentPeriod.from + "T12:00:00", dateLocale) : "",
                  to: options.currentPeriod.to ? formatParaguayDate(options.currentPeriod.to + "T12:00:00", dateLocale) : "",
                })}
          </Text>
        ) : (
          <Spinner />
        )}
        {isBaseChange && (
          <Text variant="small" className="text-[var(--color-ink-3)]">
            {t("femme.commissions.settings.baseExample")}
          </Text>
        )}
        {options && (
          <RadioGroup
            value={mode}
            onChange={setMode}
            aria-label={t("femme.commissions.applyDialog.title")}
          >
            {options.availableModes.map((m) => (
              <label key={m} className="flex min-h-11 cursor-pointer items-start gap-2 text-sm">
                <Radio value={m} data-testid={`commission-apply-mode-${m}`} className="mt-1" />
                <span>
                  <span className="font-medium">
                    {manual && m === "PERIOD_START"
                      ? t("femme.commissions.applyDialog.modes.SINCE_LAST_CUTOFF")
                      : t(`femme.commissions.applyDialog.modes.${m}`)}
                  </span>
                  <span className="block text-xs text-[var(--color-ink-3)]">
                    {t(`femme.commissions.applyDialog.modeHelp.${m}`, { date: modeDate(m) })}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
        )}
        {mode === "PERIOD_START" && (
          <div data-testid="commission-recalc-preview" className="rounded-md border p-3 text-sm">
            {previewLoading || !preview ? (
              <Spinner />
            ) : (
              <>
                <p>{t("femme.commissions.applyDialog.preview.recalculated", { count: preview.entriesRecalculated })}</p>
                <p>{t("femme.commissions.applyDialog.preview.excluded", { count: preview.entriesExcluded })}</p>
                <p className="font-medium" data-testid="commission-recalc-delta">
                  {t("femme.commissions.applyDialog.preview.delta", { amount: formatGuaraniesGs(preview.deltaAmount) })}
                </p>
                {preview.deltaByProfessional.length > 1 && (
                  <ul className="mt-1 list-disc pl-5">
                    {preview.deltaByProfessional.map((d) => (
                      <li key={d.professionalId}>
                        {d.professionalName}: {formatGuaraniesGs(d.amount)}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
        {needsReplace && (
          <Alert variant="warning" data-testid="commission-replace-pending">
            {t("femme.commissions.applyDialog.pendingExists")}
          </Alert>
        )}
        {error && <Alert variant="destructive">{error}</Alert>}
      </div>
    </Modal>
  );
}
