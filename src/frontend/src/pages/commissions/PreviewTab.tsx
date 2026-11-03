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

  const carriedIds = new Set(preview?.carriedEntryIds ?? []);
  const carriedEntries = (preview?.entries ?? []).filter((e) => carriedIds.has(e.id));
  const periodEntries = (preview?.entries ?? []).filter((e) => !carriedIds.has(e.id));
  /** "2026-11-01" → "01/11/2026" in the user's locale. */
  const fmtDate = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(dateLocale);
  };

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
            {carriedIds.size > 0 && (
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="preview-split">
                <div className="rounded-xl border border-line bg-page px-3 py-2">
                  <b className="block font-heading text-base tabular-nums text-ink" data-testid="preview-period-amount">
                    {formatGuaraniesGs(preview.total - preview.carriedAmount)}
                  </b>
                  <span className="text-xs text-ink-3">{t("femme.commissions.preview.periodTotal", { from: fmtDate(preview.periodFrom), to: fmtDate(preview.periodTo) })}</span>
                </div>
                <div className="rounded-xl border border-warning/40 bg-warning-lt px-3 py-2">
                  <b className="block font-heading text-base tabular-nums text-warning" data-testid="preview-carried-amount">
                    {formatGuaraniesGs(preview.carriedAmount)}
                  </b>
                  <span className="text-xs text-warning">{t("femme.commissions.preview.carriedTotal")}</span>
                </div>
              </div>
            )}
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
          ) : carriedIds.size === 0 ? (
            <ul className="rounded-card border border-line bg-surface shadow-sm" data-testid="preview-entries">
              {preview.entries.map((e) => (
                <EntryRow key={e.id} e={e} dateLocale={dateLocale} t={t} />
              ))}
            </ul>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm" data-testid="preview-entries">
              <GroupHeader
                carried
                testId="preview-group-carried"
                title={t("femme.commissions.preview.carriedGroup", { date: fmtDate(preview.periodFrom) })}
                entries={carriedEntries}
                t={t}
              />
              <ul>
                {carriedEntries.map((e) => (
                  <EntryRow key={e.id} e={e} dateLocale={dateLocale} t={t} carriedTag />
                ))}
              </ul>
              {periodEntries.length > 0 && (
                <>
                  <GroupHeader
                    testId="preview-group-period"
                    title={t("femme.commissions.preview.periodGroup", { from: fmtDate(preview.periodFrom), to: fmtDate(preview.periodTo) })}
                    entries={periodEntries}
                    t={t}
                  />
                  <ul>
                    {periodEntries.map((e) => (
                      <EntryRow key={e.id} e={e} dateLocale={dateLocale} t={t} />
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type EntryT = SettlementPreview["entries"][number];

function GroupHeader({
  title,
  entries,
  carried = false,
  testId,
  t,
}: {
  title: string;
  entries: EntryT[];
  carried?: boolean;
  testId: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const sum = entries.reduce((acc, e) => acc + Number(e.commissionAmount), 0);
  return (
    <div
      data-testid={testId}
      className={`flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-sm font-extrabold first:border-t-0 ${
        carried ? "bg-warning-lt text-warning" : "bg-page text-ink-2"
      }`}
    >
      <span className="min-w-0">{title}</span>
      <span className="shrink-0 tabular-nums">
        {t("femme.commissions.preview.groupLines", { count: entries.length, amount: formatGuaraniesGs(sum) })}
      </span>
    </div>
  );
}

function EntryRow({
  e,
  dateLocale,
  t,
  carriedTag = false,
}: {
  e: EntryT;
  dateLocale: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  carriedTag?: boolean;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-4 py-2.5 first:border-t-0">
      <div className="min-w-0">
        <div className="truncate font-semibold text-ink">
          {e.itemName ?? e.note ?? t(`femme.commissions.reason.${e.reasonCode}`)}
          {carriedTag ? (
            <span
              data-testid="preview-before-period"
              className="ml-1.5 rounded-full bg-warning-lt px-2 py-px align-middle text-[11px] font-extrabold text-warning"
            >
              {t("femme.commissions.preview.beforePeriod")}
            </span>
          ) : null}
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
  );
}
