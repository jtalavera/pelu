import { TodayEmptyState } from "./TodayEmptyState";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Card, Toast } from "@design-system";
import {
  getServiceRecord,
  listServiceRecordsPaged,
  type ServiceRecordListItem,
} from "../api/serviceRecords";
import { translateApiError } from "../api/parseApiErrorMessage";
import { getDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal } from "../lib/formatMoney";
import { formatParaguayTime } from "../lib/paraguayDateTime";
import { billServiceRecord } from "../lib/serviceRecordBilling";
import { initialsOf } from "../lib/initials";
import { matchesListQuery } from "../util/matchesListQuery";
import { InvoiceDetailModal } from "./InvoiceDetailModal";
import { ListSearchField } from "./ListSearchField";
import { SectionTitle } from "./SectionTitle";
import { ServiceRecordDetailModal } from "./ServiceRecordDetailModal";

const POLL_MS = 30_000;
/** Open fichas of the day are all shown (the server caps one page at 200). */
const OPEN_MAX = 200;
/** Paid / voided fichas come 12 at a time; «Más» asks the server for the next ones. */
const CLOSED_PAGE = 12;
/** While searching, up to this many paid / voided fichas of the day are searched. */
const SEARCH_MAX = 200;
/** «Abiertas de días anteriores» looks back this far (the API never returns more than a year). */
const OLDER_DAYS = 360;
const SEARCH_DEBOUNCE_MS = 300;

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

/** Local calendar day bounds as ISO instants (the API parses `Instant`, not dates). */
function todayRangeIso(): { from: string; to: string } {
  const start = startOfToday();
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** From a year-ish ago up to the end of yesterday: the days before today. */
function olderRangeIso(): { from: string; to: string } {
  const start = startOfToday();
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate() - OLDER_DAYS);
  return { from: from.toISOString(), to: new Date(start.getTime() - 1).toISOString() };
}

/**
 * "Fichas de hoy" as a compact list of rows, shared by the admin's Inicio and the professional's
 * Inicio (regular and shared-device sessions).
 *
 * - Admin: every OPEN ficha of the day is always shown (amount and "Cobrar"); the paid / voided
 *   ones sit folded in «Cobradas y anuladas (N)», 12 at a time with «Más (n)». A search field
 *   filters both by client or service. «Ver historial» carries a dot with how many fichas of
 *   previous days are still open; with it, the link opens the Fichas list on «Abiertas».
 * - Professional: the server only returns the open fichas of today and no amounts, so the cards
 *   show who is in the salon and the services; tapping opens the ficha to add, change or remove
 *   services and quantities (never prices or tips).
 */
export function TodayServiceRecords({
  professionalMode = false,
  refreshKey = 0,
  onNewRecord,
}: {
  professionalMode?: boolean;
  /** Opens "Nueva ficha" (adds the "+ Nueva ficha" row and the empty-state button); omit to hide them. */
  onNewRecord?: () => void;
  /** Bumped by the host when something outside changed (a ficha was created / assigned). */
  refreshKey?: number;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = getDateLocale(i18n);

  const [openRecords, setOpenRecords] = useState<ServiceRecordListItem[]>([]);
  const [closedRecords, setClosedRecords] = useState<ServiceRecordListItem[]>([]);
  const [closedTotal, setClosedTotal] = useState(0);
  const [olderOpen, setOlderOpen] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notice, setNotice] = useState<"updated" | "voided" | null>(null);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  // `load` is stable (the poll and the search call it); it reads these through refs.
  const queryRef = useRef("");
  const closedCountRef = useRef(0);
  closedCountRef.current = closedRecords.length;

  const load = useCallback(() => {
    const { from, to } = todayRangeIso();
    if (professionalMode) {
      // The server only returns the open fichas of today for a professional.
      listServiceRecordsPaged({ from, to, size: OPEN_MAX })
        .then((page) => setOpenRecords(Array.isArray(page?.content) ? page.content : []))
        .catch(() => setOpenRecords([]))
        .finally(() => setLoaded(true));
      return;
    }
    const searching = queryRef.current.trim() !== "";
    // Keep what «Más» already loaded (a reload asks for that many in one go); a search looks at all.
    const closedSize = searching
      ? SEARCH_MAX
      : Math.min(SEARCH_MAX, Math.max(CLOSED_PAGE, closedCountRef.current));
    const older = olderRangeIso();
    const open = listServiceRecordsPaged({ from, to, status: "OPEN", size: OPEN_MAX }).catch(
      () => null,
    );
    const closed = listServiceRecordsPaged({
      from,
      to,
      status: "NOT_OPEN",
      size: closedSize,
    }).catch(() => null);
    const before = listServiceRecordsPaged({
      from: older.from,
      to: older.to,
      status: "OPEN",
      size: 1,
    }).catch(() => null);
    void Promise.all([open, closed, before]).then(([o, c, b]) => {
      setOpenRecords(Array.isArray(o?.content) ? o.content : []);
      setClosedRecords(Array.isArray(c?.content) ? c.content : []);
      setClosedTotal(c?.totalElements ?? 0);
      setOlderOpen(b?.totalElements ?? 0);
      setLoaded(true);
    });
  }, [professionalMode]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshKey]);

  // Typing filters at once; the paid / voided list is asked for again (all of them) after a pause.
  const firstQueryRun = useRef(true);
  useEffect(() => {
    queryRef.current = query;
    if (firstQueryRun.current) {
      // Mounting already loads; only a change of the text asks again.
      firstQueryRun.current = false;
      return;
    }
    const id = window.setTimeout(load, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const searchText = query.trim();
  const searching = searchText !== "";
  const clientLabel = (r: ServiceRecordListItem) =>
    r.clientGeneric ? t("femme.serviceRecords.occasionalClient") : r.clientFullName;
  const matches = (r: ServiceRecordListItem) =>
    !searching ||
    matchesListQuery(clientLabel(r), searchText) ||
    matchesListQuery(r.servicesSummary ?? "", searchText);
  const visibleOpen = openRecords.filter(matches);
  const visibleClosed = closedRecords.filter(matches);
  const closedCount = searching ? visibleClosed.length : closedTotal;
  const closedLeft = searching ? 0 : Math.max(0, closedTotal - closedRecords.length);
  // A search opens the folded list by itself when something there matches.
  const closedShown = closedExpanded || (searching && visibleClosed.length > 0);
  const showOlder = !professionalMode && olderOpen > 0 && !searching;
  const nothingToday = loaded && openRecords.length === 0 && closedTotal === 0;

  async function loadMore() {
    setLoadingMore(true);
    const { from, to } = todayRangeIso();
    try {
      const page = await listServiceRecordsPaged({
        from,
        to,
        status: "NOT_OPEN",
        size: CLOSED_PAGE,
        page: Math.floor(closedRecords.length / CLOSED_PAGE),
      });
      const incoming = Array.isArray(page?.content) ? page.content : [];
      setClosedRecords((prev) => {
        const have = new Set(prev.map((r) => r.id));
        return [...prev, ...incoming.filter((r) => !have.has(r.id))];
      });
      setClosedTotal(page?.totalElements ?? closedTotal);
    } catch (err) {
      setPayError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function openInvoice(id: number) {
    setPayError(null);
    try {
      const record = await getServiceRecord(id);
      if (record.invoiceId != null) setInvoiceId(record.invoiceId);
      else setSelectedId(id);
    } catch (err) {
      setPayError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    }
  }

  async function pay(id: number) {
    setPayError(null);
    try {
      const record = await getServiceRecord(id);
      await billServiceRecord(navigate, record);
    } catch (err) {
      setPayError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    }
  }

  function renderRow(r: ServiceRecordListItem) {
    const isOpen = r.status === "OPEN";
    const clientName = clientLabel(r);
    const meta = [
      formatParaguayTime(r.createdAt, locale),
      // What is being done right now matters for an open ficha.
      isOpen ? r.servicesSummary || null : null,
      r.professionalsSummary || null,
      r.appointmentId && r.appointmentStartAt
        ? t("femme.appointmentFicha.appointmentTag", {
            time: formatParaguayTime(r.appointmentStartAt, locale),
          })
        : t("femme.appointmentFicha.noAppointmentTag"),
    ]
      .filter(Boolean)
      .join(" · ");
    const hasAmount = Number(r.totalAmount) > 0;
    return (
      <li
        key={r.id}
        data-testid="dashboard-service-record-card"
        data-status={r.status}
        className="relative flex min-h-14 items-center gap-3 border-b border-line py-2.5 last:border-b-0"
      >
        {/* The whole row opens the ficha; "Cobrar" sits above it. */}
        <button
          type="button"
          aria-label={t("femme.serviceRecords.history.openDetail", { client: clientName })}
          onClick={() => setSelectedId(r.id)}
          className="absolute inset-0 rounded-lg hover:bg-primary-lt/40"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-lt font-heading text-xs font-extrabold text-primary"
        >
          {initialsOf(clientName)}
        </span>
        <div className="pointer-events-none min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-ink">{clientName}</div>
          <div className="truncate text-xs text-ink-3" data-testid="dashboard-service-record-appointment-tag">
            {meta}
          </div>
        </div>
        <div className="pointer-events-none flex shrink-0 flex-col items-end gap-1">
          {!professionalMode && hasAmount ? (
            <span className="text-sm font-extrabold tabular-nums text-ink">
              {formatAmountDecimal(r.totalAmount)}
            </span>
          ) : null}
          {isOpen ? (
            professionalMode ? (
              <span className="rounded-full bg-warning-lt px-2.5 text-xs font-bold text-warning">
                {t("femme.serviceRecords.statusOpen")}
              </span>
            ) : (
              <button
                type="button"
                data-testid={`dashboard-service-record-pay-${r.id}`}
                aria-label={t("femme.serviceRecords.payFor", { client: clientName })}
                onClick={() => void pay(r.id)}
                className="pointer-events-auto relative h-[30px] rounded-full bg-primary px-3.5 text-[12.5px] font-bold text-primary-fg after:absolute after:-inset-x-1 after:-inset-y-[7px] after:content-[''] hover:opacity-90"
              >
                {t("femme.serviceRecords.pay")}
              </button>
            )
          ) : r.status === "CLOSED" && !professionalMode ? (
            <button
              type="button"
              data-testid={`dashboard-service-record-invoice-${r.id}`}
              aria-label={t("femme.serviceRecords.viewInvoiceFor", { client: clientName })}
              onClick={() => void openInvoice(r.id)}
              className="pointer-events-auto relative rounded-full bg-success-lt px-2.5 text-xs font-bold text-success underline-offset-2 after:absolute after:-inset-x-1 after:-inset-y-[7px] after:content-[''] hover:underline"
            >
              {t("femme.serviceRecords.statusClosed")}
            </button>
          ) : (
            <span
              className={`rounded-full px-2.5 text-xs font-bold ${
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
    );
  }

  return (
    <section className="flex flex-col gap-2.5" data-testid="dashboard-today-records">
      <SectionTitle
        title={t("femme.serviceRecords.today.title")}
        badge={
          visibleOpen.length > 0
            ? t("femme.serviceRecords.today.openCount", { count: visibleOpen.length })
            : undefined
        }
        badgeTone="amber"
        badgeTestId="dashboard-today-records-open-count"
        action={
          !professionalMode ? (
            <Link
              to="/app/service-records"
              // With older open fichas the link opens the list on «Abiertas»; otherwise the history.
              state={showOlder ? undefined : { activeTab: "history" }}
              data-testid="dashboard-service-records-history-link"
              aria-label={
                showOlder
                  ? t("femme.serviceRecords.dashboard.viewHistoryOlder", { count: olderOpen })
                  : undefined
              }
              className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary"
            >
              {t("femme.serviceRecords.dashboard.viewHistory")}
              {showOlder ? (
                <span
                  data-testid="dashboard-service-records-older-dot"
                  aria-hidden="true"
                  className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-1.5 text-[11px] font-extrabold leading-none text-surface"
                >
                  {olderOpen}
                </span>
              ) : null}
            </Link>
          ) : undefined
        }
      />
      <Card className={nothingToday ? "p-0" : "p-4 sm:p-5"}>
        {nothingToday ? (
          <TodayEmptyState
            message={
              professionalMode ? t("femme.serviceRecords.today.emptyOpen") : t("femme.serviceRecords.dashboard.empty")
            }
            actionLabel={onNewRecord ? t("femme.serviceRecords.today.createFirst") : undefined}
            onAction={onNewRecord}
            testId="dashboard-service-records-empty"
            actionTestId="dashboard-service-records-create-first"
          />
        ) : (
          <>
            {!professionalMode ? (
              <div className="mb-2" data-testid="dashboard-service-records-filter">
                <ListSearchField
                  id="dashboard-records-filter"
                  value={query}
                  onChange={setQuery}
                  label={t("femme.listFilter.label")}
                  placeholder={t("femme.listFilter.placeholder")}
                />
              </div>
            ) : null}

            {visibleOpen.length > 0 ? (
              <ul data-testid="dashboard-service-records-grid" className="flex flex-col" role="list">
                {visibleOpen.map(renderRow)}
              </ul>
            ) : searching ? null : (
              <p className="py-2 text-sm text-ink-3" data-testid="dashboard-service-records-no-open">
                {t("femme.serviceRecords.today.emptyOpen")}
              </p>
            )}

            {searching && visibleOpen.length === 0 && visibleClosed.length === 0 ? (
              <p className="py-2 text-sm text-ink-3" data-testid="dashboard-service-records-no-matches">
                {t("femme.listFilter.noMatches")}
              </p>
            ) : null}

            {!professionalMode && closedCount > 0 ? (
              <div className="border-t border-line" data-testid="dashboard-service-records-closed">
                <button
                  type="button"
                  data-testid="dashboard-service-records-closed-toggle"
                  aria-expanded={closedShown}
                  onClick={() => setClosedExpanded((v) => !v)}
                  className="flex min-h-12 w-full items-center gap-2.5 text-left text-sm font-bold text-ink"
                >
                  <span>{t("femme.serviceRecords.today.closedTitle")}</span>
                  <span
                    data-testid="dashboard-service-records-closed-count"
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary-lt px-2 text-xs font-extrabold tabular-nums text-primary"
                  >
                    {closedCount}
                  </span>
                  <span className="text-xs font-semibold text-ink-3">
                    {t("femme.serviceRecords.today.closedHint")}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`ml-auto text-ink-3 transition-transform ${closedShown ? "rotate-180" : ""}`}
                  >
                    ⌄
                  </span>
                </button>
                {closedShown ? (
                  <>
                    <ul
                      data-testid="dashboard-service-records-closed-list"
                      className="flex flex-col"
                      role="list"
                    >
                      {visibleClosed.map(renderRow)}
                    </ul>
                    {closedLeft > 0 ? (
                      <button
                        type="button"
                        data-testid="dashboard-service-records-more"
                        disabled={loadingMore}
                        onClick={() => void loadMore()}
                        className="mt-1 min-h-11 w-full rounded-card border border-line bg-surface p-3 text-sm font-semibold text-primary disabled:opacity-60"
                      >
                        {t("femme.serviceRecords.dashboard.showMoreCount", { count: closedLeft })}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {onNewRecord ? (
              <button
                type="button"
                data-testid="dashboard-service-records-add-row"
                onClick={onNewRecord}
                className="mt-1 flex min-h-11 w-full items-center gap-2 text-sm font-bold text-primary"
              >
                <span aria-hidden="true" className="text-lg leading-none">
                  +
                </span>
                {t("femme.serviceRecords.today.addRow")}
              </button>
            ) : null}
          </>
        )}

        {payError ? (
          <div role="alert" className="pt-3 text-sm text-danger">
            {payError}
          </div>
        ) : null}

        {invoiceId !== null ? (
          <InvoiceDetailModal
            invoiceId={invoiceId}
            onClose={() => setInvoiceId(null)}
            onVoided={() => {
              setInvoiceId(null);
              load();
            }}
          />
        ) : null}

        {selectedId !== null ? (
          <ServiceRecordDetailModal
            serviceRecordId={selectedId}
            professionalMode={professionalMode}
            onClose={() => setSelectedId(null)}
            onChanged={(kind) => {
              load();
              setNotice(kind);
            }}
          />
        ) : null}

        <Toast
          open={notice !== null}
          onOpenChange={(o) => {
            if (!o) setNotice(null);
          }}
          variant="success"
          duration={4000}
          data-testid="dashboard-record-toast"
        >
          {notice === "voided"
            ? t("femme.serviceRecords.voidedSuccess")
            : t("femme.serviceRecords.updatedSuccess")}
        </Toast>
      </Card>
    </section>
  );
}
