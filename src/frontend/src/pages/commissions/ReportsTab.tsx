import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Label, Select, Text } from "@design-system";
import {
  downloadCommissionFile,
  entriesCsvPath,
  getLinesWithoutBeneficiary,
  getReport,
  type EntryFilters,
  type LineWithoutBeneficiary,
  type ReportResponse,
  type ReportRow,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { useDateLocale } from "../../i18n/dateLocale";
import { AssignLineDialog } from "./AssignLineDialog";
import { firstOfMonthYmd, todayYmd, useProfessionals } from "./common";

type Group = "byProfessional" | "byItem" | "byKind" | "byPeriod";
const GROUPS: Group[] = ["byProfessional", "byItem", "byKind", "byPeriod"];
const GROUP_TEST_ID: Record<Group, string> = {
  byProfessional: "report-by-professional",
  byItem: "report-by-item",
  byKind: "report-by-kind",
  byPeriod: "report-by-period",
};

/** Ranked rows with a proportional bar: the biggest row is the full bar. */
function RowsBars({ rows, testId, labelOf }: { rows: ReportRow[]; testId: string; labelOf?: (r: ReportRow) => string }) {
  const { t } = useTranslation();
  if (rows.length === 0)
    return (
      <Text variant="muted" className="p-4">
        {t("femme.commissions.reports.empty")}
      </Text>
    );
  const max = Math.max(...rows.map((r) => Math.abs(r.amount)), 1);
  return (
    <ul data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key} className="border-t border-line px-4 py-2.5 first:border-t-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words text-ink">
              {labelOf ? labelOf(r) : r.label}
              <span className="ml-2 text-xs text-ink-3">{t("femme.commissions.reports.linesCount", { count: r.lines })}</span>
            </span>
            <b className="shrink-0 font-heading tabular-nums text-ink">{formatGuaraniesGs(r.amount)}</b>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-primary-lt" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max((Math.abs(r.amount) / max) * 100, 2)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** HU-COM-08: reports by professional, item, item kind and period, plus data-quality lists. */
export function ReportsTab() {
  const { t, i18n } = useTranslation();
  const dateLocale = useDateLocale();
  const professionals = useProfessionals();
  const [from, setFrom] = useState(firstOfMonthYmd());
  const [to, setTo] = useState(todayYmd());
  const [professionalId, setProfessionalId] = useState("");
  const [kind, setKind] = useState("");
  const [state, setState] = useState("");
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [orphans, setOrphans] = useState<LineWithoutBeneficiary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toAssign, setToAssign] = useState<LineWithoutBeneficiary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>("byProfessional");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filters: EntryFilters = {
    from,
    to,
    professionalId: professionalId ? Number(professionalId) : null,
    kind,
    state,
  };

  const load = useCallback(async () => {
    try {
      const [r, o] = await Promise.all([
        getReport({ from, to, professionalId: professionalId ? Number(professionalId) : null, kind, state }),
        getLinesWithoutBeneficiary(from, to),
      ]);
      setReport(r);
      setOrphans(o);
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [from, to, professionalId, kind, state, t]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const labelFor = (g: Group) => (g === "byKind" ? (r: ReportRow) => t(`femme.commissions.kind.${r.key}`) : undefined);

  return (
    <div className="flex flex-col gap-3" data-testid="commission-reports">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("femme.commissions.tabs.reports")}>
        {GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={group === g}
            data-testid={`report-group-${g}`}
            onClick={() => setGroup(g)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
              group === g ? "border-primary bg-primary-lt text-primary" : "border-line bg-surface text-ink hover:bg-bg"
            }`}
          >
            {t(`femme.commissions.reports.${g}`)}
          </button>
        ))}
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="flex flex-col gap-1">
            <Label htmlFor="report-from">{t("femme.commissions.common.from")}</Label>
            <LocalizedDateInput id="report-from" value={from} onChange={setFrom} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="report-to">{t("femme.commissions.common.to")}</Label>
            <LocalizedDateInput id="report-to" value={to} onChange={setTo} />
          </div>
          <Button type="submit" className="min-h-11" data-testid="commission-report-search">
            {t("femme.commissions.common.search")}
          </Button>
        </div>
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="report-filters"
          data-testid="report-filters-toggle"
          onClick={() => setFiltersOpen((o) => !o)}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left font-heading font-extrabold text-ink"
        >
          {t("femme.commissions.reports.moreFilters")}
          <span aria-hidden className={`text-ink-3 transition-transform ${filtersOpen ? "rotate-180" : ""}`}>
            ⌄
          </span>
        </button>
        {filtersOpen && (
          <div id="report-filters" className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="report-professional">{t("femme.commissions.common.professional")}</Label>
              <Select id="report-professional" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                <option value="">{t("femme.commissions.common.allProfessionals")}</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="report-kind">{t("femme.commissions.common.itemKind")}</Label>
              <Select id="report-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">{t("femme.commissions.kind.ALL")}</option>
                <option value="SERVICE">{t("femme.commissions.kind.SERVICE")}</option>
                <option value="PRODUCT">{t("femme.commissions.kind.PRODUCT")}</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="report-state">{t("femme.commissions.reports.settlementState")}</Label>
              <Select id="report-state" value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">{t("femme.commissions.common.allStatuses")}</option>
                {["UNSETTLED", "DRAFT", "APPROVED", "PAID"].map((s) => (
                  <option key={s} value={s}>
                    {t(`femme.commissions.settlementStatus.${s}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
      </form>
      {error && <Alert variant="destructive">{error}</Alert>}
      {report && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Text className="font-semibold" data-testid="commission-report-total">
              {t("femme.commissions.reports.total", { amount: formatGuaraniesGs(report.total) })}
            </Text>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() =>
                void downloadCommissionFile(entriesCsvPath(filters, i18n.language), "comisiones.csv").catch((err) =>
                  setError(translateApiError(err, t)),
                )
              }
              data-testid="commission-export-entries"
            >
              {t("femme.commissions.common.exportCsv")}
            </Button>
          </div>
          <div className="rounded-card border border-line bg-surface shadow-sm">
            <RowsBars rows={report[group]} testId={GROUP_TEST_ID[group]} labelOf={labelFor(group)} />
          </div>
        </>
      )}

      <h3 className="mt-2 font-heading text-xs font-extrabold uppercase tracking-wider text-primary">
        {t("femme.commissions.reports.linesWithoutBeneficiary")}
      </h3>
      {notice && (
        <Alert variant="success" role="status">
          {notice}
        </Alert>
      )}
      <div className="rounded-card border border-line bg-surface shadow-sm">
        {orphans.length === 0 ? (
          <Text variant="muted" className="p-4">
            {t("femme.commissions.reports.empty")}
          </Text>
        ) : (
          <ul data-testid="report-lines-without-beneficiary">
            {orphans.map((o) => (
              <li
                key={o.invoiceLineId}
                data-testid={`orphan-line-${o.invoiceLineId}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-4 py-2.5 first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">{o.description}</div>
                  <div className="text-sm text-ink-3">
                    {formatParaguayDateTime(o.issuedAt, dateLocale)} · {o.invoiceNumber} · {formatGuaraniesGs(o.lineTotal)}
                  </div>
                </div>
                <Button type="button" size="sm" variant="secondary" className="min-h-11" onClick={() => setToAssign(o)}>
                  {t("femme.commissions.assignLine.action")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AssignLineDialog
        line={toAssign}
        onClose={() => setToAssign(null)}
        onDone={(name) => {
          setToAssign(null);
          setNotice(t("femme.commissions.assignLine.done", { professional: name }));
          void load();
        }}
      />
    </div>
  );
}
