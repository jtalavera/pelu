import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  FloatingDropdown,
  Heading,
  Input,
  Label,
  PageSizeSelect,
  Pagination,
  Spinner,
  Text,
} from "@design-system";
import { listInvoicesPaged, type PagedInvoicesResponse } from "../../api/invoices";
import { listCashSessionsPaged, type CashSessionListItem } from "../../api/cashSessions";
import type { PageResponse } from "../../api/pagination";
import { downloadInvoiceHistoryReport } from "../../api/downloadInvoiceHistoryReport";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { CashSessionDetailModal } from "../../components/CashSessionDetailModal";
import { InvoiceCorrectionForm } from "../../components/InvoiceCorrectionForm";
import { InvoiceDetailModal } from "../../components/InvoiceDetailModal";
import { InvoiceStatePill, deriveInvoiceState } from "../../components/InvoiceStatePill";
import { isSifenStatusInFlight, useSifenStatusLiveRefresh } from "../../hooks/useSifenStatusLiveRefresh";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatAmountDecimal } from "../../lib/formatMoney";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import {
  getDefaultInvoiceHistoryDateRange,
  invoiceHistoryRangeErrorKey,
  localDateYmdToIsoEnd,
  localDateYmdToIsoStart,
  paymentMethodsLabel,
} from "./billingShared";

export type HistoryView = "invoices" | "cash";

/** Search box: pressing Enter or the button applies the query (same as the rest of the app). */
function HistorySearch({
  id,
  value,
  onSubmit,
  placeholder,
  label,
  buttonLabel,
}: {
  id: string;
  value: string;
  onSubmit: (v: string) => void;
  placeholder: string;
  label: string;
  buttonLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <form
      className="flex min-w-0 flex-1 basis-64 gap-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft.trim());
      }}
    >
      <Input
        id={id}
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1"
      />
      <Button type="submit" variant="primary" data-testid={`${id}-submit`}>
        {buttonLabel}
      </Button>
    </form>
  );
}

function Chips<T extends string>({
  value,
  options,
  onChange,
  label,
  testIdPrefix,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  testIdPrefix: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value || "all"}
          type="button"
          data-testid={`${testIdPrefix}-${o.value || "all"}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="min-h-11 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-primary-lt aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-fg"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DateFilters({
  idPrefix,
  from,
  to,
  onFrom,
  onTo,
  onClear,
}: {
  idPrefix: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4" data-testid={`${idPrefix}-filters-panel`}>
      <div className="flex min-w-[140px] flex-col gap-1">
        <Label htmlFor={`${idPrefix}-from`}>{t("femme.billing.history.filterFrom")}</Label>
        <Input id={`${idPrefix}-from`} type="date" value={from} onChange={(e) => onFrom(e.target.value)} />
      </div>
      <div className="flex min-w-[140px] flex-col gap-1">
        <Label htmlFor={`${idPrefix}-to`}>{t("femme.billing.history.filterTo")}</Label>
        <Input id={`${idPrefix}-to`} type="date" value={to} onChange={(e) => onTo(e.target.value)} />
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onClear}>
        {t("femme.billing.history.clearFilters")}
      </Button>
    </div>
  );
}

function ListFooter({
  pageSize,
  setPageSize,
  setPageNum,
  pageNum,
  totalPages,
  showingFrom,
  showingTo,
  totalElements,
  testId,
}: {
  pageSize: number;
  setPageSize: (n: number) => void;
  setPageNum: (n: number) => void;
  pageNum: number;
  totalPages: number;
  showingFrom: number;
  showingTo: number;
  totalElements: number;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid={testId}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3"
    >
      <PageSizeSelect
        value={pageSize}
        onChange={(s) => {
          setPageSize(s);
          setPageNum(0);
        }}
        label={t("femme.pagination.rowsPerPage")}
      />
      <Text variant="small" className="text-ink-3">
        {t("femme.pagination.showingRange", { from: showingFrom, to: showingTo, total: totalElements })}
      </Text>
      <Pagination
        page={pageNum + 1}
        pageCount={totalPages}
        onPageChange={(p) => setPageNum(p - 1)}
        previousLabel={t("femme.pagination.previous")}
        nextLabel={t("femme.pagination.next")}
      />
    </div>
  );
}

function InvoiceListView({ refreshTrigger, isActive }: { refreshTrigger: number; isActive: boolean }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [invoicePage, setInvoicePage] = useState<PagedInvoicesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dateRangeError, setDateRangeError] = useState<string | null>(null);
  const [filterFrom, setFilterFrom] = useState(() => getDefaultInvoiceHistoryDateRange().from);
  const [filterTo, setFilterTo] = useState(() => getDefaultInvoiceHistoryDateRange().to);
  const [filterStatus, setFilterStatus] = useState("");
  const [listTextQuery, setListTextQuery] = useState("");
  const [pageNum, setPageNum] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  // Issue #175: "Corregir y reenviar" opened directly from a Rechazado row.
  const [correctionInvoiceId, setCorrectionInvoiceId] = useState<number | null>(null);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Issue #174 AC-05: "Descargar reporte" dropdown (Excel / PDF) next to "Actualizar".
  const [reportMenuOpen, setReportMenuOpen] = useState(false);
  const [reportDownloading, setReportDownloading] = useState<"pdf" | "xlsx" | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const reportAnchorRef = useRef<HTMLDivElement>(null);
  const reportPanelRef = useRef<HTMLDivElement>(null);

  const handleDownloadReport = useCallback(
    async (format: "pdf" | "xlsx") => {
      setReportMenuOpen(false);
      setReportError(null);
      if (invoiceHistoryRangeErrorKey(filterFrom, filterTo)) {
        setReportError(t("femme.billing.history.report.rangeInvalid"));
        return;
      }
      setReportDownloading(format);
      try {
        await downloadInvoiceHistoryReport(
          {
            from: localDateYmdToIsoStart(filterFrom),
            to: localDateYmdToIsoEnd(filterTo),
            status: filterStatus || undefined,
            q: listTextQuery || undefined,
          },
          format,
        );
      } catch (err) {
        setReportError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
      } finally {
        setReportDownloading(null);
      }
    },
    [filterFrom, filterTo, filterStatus, listTextQuery, t],
  );

  useEffect(() => {
    if (!reportMenuOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        reportAnchorRef.current?.contains(target) ||
        reportPanelRef.current?.contains(target)
      ) {
        return;
      }
      setReportMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setReportMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [reportMenuOpen]);

  // Issue #190: one in-flight list request at a time. Rapidly paging (especially bouncing off the
  // last page) used to stack overlapping requests with no cancellation; on a constrained DB that
  // could saturate it and leave the whole app stuck on "Cargando…". Every new load aborts the
  // previous one.
  const loadAbortRef = useRef<AbortController | null>(null);

  const loadInvoices = useCallback(
    async (
      from: string,
      to: string,
      status: string,
      q: string,
      page: number,
      size: number,
      silent = false,
    ) => {
      // A silent (live SIFEN status) refresh never competes with a user-triggered load: if one is
      // in flight it just skips this tick, and it never shows the spinner or clears errors.
      if (silent) {
        if (loadAbortRef.current) return;
        if (invoiceHistoryRangeErrorKey(from, to)) return;
      }
      if (!silent) setLoadError(null);
      setDateRangeError(null);
      const rangeErr = invoiceHistoryRangeErrorKey(from, to);
      if (rangeErr) {
        // `rangeErr` is camelCase (e.g. "tooOld"); only upper-case the first letter so
        // the i18n key keeps its casing (rangeErrorTooOld). `capitalize` is for SNAKE_CASE.
        setDateRangeError(
          t(
            `femme.billing.history.rangeError${rangeErr.charAt(0).toUpperCase()}${rangeErr.slice(1)}`,
          ),
        );
        loadAbortRef.current?.abort();
        loadAbortRef.current = null;
        setInvoicePage(null);
        return;
      }
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      if (!silent) setLoading(true);
      try {
        const data = await listInvoicesPaged(
          {
            from: localDateYmdToIsoStart(from),
            to: localDateYmdToIsoEnd(to),
            status: status || undefined,
            q: q || undefined,
            page,
            size,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setInvoicePage(data);
        // Stranded past the last page (row count shrank, or a stale page number): snap back to the
        // last real page instead of showing a dead, control-less empty view.
        if (data.totalPages > 0 && page > data.totalPages - 1) {
          setPageNum(data.totalPages - 1);
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        if (silent) return;
        setLoadError(translateApiError(err, t, "femme.billing.history.loadError"));
      } finally {
        if (loadAbortRef.current === controller) {
          setLoading(false);
          loadAbortRef.current = null;
        }
      }
    },
    [t],
  );

  useEffect(() => () => loadAbortRef.current?.abort(), []);

  useEffect(() => {
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => {
      void loadInvoices(filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize);
    }, 350);
    return () => {
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    };
  }, [filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize, loadInvoices]);

  // Every click on the History tab bumps refreshTrigger (see BillingPage), so the list is always
  // fresh when the tab is opened, even if the filters/paging haven't changed since the last visit.
  // Skips the initial mount: the effect above already fetches once with the default filters.
  const isFirstRefreshRef = useRef(true);
  useEffect(() => {
    if (isFirstRefreshRef.current) {
      isFirstRefreshRef.current = false;
      return;
    }
    void loadInvoices(filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  function handleClear() {
    const d = getDefaultInvoiceHistoryDateRange();
    setFilterFrom(d.from);
    setFilterTo(d.to);
    setFilterStatus("");
    setListTextQuery("");
    setDateRangeError(null);
    setPageNum(0);
  }

  function handleFilterChange(cb: () => void) {
    cb();
    setPageNum(0);
  }

  const invoices = invoicePage?.content ?? [];
  // SIFEN statuses change in the backend with no user action (queue consumer, consulta-lote
  // polling) — keep re-reading this page while any visible row can still change.
  useSifenStatusLiveRefresh(
    isActive && invoices.some((inv) => isSifenStatusInFlight(inv.sifenSubmissionStatus)),
    () => void loadInvoices(filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize, true),
  );
  const totalElements = invoicePage?.totalElements ?? 0;
  const totalPages = invoicePage?.totalPages ?? 0;
  const showingFrom = totalElements === 0 ? 0 : pageNum * pageSize + 1;
  const showingTo = Math.min((pageNum + 1) * pageSize, totalElements);

  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div data-tour="billing-search" className="flex flex-wrap items-center gap-2">
        <HistorySearch
          id="invoice-history-text-filter"
          value={listTextQuery}
          onSubmit={(v) => handleFilterChange(() => setListTextQuery(v))}
          placeholder={t("femme.billing.history.searchPlaceholder")}
          label={t("femme.listFilter.label")}
          buttonLabel={t("femme.billing.history.search")}
        />
        <Button
          type="button"
          variant="outline"
          aria-expanded={filtersOpen}
          data-testid="invoice-history-filters-toggle"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          {t("femme.billing.history.filters")}
        </Button>
        <div ref={reportAnchorRef} className="relative">
          <Button
            type="button"
            variant="outline"
            data-testid="invoice-history-report-button"
            aria-haspopup="menu"
            aria-expanded={reportMenuOpen}
            aria-label={t("femme.billing.history.moreActions")}
            disabled={reportDownloading !== null}
            onClick={() => setReportMenuOpen((o) => !o)}
          >
            {reportDownloading !== null ? t("femme.billing.history.report.downloading") : "⋯"}
          </Button>
          <FloatingDropdown anchorRef={reportAnchorRef} open={reportMenuOpen} ref={reportPanelRef}>
            <ul
              role="menu"
              data-testid="invoice-history-report-menu"
              className="min-w-44 rounded-md border border-line bg-surface py-1 shadow-lg"
            >
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-testid="invoice-history-refresh"
                  className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-primary-lt"
                  disabled={loading}
                  onClick={() => {
                    setReportMenuOpen(false);
                    void loadInvoices(filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize);
                  }}
                >
                  {t("femme.billing.history.refresh")}
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-testid="invoice-history-report-xlsx"
                  className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-primary-lt"
                  onClick={() => void handleDownloadReport("xlsx")}
                >
                  {t("femme.billing.history.report.excel")}
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-testid="invoice-history-report-pdf"
                  className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-primary-lt"
                  onClick={() => void handleDownloadReport("pdf")}
                >
                  {t("femme.billing.history.report.pdf")}
                </button>
              </li>
            </ul>
          </FloatingDropdown>
        </div>
      </div>

      {filtersOpen && (
        <DateFilters
          idPrefix="invoice-history"
          from={filterFrom}
          to={filterTo}
          onFrom={(v) => handleFilterChange(() => setFilterFrom(v))}
          onTo={(v) => handleFilterChange(() => setFilterTo(v))}
          onClear={handleClear}
        />
      )}

      <Chips
        label={t("femme.billing.history.filterStatus")}
        testIdPrefix="invoice-history-status"
        value={filterStatus}
        onChange={(v) => handleFilterChange(() => setFilterStatus(v))}
        options={[
          { value: "", label: t("femme.billing.history.filterStatusAll") },
          { value: "ISSUED", label: t("femme.billing.state.issued") },
          // Issued invoices SIFEN rejected — the ones that need the user to act.
          { value: "ATTENTION", label: t("femme.billing.state.attention") },
          { value: "VOIDED", label: t("femme.billing.history.statusVoided") },
        ]}
      />

      {reportError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {reportError}
        </Alert>
      )}
      {dateRangeError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {dateRangeError}
        </Alert>
      )}
      {loadError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {loadError}
        </Alert>
      )}

      <div data-tour="billing-invoice-list">
        {loading ? (
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <Text>{t("femme.billing.history.loading")}</Text>
          </div>
        ) : dateRangeError ? null : invoices.length === 0 ? (
          <div className="flex flex-col gap-3">
            <Text variant="muted">{t("femme.billing.history.empty")}</Text>
            {pageNum > 0 && (
              // Safety net: never strand the user on an empty page with no way back (issue #190).
              <Pagination
                page={pageNum + 1}
                pageCount={Math.max(totalPages, pageNum + 1)}
                onPageChange={(p) => setPageNum(p - 1)}
                previousLabel={t("femme.pagination.previous")}
                nextLabel={t("femme.pagination.next")}
              />
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <ul className="divide-y divide-line" data-testid="invoice-history-list">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    data-testid={`invoice-history-row-${inv.id}`}
                    aria-label={t("femme.billing.history.openDetail", { invoiceNumber: inv.invoiceNumberFormatted })}
                    onClick={() => setSelectedInvoiceId(inv.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedInvoiceId(inv.id);
                      }
                    }}
                    className="grid min-h-14 w-full cursor-pointer grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-primary-lt"
                  >
                    <span
                      data-testid="invoice-row-client"
                      className="min-w-0 truncate font-semibold text-ink"
                    >
                      {inv.clientDisplayName || t("femme.billing.invoice.noName")}
                    </span>
                    <span
                      data-testid="invoice-row-total"
                      className="text-right font-bold tabular-nums text-ink"
                    >
                      {formatAmountDecimal(inv.total)}
                    </span>
                    <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
                      <InvoiceStatePill invoice={inv} />
                      <span data-testid="invoice-row-number" className="font-mono text-xs">
                        {inv.invoiceNumberFormatted}
                      </span>
                      <span data-testid="invoice-row-date">
                        {formatParaguayDateTime(inv.issuedAt, dateLocale)}
                      </span>
                      <span data-testid="invoice-row-method">
                        {paymentMethodsLabel(inv.paymentMethodsSummary, t)}
                      </span>
                      {inv.sifenSubmittedAt && (
                        <span data-testid="invoice-row-sifen-sent">
                          {t("femme.billing.history.colSifenSentAt")}:{" "}
                          {formatParaguayDateTime(inv.sifenSubmittedAt, dateLocale)}
                        </span>
                      )}
                    </span>
                    {deriveInvoiceState(inv) === "attention" && inv.status === "ISSUED" && (
                      <span className="col-span-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid={`invoice-row-correct-resend-${inv.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCorrectionInvoiceId(inv.id);
                          }}
                        >
                          {t("femme.billing.history.detail.sifen.correctResendButton")}
                        </Button>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <ListFooter
              pageSize={pageSize}
              setPageSize={setPageSize}
              setPageNum={setPageNum}
              pageNum={pageNum}
              totalPages={totalPages}
              showingFrom={showingFrom}
              showingTo={showingTo}
              totalElements={totalElements}
            />
          </div>
        )}
      </div>

      {selectedInvoiceId !== null && (
        <InvoiceDetailModal
          invoiceId={selectedInvoiceId}
          onClose={() => setSelectedInvoiceId(null)}
          onVoided={() => {
            setSelectedInvoiceId(null);
            void loadInvoices(filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize);
          }}
          onCorrected={() => {
            setSelectedInvoiceId(null);
            void loadInvoices(filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize);
          }}
        />
      )}

      {correctionInvoiceId !== null && (
        <InvoiceCorrectionForm
          invoiceId={correctionInvoiceId}
          onClose={() => setCorrectionInvoiceId(null)}
          onResent={() => {
            setCorrectionInvoiceId(null);
            void loadInvoices(filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize);
          }}
        />
      )}
    </div>
  );
}

function CashListView({ refreshTrigger }: { refreshTrigger: number }) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [sessionPage, setSessionPage] = useState<PageResponse<CashSessionListItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dateRangeError, setDateRangeError] = useState<string | null>(null);
  const [filterFrom, setFilterFrom] = useState(() => getDefaultInvoiceHistoryDateRange().from);
  const [filterTo, setFilterTo] = useState(() => getDefaultInvoiceHistoryDateRange().to);
  const [filterStatus, setFilterStatus] = useState<"" | "OPEN" | "CLOSED">("");
  const [listTextQuery, setListTextQuery] = useState("");
  const [pageNum, setPageNum] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  const loadSessions = useCallback(
    async (
      from: string,
      to: string,
      status: "" | "OPEN" | "CLOSED",
      q: string,
      page: number,
      size: number,
    ) => {
      setLoadError(null);
      setDateRangeError(null);
      const rangeErr = invoiceHistoryRangeErrorKey(from, to);
      if (rangeErr) {
        setDateRangeError(
          t(
            `femme.billing.cashHistory.rangeError${rangeErr.charAt(0).toUpperCase()}${rangeErr.slice(1)}`,
          ),
        );
        loadAbortRef.current?.abort();
        loadAbortRef.current = null;
        setSessionPage(null);
        return;
      }
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      setLoading(true);
      try {
        const data = await listCashSessionsPaged(
          {
            from: localDateYmdToIsoStart(from),
            to: localDateYmdToIsoEnd(to),
            status: status || undefined,
            q: q || undefined,
            page,
            size,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setSessionPage(data);
        if (data.totalPages > 0 && page > data.totalPages - 1) {
          setPageNum(data.totalPages - 1);
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setLoadError(translateApiError(err, t, "femme.billing.cashHistory.loadError"));
      } finally {
        if (loadAbortRef.current === controller) {
          setLoading(false);
          loadAbortRef.current = null;
        }
      }
    },
    [t],
  );

  useEffect(() => () => loadAbortRef.current?.abort(), []);

  useEffect(() => {
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => {
      void loadSessions(filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize);
    }, 350);
    return () => {
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    };
  }, [filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize, loadSessions]);

  const isFirstRefreshRef = useRef(true);
  useEffect(() => {
    if (isFirstRefreshRef.current) {
      isFirstRefreshRef.current = false;
      return;
    }
    void loadSessions(filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  function handleClear() {
    const d = getDefaultInvoiceHistoryDateRange();
    setFilterFrom(d.from);
    setFilterTo(d.to);
    setFilterStatus("");
    setListTextQuery("");
    setDateRangeError(null);
    setPageNum(0);
  }

  function handleFilterChange<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPageNum(0);
    };
  }

  const sessions = sessionPage?.content ?? [];
  const totalElements = sessionPage?.totalElements ?? 0;
  const totalPages = sessionPage?.totalPages ?? 0;
  const showingFrom = totalElements === 0 ? 0 : pageNum * pageSize + 1;
  const showingTo = Math.min((pageNum + 1) * pageSize, totalElements);

  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <HistorySearch
          id="cash-history-text-filter"
          value={listTextQuery}
          onSubmit={(v) => handleFilterChange(setListTextQuery)(v)}
          placeholder={t("femme.billing.history.searchPlaceholderCash")}
          label={t("femme.listFilter.label")}
          buttonLabel={t("femme.billing.history.search")}
        />
        <Button
          type="button"
          variant="outline"
          aria-expanded={filtersOpen}
          data-testid="cash-history-filters-toggle"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          {t("femme.billing.history.filters")}
        </Button>
      </div>

      {filtersOpen && (
        <DateFilters
          idPrefix="cash-history"
          from={filterFrom}
          to={filterTo}
          onFrom={(v) => handleFilterChange(setFilterFrom)(v)}
          onTo={(v) => handleFilterChange(setFilterTo)(v)}
          onClear={handleClear}
        />
      )}

      <Chips<"" | "OPEN" | "CLOSED">
        label={t("femme.billing.history.filterStatus")}
        testIdPrefix="cash-history-status"
        value={filterStatus}
        onChange={(v) => handleFilterChange(setFilterStatus)(v)}
        options={[
          { value: "", label: t("femme.billing.history.filterStatusAll") },
          { value: "OPEN", label: t("femme.billing.cashHistory.filterStatusOpen") },
          { value: "CLOSED", label: t("femme.billing.cashHistory.filterStatusClosed") },
        ]}
      />

      {dateRangeError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {dateRangeError}
        </Alert>
      )}
      {loadError && (
        <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
          {loadError}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <Text>{t("femme.billing.cashHistory.loading")}</Text>
        </div>
      ) : loadError || dateRangeError ? null : sessions.length === 0 ? (
        <Text variant="muted">{t("femme.billing.cashHistory.emptyState")}</Text>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <ul className="divide-y divide-line" data-testid="cash-history-list">
            {sessions.map((s) => {
              const diff = s.cashDifference !== null ? parseFloat(s.cashDifference) : null;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    data-testid={`cash-history-row-${s.id}`}
                    onClick={() => setSelectedSessionId(s.id)}
                    className="grid min-h-14 w-full grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-primary-lt"
                  >
                    <span className="min-w-0 font-semibold text-ink">
                      {formatParaguayDateTime(s.openedAt, dateLocale)}
                      {" → "}
                      {s.closedAt ? (
                        formatParaguayDateTime(s.closedAt, dateLocale)
                      ) : (
                        <span className="rounded-full bg-success-lt px-2.5 py-0.5 text-xs font-semibold text-success">
                          {t("femme.billing.cashHistory.statusOpenBadge")}
                        </span>
                      )}
                    </span>
                    <span className="text-right font-bold tabular-nums text-ink">
                      {formatAmountDecimal(s.expectedCashAmount)}
                    </span>
                    <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
                      <span>{s.openedByEmail}</span>
                      {s.closedByEmail && <span>{s.closedByEmail}</span>}
                      {diff !== null && (
                        <span className={diff < 0 ? "font-semibold text-danger" : "font-semibold text-success"}>
                          {t("femme.billing.cashHistory.colDifference")}: {formatAmountDecimal(s.cashDifference as string)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <ListFooter
            testId="cash-history-pagination"
            pageSize={pageSize}
            setPageSize={setPageSize}
            setPageNum={setPageNum}
            pageNum={pageNum}
            totalPages={totalPages}
            showingFrom={showingFrom}
            showingTo={showingTo}
            totalElements={totalElements}
          />
        </div>
      )}

      {selectedSessionId !== null && (
        <CashSessionDetailModal sessionId={selectedSessionId} onClose={() => setSelectedSessionId(null)} />
      )}
    </div>
  );
}

/** History: invoices and cash sessions as two views of one screen. */
export function BillingHistory({
  view,
  onViewChange,
  onBack,
  invoicesRefresh,
  cashRefresh,
  isActive,
}: {
  view: HistoryView;
  onViewChange: (v: HistoryView) => void;
  onBack: () => void;
  invoicesRefresh: number;
  cashRefresh: number;
  isActive: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" className="text-primary" data-testid="billing-history-back" onClick={onBack}>
          ‹ {t("femme.billing.invoice.back")}
        </Button>
        <Heading as="h1" className="text-xl">
          {t("femme.billing.history.screenTitle")}
        </Heading>
      </div>
      <div
        role="group"
        aria-label={t("femme.billing.history.viewLabel")}
        className="inline-flex self-start rounded-full border border-line bg-surface p-1"
      >
        {(["invoices", "cash"] as const).map((v) => (
          <button
            key={v}
            type="button"
            data-testid={`billing-history-view-${v}`}
            aria-pressed={view === v}
            onClick={() => onViewChange(v)}
            className="min-h-11 rounded-full px-5 text-sm font-semibold text-ink-3 aria-pressed:bg-primary aria-pressed:text-primary-fg"
          >
            {t(`femme.billing.history.view.${v}`)}
          </button>
        ))}
      </div>
      {view === "invoices" ? (
        <InvoiceListView refreshTrigger={invoicesRefresh} isActive={isActive} />
      ) : (
        <CashListView refreshTrigger={cashRefresh} />
      )}
    </div>
  );
}
