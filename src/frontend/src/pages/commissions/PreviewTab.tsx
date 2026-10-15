import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Label, Select, Text } from "@design-system";
import { getSettings, getSettlementPreview, type SettlementPreview } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { TableWrap, firstOfMonthYmd, formatPercent, tdClass, thClass, todayYmd, useProfessionals } from "./common";

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
    <div className="flex flex-col gap-4" data-testid="commission-preview">
      <Text variant="small" className="text-[var(--color-ink-3)]">
        {t("femme.commissions.preview.hint")}
      </Text>
      <form onSubmit={(e) => void run(e)} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[12rem] flex-col gap-1">
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
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="preview-from">{t("femme.commissions.common.from")}</Label>
          <LocalizedDateInput id="preview-from" value={from} onChange={setFrom} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="preview-to">{t("femme.commissions.common.to")}</Label>
          <LocalizedDateInput id="preview-to" value={to} onChange={setTo} />
        </div>
        <Button type="submit" data-testid="preview-run">
          {t("femme.commissions.preview.run")}
        </Button>
        <div className="w-full">
          <FieldValidationError id="preview-error">{fieldError}</FieldValidationError>
        </div>
      </form>
      {error && <Alert variant="destructive">{error}</Alert>}
      {preview && (
        <>
          <Card className="grid gap-3 p-4 sm:grid-cols-4" data-testid="preview-summary">
            <div>
              <Text variant="small">{t("femme.commissions.preview.total")}</Text>
              <Text className="text-lg font-semibold" data-testid="preview-total">
                {formatGuaraniesGs(preview.total)}
              </Text>
            </div>
            <div>
              <Text variant="small">{t("femme.commissions.kind.SERVICE")}</Text>
              <Text data-testid="preview-services">{formatGuaraniesGs(preview.servicesTotal)}</Text>
            </div>
            <div>
              <Text variant="small">{t("femme.commissions.kind.PRODUCT")}</Text>
              <Text data-testid="preview-products">{formatGuaraniesGs(preview.productsTotal)}</Text>
            </div>
            <div>
              <Text variant="small">{t("femme.commissions.settlement.adjustments")}</Text>
              <Text data-testid="preview-adjustments">{formatGuaraniesGs(preview.adjustmentsTotal)}</Text>
            </div>
          </Card>
          {preview.draftSettlements.length > 0 && (
            <Alert variant="info">{t("femme.commissions.preview.draftExists", { count: preview.draftSettlements.length })}</Alert>
          )}
          {preview.entries.length === 0 ? (
            <Text variant="muted">{t("femme.commissions.preview.empty")}</Text>
          ) : (
            <TableWrap testId="preview-entries">
              <thead>
                <tr>
                  <th className={thClass}>{t("femme.commissions.history.date")}</th>
                  <th className={thClass}>{t("femme.commissions.reports.invoice")}</th>
                  <th className={thClass}>{t("femme.commissions.common.item")}</th>
                  <th className={thClass}>{t("femme.commissions.common.itemKind")}</th>
                  <th className={`${thClass} text-right`}>{t("femme.commissions.settlement.baseAmount")}</th>
                  <th className={`${thClass} text-right`}>%</th>
                  <th className={`${thClass} text-right`}>{t("femme.commissions.settlement.commission")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.entries.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className={tdClass}>{formatParaguayDateTime(e.accrualAt, dateLocale)}</td>
                    <td className={tdClass}>{e.invoiceNumber}</td>
                    <td className={tdClass}>
                      {e.itemName ?? e.note ?? t(`femme.commissions.reason.${e.reasonCode}`)}
                      {e.sourceType === "REVERSAL" && (
                        <span className="block text-xs text-[var(--color-ink-3)]">
                          {t(`femme.commissions.reason.${e.reasonCode ?? "VOID"}`)}
                        </span>
                      )}
                    </td>
                    <td className={tdClass}>{e.itemKind ? t(`femme.commissions.kind.${e.itemKind}`) : ""}</td>
                    <td className={`${tdClass} text-right`}>{formatGuaraniesGs(e.baseAmount)}</td>
                    <td className={`${tdClass} text-right`}>{formatPercent(e.percentApplied)}</td>
                    <td className={`${tdClass} text-right`}>{formatGuaraniesGs(e.commissionAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </>
      )}
    </div>
  );
}
