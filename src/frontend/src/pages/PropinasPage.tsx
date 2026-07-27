import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Heading,
  Input,
  Label,
  MultiSelect,
  PageSizeSelect,
  Pagination,
  Spinner,
  Text,
} from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import {
  createTipWithdrawal,
  downloadTipsReportPdf,
  getProfessionalTipBalance,
  getTipsReport,
  listTipWithdrawalsPaged,
  type TipReportResponse,
  type TipWithdrawalHistoryItem,
} from "../api/propinas";
import { FieldValidationError } from "../components/FieldValidationError";
import { SearchableSelect } from "../components/SearchableSelect";
import { useDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal } from "../lib/formatMoney";
import { maskMoneyInput, parseMaskedMoney } from "../lib/moneyInputMask";
import { formatParaguayDate, formatParaguayDateTime } from "../lib/paraguayDateTime";

type Professional = { id: number; fullName: string; active: boolean };

/** Local calendar dates: 30 days ago through today. */
function getDefaultReportDateRange(): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fmtYmd = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return { from: fmtYmd(thirtyDaysAgo), to: fmtYmd(today) };
}

function localDateYmdToIsoStart(ymd: string): string {
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 0, 0, 0, 0).toISOString();
}

function localDateYmdToIsoEnd(ymd: string): string {
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 23, 59, 59, 999).toISOString();
}

function ReportTab({ professionals }: { professionals: Professional[] }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [filterFrom, setFilterFrom] = useState(() => getDefaultReportDateRange().from);
  const [filterTo, setFilterTo] = useState(() => getDefaultReportDateRange().to);
  const [filterProfessionalIds, setFilterProfessionalIds] = useState<number[]>([]);
  const [report, setReport] = useState<TipReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const load = useCallback(
    async (from: string, to: string, professionalIds: number[]) => {
      setLoadError(null);
      setLoading(true);
      try {
        const data = await getTipsReport({
          from: localDateYmdToIsoStart(from),
          to: localDateYmdToIsoEnd(to),
          professionalIds,
        });
        setReport(data);
      } catch (err) {
        setLoadError(translateApiError(err, t, "femme.propinas.report.loadError"));
        setReport(null);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load(filterFrom, filterTo, filterProfessionalIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleExportPdf() {
    setExportError(null);
    setExporting(true);
    try {
      await downloadTipsReportPdf({
        from: localDateYmdToIsoStart(filterFrom),
        to: localDateYmdToIsoEnd(filterTo),
        professionalIds: filterProfessionalIds,
      });
    } catch (err) {
      setExportError(translateApiError(err, t, "femme.propinas.report.exportError"));
    } finally {
      setExporting(false);
    }
  }

  const professionalOptions = useMemo(
    () => professionals.filter((p) => p.active).map((p) => ({ value: p.id, label: p.fullName })),
    [professionals],
  );

  const groups = useMemo(() => {
    if (!report) return [];
    const byProfessional = new Map<number, typeof report.rows>();
    for (const row of report.rows) {
      const list = byProfessional.get(row.professionalId) ?? [];
      list.push(row);
      byProfessional.set(row.professionalId, list);
    }
    return report.professionalTotals.map((total) => ({
      total,
      rows: byProfessional.get(total.professionalId) ?? [],
    }));
  }, [report]);

  const showSubtotals = groups.length > 1;

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load(filterFrom, filterTo, filterProfessionalIds);
        }}
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        noValidate
      >
        <div className="flex flex-col gap-1 min-w-[140px]">
          <Label htmlFor="propinas-filter-from">{t("femme.propinas.report.filterFrom")}</Label>
          <Input
            id="propinas-filter-from"
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[140px]">
          <Label htmlFor="propinas-filter-to">{t("femme.propinas.report.filterTo")}</Label>
          <Input
            id="propinas-filter-to"
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
          />
        </div>
        <MultiSelect
          id="propinas-filter-professionals"
          className="min-w-[220px]"
          label={t("femme.propinas.report.filterProfessional")}
          value={filterProfessionalIds}
          onChange={setFilterProfessionalIds}
          options={professionalOptions}
          placeholder={t("femme.propinas.report.filterProfessionalPlaceholder")}
          filterPlaceholder={t("femme.propinas.report.filterProfessionalFilterPlaceholder")}
          noResultsText={t("femme.propinas.report.filterProfessionalNoResults")}
          summaryTemplate={t("femme.propinas.report.filterProfessionalSummary")}
        />
        <Button type="submit" variant="primary" size="sm" disabled={loading}>
          {t("femme.propinas.report.search")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void handleExportPdf()}
          disabled={exporting || loading || !report || report.rows.length === 0}
        >
          {exporting ? t("femme.propinas.report.exporting") : t("femme.propinas.report.exportPdf")}
        </Button>
      </form>

      {loadError && (
        <Alert variant="destructive" title={t("femme.propinas.errorTitle")}>
          {loadError}
        </Alert>
      )}
      {exportError && (
        <Alert variant="destructive" title={t("femme.propinas.errorTitle")}>
          {exportError}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <Text>{t("femme.propinas.report.loading")}</Text>
        </div>
      ) : !report || report.rows.length === 0 ? (
        <Text variant="muted">{t("femme.propinas.report.empty")}</Text>
      ) : (
        <div
          style={{
            background: "var(--color-white)",
            borderRadius: "var(--radius-xl)",
            border: "var(--border-default)",
            overflow: "hidden",
          }}
        >
          <div className="overflow-x-auto" data-testid="propinas-report-table">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  {(
                    [
                      "colProfessional",
                      "colAmount",
                      "colClient",
                      "colDateTime",
                    ] as const
                  ).map((key, i) => (
                    <th
                      key={key}
                      style={{
                        padding: "9px 12px",
                        fontSize: 10,
                        fontWeight: 500,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--color-ink-3)",
                        background: "var(--color-stone)",
                        textAlign: i === 1 ? "right" : "left",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t(`femme.propinas.report.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.total.professionalId}>
                    {group.rows.map((row, idx) => (
                      <tr key={`${group.total.professionalId}-${idx}`} style={{ borderTop: "var(--border-default)" }}>
                        <td style={{ padding: "10px 12px" }}>{row.professionalName}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {formatAmountDecimal(row.amount)}
                        </td>
                        <td style={{ padding: "10px 12px" }}>{row.clientName}</td>
                        <td style={{ padding: "10px 12px" }}>
                          {formatParaguayDateTime(row.serviceDateTime, dateLocale)}
                        </td>
                      </tr>
                    ))}
                    {showSubtotals && (
                      <tr
                        key={`${group.total.professionalId}-subtotal`}
                        style={{ borderTop: "var(--border-default)", fontWeight: 600 }}
                      >
                        <td style={{ padding: "10px 12px" }}>
                          {t("femme.propinas.report.subtotalLabel", {
                            name: group.total.professionalName,
                          })}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {formatAmountDecimal(group.total.total)}
                        </td>
                        <td style={{ padding: "10px 12px" }} />
                        <td style={{ padding: "10px 12px" }} />
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr style={{ borderTop: "2px solid var(--border-default)", fontWeight: 700 }}>
                  <td style={{ padding: "10px 12px" }}>{t("femme.propinas.report.grandTotalLabel")}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    {formatAmountDecimal(report.grandTotal)}
                  </td>
                  <td style={{ padding: "10px 12px" }} />
                  <td style={{ padding: "10px 12px" }} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function WithdrawalTab({ professionals }: { professionals: Professional[] }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [professionalId, setProfessionalId] = useState<number | "">("");
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<{
    content: TipWithdrawalHistoryItem[];
    totalElements: number;
    totalPages: number;
  } | null>(null);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyPageSize, setHistoryPageSize] = useState(10);

  const professionalOptions = useMemo(
    () => professionals.filter((p) => p.active).map((p) => ({ value: p.id, label: p.fullName })),
    [professionals],
  );

  const loadBalance = useCallback(
    async (id: number) => {
      setBalanceError(null);
      setBalanceLoading(true);
      try {
        const data = await getProfessionalTipBalance(id);
        setBalance(data.balance);
      } catch (err) {
        setBalanceError(translateApiError(err, t, "femme.propinas.errorTitle"));
        setBalance(null);
      } finally {
        setBalanceLoading(false);
      }
    },
    [t],
  );

  const loadHistory = useCallback(async (id: number, page: number, size: number) => {
    try {
      const data = await listTipWithdrawalsPaged({ professionalId: id, page, size });
      setHistory(data);
    } catch {
      setHistory(null);
    }
  }, []);

  useEffect(() => {
    if (professionalId === "") {
      setBalance(null);
      setHistory(null);
      return;
    }
    void loadBalance(professionalId);
    setHistoryPage(0);
    void loadHistory(professionalId, 0, historyPageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [professionalId]);

  useEffect(() => {
    if (professionalId === "") return;
    void loadHistory(professionalId, historyPage, historyPageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyPage, historyPageSize]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSuccessMessage(null);
    if (professionalId === "") return;
    const parsed = parseMaskedMoney(amount);
    if (parsed <= 0) {
      setFieldError(t("femme.propinas.withdrawal.amountInvalid"));
      return;
    }
    if (balance != null && parsed > balance) {
      setFieldError(t("femme.propinas.withdrawal.amountExceedsBalance"));
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      const result = await createTipWithdrawal(professionalId, parsed);
      setBalance(result.newBalance);
      setAmount("");
      setSuccessMessage(t("femme.propinas.withdrawal.success"));
      setHistoryPage(0);
      void loadHistory(professionalId, 0, historyPageSize);
    } catch (err) {
      setSubmitError(translateApiError(err, t, "femme.propinas.errorTitle"));
    } finally {
      setSubmitting(false);
    }
  }

  const totalElements = history?.totalElements ?? 0;
  const totalPages = history?.totalPages ?? 0;
  const showingFrom = totalElements === 0 ? 0 : historyPage * historyPageSize + 1;
  const showingTo = Math.min((historyPage + 1) * historyPageSize, totalElements);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 sm:p-6 flex flex-col gap-4 max-w-lg">
        <SearchableSelect
          id="propinas-withdrawal-professional"
          label={t("femme.propinas.withdrawal.professionalLabel")}
          value={professionalId}
          onChange={(v) => setProfessionalId(v)}
          options={professionalOptions}
          filterPlaceholder={t("femme.propinas.withdrawal.professionalFilterPlaceholder")}
          noResultsText={t("femme.propinas.withdrawal.professionalNoResults")}
        />

        {professionalId === "" ? (
          <Text variant="muted">{t("femme.propinas.withdrawal.selectProfessionalPrompt")}</Text>
        ) : (
          <>
            {balanceError && (
              <Alert variant="destructive" title={t("femme.propinas.errorTitle")}>
                {balanceError}
              </Alert>
            )}
            <div className="flex items-center justify-between">
              <Text className="font-medium">{t("femme.propinas.withdrawal.balanceLabel")}</Text>
              {balanceLoading ? (
                <Spinner size="sm" />
              ) : (
                <Text data-testid="propinas-balance" className="font-semibold">
                  {formatAmountDecimal(balance ?? 0)}
                </Text>
              )}
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-2" noValidate>
              <Label htmlFor="propinas-withdrawal-amount">
                {t("femme.propinas.withdrawal.amountLabel")}
              </Label>
              <Input
                id="propinas-withdrawal-amount"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(maskMoneyInput(e.target.value))}
                placeholder={t("femme.propinas.withdrawal.amountPlaceholder")}
                invalid={!!fieldError}
                aria-invalid={!!fieldError}
                aria-describedby={fieldError ? "propinas-withdrawal-amount-error" : undefined}
              />
              <FieldValidationError id="propinas-withdrawal-amount-error">
                {fieldError}
              </FieldValidationError>
              {submitError && (
                <Alert variant="destructive" title={t("femme.propinas.errorTitle")}>
                  {submitError}
                </Alert>
              )}
              {successMessage && <Alert variant="default">{successMessage}</Alert>}
              <Button type="submit" variant="primary" disabled={submitting} className="w-fit">
                {submitting ? t("femme.propinas.withdrawal.submitting") : t("femme.propinas.withdrawal.submit")}
              </Button>
            </form>
          </>
        )}
      </Card>

      {professionalId !== "" && (
        <Card className="p-4 sm:p-6 flex flex-col gap-3">
          <Heading as="h3" className="text-base">
            {t("femme.propinas.withdrawal.historyTitle")}
          </Heading>
          {!history || history.content.length === 0 ? (
            <Text variant="muted">{t("femme.propinas.withdrawal.historyEmpty")}</Text>
          ) : (
            <>
              <div className="overflow-x-auto" data-testid="propinas-withdrawal-history-table">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <th style={{ padding: "9px 12px", textAlign: "left", fontSize: 10, textTransform: "uppercase", color: "var(--color-ink-3)" }}>
                        {t("femme.propinas.withdrawal.historyColDate")}
                      </th>
                      <th style={{ padding: "9px 12px", textAlign: "right", fontSize: 10, textTransform: "uppercase", color: "var(--color-ink-3)" }}>
                        {t("femme.propinas.withdrawal.historyColAmount")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.content.map((item) => (
                      <tr key={item.id} style={{ borderTop: "var(--border-default)" }}>
                        <td style={{ padding: "10px 12px" }}>{formatParaguayDate(item.withdrawnAt, dateLocale)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {formatAmountDecimal(item.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <PageSizeSelect
                  value={historyPageSize}
                  onChange={(s) => {
                    setHistoryPageSize(s);
                    setHistoryPage(0);
                  }}
                  label={t("femme.pagination.rowsPerPage")}
                />
                <Text variant="small" className="text-[var(--color-ink-3)]">
                  {t("femme.pagination.showingRange", { from: showingFrom, to: showingTo, total: totalElements })}
                </Text>
                <Pagination
                  page={historyPage + 1}
                  pageCount={totalPages}
                  onPageChange={(p) => setHistoryPage(p - 1)}
                  previousLabel={t("femme.pagination.previous")}
                  nextLabel={t("femme.pagination.next")}
                />
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

export default function PropinasPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"report" | "withdrawal">("report");
  const [professionals, setProfessionals] = useState<Professional[]>([]);

  useEffect(() => {
    femmeJson<Professional[]>("/api/professionals")
      .then((list) => setProfessionals(Array.isArray(list) ? list : []))
      .catch(() => setProfessionals([]));
  }, []);

  const tabBase: React.CSSProperties = {
    padding: "6px 14px",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    cursor: "pointer",
    border: "var(--border-default)",
    background: "var(--color-white)",
    color: "var(--color-ink-2)",
  };
  const tabActive: React.CSSProperties = {
    ...tabBase,
    background: "var(--color-rose-lt)",
    border: "1px solid var(--color-rose-md)",
    color: "var(--color-rose-dk)",
    fontWeight: 500,
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-ink)" }}>
          {t("femme.propinas.pageTitle")}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
          {t("femme.propinas.pageSubtitle")}
        </div>
      </div>

      <div
        style={{ display: "flex", gap: 4, marginBottom: 14 }}
        role="tablist"
        aria-label={t("femme.propinas.pageTitle")}
      >
        {(["report", "withdrawal"] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={activeTab === tabKey}
            style={activeTab === tabKey ? tabActive : tabBase}
            onClick={() => setActiveTab(tabKey)}
          >
            {t(`femme.propinas.tabs.${tabKey}`)}
          </button>
        ))}
      </div>

      <div hidden={activeTab !== "report"}>
        <ReportTab professionals={professionals} />
      </div>
      <div hidden={activeTab !== "withdrawal"}>
        <WithdrawalTab professionals={professionals} />
      </div>
    </div>
  );
}
