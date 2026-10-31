import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Input,
  Label,
  Modal,
  PageSizeSelect,
  Pagination,
  Select,
  Spinner,
  Text,
  Toast,
} from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import {
  getServiceRecord,
  listServiceRecordsPaged,
  type PagedServiceRecordsResponse,
} from "../api/serviceRecords";
import { ServiceRecordEditor } from "../components/ServiceRecordEditor";
import { ServiceRecordDetailModal } from "../components/ServiceRecordDetailModal";
import { SearchInput } from "../components/ui/SearchInput";
import { useDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal } from "../lib/formatMoney";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";
import { billServiceRecord } from "../lib/serviceRecordBilling";

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

type Chip = "open" | "today" | "all";
type Notice = "created" | "updated" | "voided";

const fmtYmd = (dt: Date) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

/** Local calendar dates: 6 months ago through today. */
function getDefaultHistoryDateRange(): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
  return { from: fmtYmd(sixMonthsAgo), to: fmtYmd(today) };
}

function presetFilters(chip: Chip): { from: string; to: string; status: string } {
  const def = getDefaultHistoryDateRange();
  if (chip === "today") return { from: def.to, to: def.to, status: "" };
  if (chip === "open") return { ...def, status: "OPEN" };
  return { ...def, status: "" };
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

function getInitials(name: string): string {
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

export default function ServiceRecordsPage() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as NavState;

  const [chip, setChip] = useState<Chip | null>(() =>
    navState?.activeTab === "history" ? "all" : "open",
  );
  const [filters, setFilters] = useState(() =>
    presetFilters(navState?.activeTab === "history" ? "all" : "open"),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listTextQuery, setListTextQuery] = useState("");
  const [pageNum, setPageNum] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const [page, setPage] = useState<PagedServiceRecordsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(Boolean(navState?.selectedClient));
  const [pendingClient, setPendingClient] = useState<InitialClientForRecord | null>(
    navState?.selectedClient ?? null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    if (navState && (navState.activeTab || navState.selectedClient)) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(
    async (f: { from: string; to: string; status: string }, q: string, pageN: number, size: number) => {
      setLoadError(null);
      setRangeError(null);
      const errKey = historyRangeErrorKey(f.from, f.to);
      if (errKey) {
        setRangeError(
          t(`femme.serviceRecords.history.rangeError${errKey.charAt(0).toUpperCase()}${errKey.slice(1)}`),
        );
        setPage(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const data = await listServiceRecordsPaged({
          from: localDateYmdToIsoStart(f.from),
          to: localDateYmdToIsoEnd(f.to),
          status: f.status || undefined,
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
      void load(filters, listTextQuery, pageNum, pageSize);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, listTextQuery, pageNum, pageSize, reloadTick, load]);

  const reload = () => setReloadTick((n) => n + 1);

  function selectChip(next: Chip) {
    setChip(next);
    setFilters(presetFilters(next));
    setPageNum(0);
  }

  function changeFilter(patch: Partial<{ from: string; to: string; status: string }>) {
    setChip(null);
    setFilters((prev) => ({ ...prev, ...patch }));
    setPageNum(0);
  }

  async function handlePay(id: number) {
    setPayError(null);
    try {
      const record = await getServiceRecord(id);
      await billServiceRecord(navigate, record);
    } catch (err) {
      setPayError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    }
  }

  function closeNew() {
    setNewOpen(false);
    setPendingClient(null);
  }

  const records = page?.content ?? [];
  const totalElements = page?.totalElements ?? 0;
  const totalPages = page?.totalPages ?? 0;
  const showingFrom = totalElements === 0 ? 0 : pageNum * pageSize + 1;
  const showingTo = Math.min((pageNum + 1) * pageSize, totalElements);
  const hasFilters = listTextQuery.trim().length > 0 || chip !== "all";
  const CHIPS: { key: Chip; label: string }[] = [
    { key: "open", label: t("femme.serviceRecords.chips.open") },
    { key: "today", label: t("femme.serviceRecords.chips.today") },
    { key: "all", label: t("femme.serviceRecords.chips.all") },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-extrabold text-ink">
          {t("femme.serviceRecords.pageTitle")}
        </h1>
        <Button
          type="button"
          className="min-h-11"
          data-testid="service-records-new"
          onClick={() => setNewOpen(true)}
        >
          {t("femme.serviceRecords.newRecord")}
        </Button>
      </div>

      {payError ? (
        <Alert variant="destructive" title={t("femme.serviceRecords.errorTitle")} className="mb-4">
          {payError}
        </Alert>
      ) : null}

      <div className="mb-3">
        <SearchInput
          id="service-record-history-text-filter"
          value={listTextQuery}
          onChange={(v) => {
            setListTextQuery(v);
            setPageNum(0);
          }}
          placeholder={t("femme.serviceRecords.searchPlaceholder")}
          resultCount={totalElements}
          totalCount={totalElements}
        />
      </div>

      <div role="group" aria-label={t("femme.serviceRecords.chips.group")} className="mb-4 flex flex-wrap gap-2">
        {CHIPS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={chip === key}
            data-testid={`service-records-chip-${key}`}
            onClick={() => selectChip(key)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
              chip === key
                ? "border-primary bg-primary-lt text-primary"
                : "border-line bg-surface text-ink hover:bg-bg"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 overflow-hidden rounded-card border border-line bg-surface">
        <button
          type="button"
          data-testid="service-records-filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="service-records-filters"
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between px-4 text-left font-semibold text-ink"
        >
          {t("femme.serviceRecords.filters")}
          <span aria-hidden="true" className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`}>
            ⌄
          </span>
        </button>
        {filtersOpen ? (
          <div id="service-records-filters" className="px-4 pb-3">
            <form
              onSubmit={(e) => e.preventDefault()}
              noValidate
              className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            >
              <div>
                <Label htmlFor="service-record-filter-from">
                  {t("femme.serviceRecords.history.filterFrom")}
                </Label>
                <Input
                  id="service-record-filter-from"
                  type="date"
                  value={filters.from}
                  onChange={(e) => changeFilter({ from: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="service-record-filter-to">
                  {t("femme.serviceRecords.history.filterTo")}
                </Label>
                <Input
                  id="service-record-filter-to"
                  type="date"
                  value={filters.to}
                  onChange={(e) => changeFilter({ to: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="service-record-filter-status">
                  {t("femme.serviceRecords.history.filterStatus")}
                </Label>
                <Select
                  id="service-record-filter-status"
                  value={filters.status}
                  onChange={(e) => changeFilter({ status: e.target.value })}
                >
                  <option value="">{t("femme.serviceRecords.history.filterStatusAll")}</option>
                  <option value="OPEN">{t("femme.serviceRecords.statusOpen")}</option>
                  <option value="CLOSED">{t("femme.serviceRecords.statusClosed")}</option>
                  <option value="VOIDED">{t("femme.serviceRecords.statusVoided")}</option>
                </Select>
              </div>
            </form>
            <Text variant="muted" className="mt-2 text-sm">
              {t("femme.serviceRecords.filtersHint")}
            </Text>
          </div>
        ) : null}
      </div>

      {rangeError ? (
        <Alert variant="destructive" title={t("femme.serviceRecords.errorTitle")} className="mb-4">
          {rangeError}
        </Alert>
      ) : null}
      {loadError ? (
        <Alert variant="destructive" title={t("femme.serviceRecords.errorTitle")} className="mb-4">
          {loadError}
        </Alert>
      ) : null}

      <div
        data-testid="service-records-list"
        className="overflow-hidden rounded-card border border-line bg-surface"
      >
        {loading && !page ? (
          <div className="flex items-center gap-2 px-4 py-6">
            <Spinner size="sm" />
            <Text>{t("femme.serviceRecords.history.loading")}</Text>
          </div>
        ) : rangeError ? null : records.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center text-sm text-ink-3">
            <span data-testid="service-records-empty">
              {hasFilters
                ? chip === "open" && listTextQuery.trim() === ""
                  ? t("femme.serviceRecords.emptyOpen")
                  : t("femme.serviceRecords.history.empty")
                : t("femme.serviceRecords.emptyAll")}
            </span>
            <Button type="button" className="min-h-11" onClick={() => setNewOpen(true)}>
              {t("femme.serviceRecords.newRecord")}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col px-1 sm:px-2">
            {records.map((r) => (
              <li
                key={r.id}
                role="button"
                tabIndex={0}
                aria-label={t("femme.serviceRecords.history.openDetail", { client: r.clientFullName })}
                data-testid={`service-record-row-${r.id}`}
                data-status={r.status}
                onClick={() => setSelectedId(r.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(r.id);
                  }
                }}
                className="flex min-h-14 cursor-pointer items-center gap-3 border-t border-line px-3 py-2.5 first:border-t-0 hover:bg-bg"
              >
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-lt font-heading font-extrabold text-primary"
                >
                  {getInitials(r.clientFullName)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="break-words font-semibold text-ink">{r.clientFullName}</div>
                  <div className="break-words text-sm text-ink-3">
                    {[formatParaguayDateTime(r.createdAt, dateLocale), r.servicesSummary, r.professionalsSummary]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-heading font-extrabold text-ink">
                    {formatAmountDecimal(r.totalAmount)}
                  </span>
                  {r.status === "OPEN" ? (
                    <button
                      type="button"
                      data-testid={`service-record-pay-${r.id}`}
                      aria-label={t("femme.serviceRecords.payFor", { client: r.clientFullName })}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handlePay(r.id);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="min-h-11 rounded-xl bg-primary px-4 font-extrabold text-primary-fg"
                    >
                      {t("femme.serviceRecords.pay")}
                    </button>
                  ) : (
                    <span
                      data-testid="service-record-state"
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        r.status === "CLOSED"
                          ? "bg-success-lt text-success"
                          : "border border-line bg-bg text-ink-3"
                      }`}
                    >
                      {r.status === "CLOSED"
                        ? t("femme.serviceRecords.statusClosed")
                        : t("femme.serviceRecords.statusVoided")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          style={{ borderTop: "var(--border-default)" }}
        >
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
            pageCount={Math.max(1, totalPages)}
            onPageChange={(p) => setPageNum(p - 1)}
            previousLabel={t("femme.pagination.previous")}
            nextLabel={t("femme.pagination.next")}
          />
        </div>
      </div>

      <Modal
        open={newOpen}
        onClose={closeNew}
        title={t("femme.serviceRecords.newTitle")}
        className="max-w-3xl"
      >
        {newOpen ? (
          <ServiceRecordEditor
            initial={null}
            allowClientCreateNew
            initialClientOverride={pendingClient}
            onInitialClientOverrideConsumed={() => setPendingClient(null)}
            onSaved={() => {
              closeNew();
              reload();
              setNotice("created");
            }}
            onClose={closeNew}
          />
        ) : null}
      </Modal>

      {selectedId !== null && (
        <ServiceRecordDetailModal
          serviceRecordId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={(kind) => {
            reload();
            setNotice(kind === "voided" ? "voided" : "updated");
          }}
        />
      )}

      <Toast
        open={notice !== null}
        onOpenChange={(o) => {
          if (!o) setNotice(null);
        }}
        variant="success"
        duration={4000}
        data-testid="service-records-toast"
      >
        {notice === "created"
          ? t("femme.serviceRecords.createdSuccess")
          : notice === "voided"
            ? t("femme.serviceRecords.voidedSuccess")
            : t("femme.serviceRecords.updatedSuccess")}
      </Toast>
    </div>
  );
}
