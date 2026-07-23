import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert, Button, Heading, Input, Label, PageSizeSelect, Pagination, Select, Spinner, Text } from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import {
  listServiceRecordsPaged,
  type PagedServiceRecordsResponse,
} from "../api/serviceRecords";
import { ServiceRecordEditor } from "../components/ServiceRecordEditor";
import { ServiceRecordDetailModal } from "../components/ServiceRecordDetailModal";
import { ListSearchField } from "../components/ListSearchField";
import { StatusBadge } from "../components/StatusBadge";
import { useDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal } from "../lib/formatMoney";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";

type InitialClientForRecord = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  ruc: string | null;
};

type NavState = {
  activeTab?: "new" | "history";
  selectedClient?: InitialClientForRecord;
} | null;

/** Local calendar dates: 6 months ago through today. */
function getDefaultHistoryDateRange(): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
  const fmtYmd = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return { from: fmtYmd(sixMonthsAgo), to: fmtYmd(today) };
}

function isFromOlderThan6Months(fromYmd: string): boolean {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const fromDate = new Date(fy, fm - 1, fd);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  sixMonthsAgo.setHours(0, 0, 0, 0);
  return fromDate < sixMonthsAgo;
}

function localDateYmdToIsoStart(ymd: string): string {
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 0, 0, 0, 0).toISOString();
}

function localDateYmdToIsoEnd(ymd: string): string {
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return new Date(yy, mm - 1, dd, 23, 59, 59, 999).toISOString();
}

function historyRangeErrorKey(from: string, to: string): string | null {
  if (!from.trim() || !to.trim()) return "incomplete";
  if (from > to) return "invalidOrder";
  if (isFromOlderThan6Months(from)) return "tooOld";
  return null;
}

function ServiceRecordHistoryTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [page, setPage] = useState<PagedServiceRecordsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [filterFrom, setFilterFrom] = useState(() => getDefaultHistoryDateRange().from);
  const [filterTo, setFilterTo] = useState(() => getDefaultHistoryDateRange().to);
  const [filterStatus, setFilterStatus] = useState("");
  const [listTextQuery, setListTextQuery] = useState("");
  const [pageNum, setPageNum] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (from: string, to: string, status: string, q: string, pageN: number, size: number) => {
      setLoadError(null);
      setRangeError(null);
      const errKey = historyRangeErrorKey(from, to);
      if (errKey) {
        setRangeError(
          t(`femme.serviceRecords.history.rangeError${errKey.charAt(0).toUpperCase()}${errKey.slice(1)}`),
        );
        setPage(null);
        return;
      }
      setLoading(true);
      try {
        const data = await listServiceRecordsPaged({
          from: localDateYmdToIsoStart(from),
          to: localDateYmdToIsoEnd(to),
          status: status || undefined,
          q: q || undefined,
          page: pageN,
          size,
        });
        setPage(data);
      } catch (err) {
        setLoadError(translateApiError(err, t, "femme.serviceRecords.history.loadError"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void load(filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize, load]);

  function handleFilterChange(cb: () => void) {
    cb();
    setPageNum(0);
  }

  function handleClear() {
    const d = getDefaultHistoryDateRange();
    setFilterFrom(d.from);
    setFilterTo(d.to);
    setFilterStatus("");
    setListTextQuery("");
    setRangeError(null);
    setPageNum(0);
  }

  const records = page?.content ?? [];
  const totalElements = page?.totalElements ?? 0;
  const totalPages = page?.totalPages ?? 0;
  const showingFrom = totalElements === 0 ? 0 : pageNum * pageSize + 1;
  const showingTo = Math.min((pageNum + 1) * pageSize, totalElements);

  return (
    <div className="flex flex-col gap-4">
      <Heading as="h2" className="text-lg">
        {t("femme.serviceRecords.history.title")}
      </Heading>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <ListSearchField
          id="service-record-history-text-filter"
          value={listTextQuery}
          onChange={(v) => handleFilterChange(() => setListTextQuery(v))}
          label={t("femme.listFilter.label")}
          placeholder={t("femme.listFilter.placeholder")}
          className="w-full min-w-0 sm:max-w-[min(100%,280px)]"
        />
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-wrap gap-3 items-end" noValidate>
          <div className="flex flex-col gap-1 min-w-[140px]">
            <Label htmlFor="service-record-filter-from">{t("femme.serviceRecords.history.filterFrom")}</Label>
            <Input
              id="service-record-filter-from"
              type="date"
              value={filterFrom}
              onChange={(e) => handleFilterChange(() => setFilterFrom(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1 min-w-[140px]">
            <Label htmlFor="service-record-filter-to">{t("femme.serviceRecords.history.filterTo")}</Label>
            <Input
              id="service-record-filter-to"
              type="date"
              value={filterTo}
              onChange={(e) => handleFilterChange(() => setFilterTo(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1 min-w-[140px]">
            <Label htmlFor="service-record-filter-status">{t("femme.serviceRecords.history.filterStatus")}</Label>
            <Select
              id="service-record-filter-status"
              value={filterStatus}
              onChange={(e) => handleFilterChange(() => setFilterStatus(e.target.value))}
            >
              <option value="">{t("femme.serviceRecords.history.filterStatusAll")}</option>
              <option value="OPEN">{t("femme.status.OPEN")}</option>
              <option value="CLOSED">{t("femme.status.CLOSED")}</option>
              <option value="VOIDED">{t("femme.status.VOIDED")}</option>
            </Select>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={handleClear}>
            {t("femme.serviceRecords.history.clearFilters")}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void load(filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize)}
            disabled={loading}
          >
            {t("femme.serviceRecords.history.refresh")}
          </Button>
        </form>
      </div>

      {rangeError && (
        <Alert variant="destructive" title={t("femme.serviceRecords.errorTitle")}>
          {rangeError}
        </Alert>
      )}
      {loadError && (
        <Alert variant="destructive" title={t("femme.serviceRecords.errorTitle")}>
          {loadError}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <Text>{t("femme.serviceRecords.history.loading")}</Text>
        </div>
      ) : rangeError ? null : records.length === 0 ? (
        <Text variant="muted">{t("femme.serviceRecords.history.empty")}</Text>
      ) : (
        <div
          style={{
            background: "var(--color-white)",
            borderRadius: "var(--radius-xl)",
            border: "var(--border-default)",
            overflow: "hidden",
          }}
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "20%" }} />
                <col style={{ width: "34%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "12%" }} />
              </colgroup>
              <thead>
                <tr>
                  {["colDate", "colClient", "colTotal", "colStatus", ""].map((key, i) => (
                    <th
                      key={i}
                      style={{
                        padding: "9px 12px",
                        fontSize: 10,
                        fontWeight: 500,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--color-ink-3)",
                        background: "var(--color-stone)",
                        textAlign: i === 2 ? "right" : i === 3 ? "center" : "left",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {key ? t(`femme.serviceRecords.history.${key}`) : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} style={{ borderTop: "var(--border-default)" }}>
                    <td style={{ padding: "10px 12px" }}>{formatParaguayDateTime(r.createdAt, dateLocale)}</td>
                    <td style={{ padding: "10px 12px" }}>{r.clientFullName}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      {formatAmountDecimal(r.totalAmount)}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedId(r.id)}>
                        {t("femme.serviceRecords.history.viewDetail")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border-default)]">
            <PageSizeSelect
              value={pageSize}
              onChange={(s) => {
                setPageSize(s);
                setPageNum(0);
              }}
              label={t("femme.pagination.rowsPerPage")}
            />
            <Text variant="small" className="text-[var(--color-ink-3)]">
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
        </div>
      )}

      {selectedId !== null && (
        <ServiceRecordDetailModal
          serviceRecordId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => void load(filterFrom, filterTo, filterStatus, listTextQuery, pageNum, pageSize)}
        />
      )}
    </div>
  );
}

export default function ServiceRecordsPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as NavState;

  const [activeTab, setActiveTab] = useState<"new" | "history">(navState?.activeTab ?? "new");
  const [pendingClient, setPendingClient] = useState<InitialClientForRecord | null>(
    navState?.selectedClient ?? null,
  );

  useEffect(() => {
    if (navState && (navState.activeTab || navState.selectedClient)) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          {t("femme.serviceRecords.pageTitle")}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
          {t("femme.serviceRecords.pageSubtitle")}
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 14 }} role="tablist" aria-label={t("femme.serviceRecords.pageTitle")}>
        {(["new", "history"] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={activeTab === tabKey}
            style={activeTab === tabKey ? tabActive : tabBase}
            onClick={() => setActiveTab(tabKey)}
          >
            {t(`femme.serviceRecords.tabs.${tabKey}`)}
          </button>
        ))}
      </div>

      <div hidden={activeTab !== "new"}>
        <ServiceRecordEditor
          initial={null}
          allowClientCreateNew
          initialClientOverride={pendingClient}
          onInitialClientOverrideConsumed={() => setPendingClient(null)}
        />
      </div>

      <div hidden={activeTab !== "history"}>
        <ServiceRecordHistoryTab />
      </div>
    </div>
  );
}
