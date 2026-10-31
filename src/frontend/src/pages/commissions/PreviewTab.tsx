import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Label, Select, Text } from "@design-system";
import { getSettings, getSettlementPreview, type SettlementPreview } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { firstOfMonthYmd, formatPercent, todayYmd, useProfessionals } from "./common";

/**
 * Replaces the old simulator: how much a professional would be paid today for an open period,
 * from the commissions recorded so far (what a settlement generated now would contain).
 */
export function PreviewTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const professionals = useProfessionals();
  const [professionalId, setProfessionalId] = useState("");
  const [from, setFrom] = useState(firstOfMonthYmd());
  const [to, setTo] = useState(todayYmd());
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Default to the tenant's current settlement period.
    getSettings()
      .then((s) => {
        if (s.currentPeriod.from) setFrom(s.currentPeriod.from);
        if (s.currentPeriod.to) setTo(s.currentPeriod.to);
      })
      .catch(() => undefined);
  }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!professionalId) {
      setFieldError(t("femme.commissions.reassign.professionalRequired"));
      return;
    }
    setFieldError(null);
    try {
      setPreview(await getSettlementPreview(Number(professionalId), from, to));
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="commission-preview">
      <p className="px-0.5 text-sm text-ink-3">{t("femme.commissions.preview.hint")}</p>
      <form
        onSubmit={(e) => void run(e)}
        className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="preview-professional" required>
            {t("femme.commissions.common.professional")}
          </Label>
          <Select
            id="preview-professional"
            value={professionalId}
            onChange={(e) => setProfessionalId(e.target.value)}
            aria-describedby={fieldError ? "preview-error" : undefined}
          >
            <option value="">{t("femme.commissions.rules.chooseProfessional")}</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </Select>
          <FieldValidationError id="preview-error">{fieldError}</FieldValidationError>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="preview-from">{t("femme.commissions.common.from")}</Label>
            <LocalizedDateInput id="preview-from" value={from} onChange={setFrom} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="preview-to">{t("femme.commissions.common.to")}</Label>
            <LocalizedDateInput id="preview-to" value={to} onChange={setTo} />
          </div>
        </div>
        <Button type="submit" className="min-h-11 self-start" data-testid="preview-run">
          {t("femme.commissions.preview.run")}
        </Button>
      </form>
      {error && <Alert variant="destructive">{error}</Alert>}
      {preview && (
        <>
          <section className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4 shadow-sm" data-testid="preview-summary">
            <span className="text-sm text-ink-3">{t("femme.commissions.preview.total")}</span>
            <span className="font-heading text-3xl font-extrabold tabular-nums text-ink" data-testid="preview-total">
              {formatGuaraniesGs(preview.total)}
            </span>
            <span className="text-sm text-ink-3">
              {t("femme.commissions.kind.SERVICE")}{" "}
              <b className="tabular-nums text-ink" data-testid="preview-services">
                {formatGuaraniesGs(preview.servicesTotal)}
              </b>{" "}
              · {t("femme.commissions.kind.PRODUCT")}{" "}
              <b className="tabular-nums text-ink" data-testid="preview-products">
                {formatGuaraniesGs(preview.productsTotal)}
              </b>{" "}
              · {t("femme.commissions.settlement.adjustments")}{" "}
              <b className="tabular-nums text-ink" data-testid="preview-adjustments">
                {formatGuaraniesGs(preview.adjustmentsTotal)}
              </b>
            </span>
          </section>
          {preview.draftSettlements.length > 0 && (
            <Alert variant="info">{t("femme.commissions.preview.draftExists", { count: preview.draftSettlements.length })}</Alert>
          )}
          {preview.entries.length === 0 ? (
            <Text variant="muted">{t("femme.commissions.preview.empty")}</Text>
          ) : (
            <ul className="rounded-card border border-line bg-surface shadow-sm" data-testid="preview-entries">
              {preview.entries.map((e) => (
                <li
                  key={e.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-4 py-2.5 first:border-t-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">
                      {e.itemName ?? e.note ?? t(`femme.commissions.reason.${e.reasonCode}`)}
                    </div>
                    <div className="text-sm text-ink-3">
                      {formatParaguayDateTime(e.accrualAt, dateLocale)}
                      {e.invoiceNumber ? ` · ${e.invoiceNumber}` : ""} · {formatGuaraniesGs(e.baseAmount)} ×{" "}
                      {formatPercent(e.percentApplied)}
                      {e.sourceType === "REVERSAL" ? ` · ${t(`femme.commissions.reason.${e.reasonCode ?? "VOID"}`)}` : ""}
                    </div>
                  </div>
                  <span className="text-right font-heading font-extrabold tabular-nums text-ink">
                    {formatGuaraniesGs(e.commissionAmount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
