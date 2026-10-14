import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Label, Select, Text } from "@design-system";
import {
  downloadCommissionFile,
  entriesCsvPath,
  getItemsWithoutRule,
  getLinesWithoutBeneficiary,
  getReport,
  type EntryFilters,
  type ItemWithoutRule,
  type LineWithoutBeneficiary,
  type ReportResponse,
  type ReportRow,
} from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { useDateLocale } from "../../i18n/dateLocale";
import { SectionTitle, TableWrap, firstOfMonthYmd, tdClass, thClass, todayYmd, useProfessionals } from "./common";

function RowsTable({ rows, testId, labelOf }: { rows: ReportRow[]; testId: string; labelOf?: (r: ReportRow) => string }) {
  const { t } = useTranslation();
  if (rows.length === 0) return <Text variant="muted">{t("femme.commissions.reports.empty")}</Text>;
  return (
    <TableWrap testId={testId}>
      <thead>
        <tr>
          <th className={thClass}>{t("femme.commissions.reports.concept")}</th>
          <th className={`${thClass} text-right`}>{t("femme.commissions.reports.lines")}</th>
          <th className={`${thClass} text-right`}>{t("femme.commissions.common.total")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t">
            <td className={tdClass}>{labelOf ? labelOf(r) : r.label}</td>
            <td className={`${tdClass} text-right`}>{r.lines}</td>
            <td className={`${tdClass} text-right`}>{formatGuaraniesGs(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

/** HU-COM-08: reports by professional, item, item kind and period, plus data-quality lists. */
export function ReportsTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const professionals = useProfessionals();
  const [from, setFrom] = useState(firstOfMonthYmd());
  const [to, setTo] = useState(todayYmd());
  const [professionalId, setProfessionalId] = useState("");
  const [kind, setKind] = useState("");
  const [state, setState] = useState("");
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [orphans, setOrphans] = useState<LineWithoutBeneficiary[]>([]);
  const [noRule, setNoRule] = useState<ItemWithoutRule[]>([]);
  const [error, setError] = useState<string | null>(null);

  const filters: EntryFilters = {
    from,
    to,
    professionalId: professionalId ? Number(professionalId) : null,
    kind,
    state,
  };

  const load = useCallback(async () => {
    try {
      const [r, o, n] = await Promise.all([
        getReport({ from, to, professionalId: professionalId ? Number(professionalId) : null, kind, state }),
        getLinesWithoutBeneficiary(from, to),
        getItemsWithoutRule(),
      ]);
      setReport(r);
      setOrphans(o);
      setNoRule(n);
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [from, to, professionalId, kind, state, t]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4" data-testid="commission-reports">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="report-from">{t("femme.commissions.common.from")}</Label>
          <LocalizedDateInput id="report-from" value={from} onChange={setFrom} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="report-to">{t("femme.commissions.common.to")}</Label>
          <LocalizedDateInput id="report-to" value={to} onChange={setTo} />
        </div>
        <div className="flex min-w-[12rem] flex-col gap-1">
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
        <Button type="submit" data-testid="commission-report-search">
          {t("femme.commissions.common.search")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void downloadCommissionFile(entriesCsvPath(filters), "comisiones.csv").catch((err) =>
              setError(translateApiError(err, t)),
            )
          }
          data-testid="commission-export-entries"
        >
          {t("femme.commissions.common.exportCsv")}
        </Button>
      </form>
      {error && <Alert variant="destructive">{error}</Alert>}
      {report && (
        <>
          <Text className="font-medium" data-testid="commission-report-total">
            {t("femme.commissions.reports.total", { amount: formatGuaraniesGs(report.total) })}
          </Text>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="flex flex-col gap-2 p-4">
              <SectionTitle>{t("femme.commissions.reports.byProfessional")}</SectionTitle>
              <RowsTable rows={report.byProfessional} testId="report-by-professional" />
            </Card>
            <Card className="flex flex-col gap-2 p-4">
              <SectionTitle>{t("femme.commissions.reports.byKind")}</SectionTitle>
              <RowsTable rows={report.byKind} testId="report-by-kind" labelOf={(r) => t(`femme.commissions.kind.${r.key}`)} />
            </Card>
            <Card className="flex flex-col gap-2 p-4">
              <SectionTitle>{t("femme.commissions.reports.byItem")}</SectionTitle>
              <RowsTable rows={report.byItem} testId="report-by-item" />
            </Card>
            <Card className="flex flex-col gap-2 p-4">
              <SectionTitle>{t("femme.commissions.reports.byPeriod")}</SectionTitle>
              <RowsTable rows={report.byPeriod} testId="report-by-period" />
            </Card>
          </div>
        </>
      )}
      <Card className="flex flex-col gap-2 p-4">
        <SectionTitle>{t("femme.commissions.reports.linesWithoutBeneficiary")}</SectionTitle>
        {orphans.length === 0 ? (
          <Text variant="muted">{t("femme.commissions.reports.empty")}</Text>
        ) : (
          <TableWrap testId="report-lines-without-beneficiary">
            <thead>
              <tr>
                <th className={thClass}>{t("femme.commissions.reports.invoice")}</th>
                <th className={thClass}>{t("femme.commissions.history.date")}</th>
                <th className={thClass}>{t("femme.commissions.common.item")}</th>
                <th className={thClass}>{t("femme.commissions.common.itemKind")}</th>
                <th className={`${thClass} text-right`}>{t("femme.commissions.common.total")}</th>
              </tr>
            </thead>
            <tbody>
              {orphans.map((o, i) => (
                <tr key={`${o.invoiceId}-${i}`} className="border-t">
                  <td className={tdClass}>{o.invoiceNumber}</td>
                  <td className={tdClass}>{formatParaguayDateTime(o.issuedAt, dateLocale)}</td>
                  <td className={tdClass}>{o.description}</td>
                  <td className={tdClass}>{o.itemKind ? t(`femme.commissions.kind.${o.itemKind}`) : ""}</td>
                  <td className={`${tdClass} text-right`}>{formatGuaraniesGs(o.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      <Card className="flex flex-col gap-2 p-4">
        <SectionTitle>{t("femme.commissions.reports.itemsWithoutRule")}</SectionTitle>
        {noRule.length === 0 ? (
          <Text variant="muted">{t("femme.commissions.reports.empty")}</Text>
        ) : (
          <ul className="list-disc pl-5 text-sm" data-testid="report-items-without-rule">
            {noRule.map((n) => (
              <li key={n.serviceId}>
                {n.serviceName} ({t(`femme.commissions.kind.${n.itemKind}`)})
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
