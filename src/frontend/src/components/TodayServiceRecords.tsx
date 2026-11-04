import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Toast } from "@design-system";
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
import { InvoiceDetailModal } from "./InvoiceDetailModal";
import { SectionTitle } from "./SectionTitle";
import { ServiceRecordDetailModal } from "./ServiceRecordDetailModal";

const POLL_MS = 30_000;
const CAP = 12;
const STATUS_RANK: Record<string, number> = { OPEN: 0, CLOSED: 1, VOIDED: 2 };

/** Local calendar day bounds as ISO instants (the API parses `Instant`, not dates). */
function todayRangeIso(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * "Fichas de hoy" as a compact list of rows, shared by the admin's Inicio and the professional's
 * Inicio (regular and shared-device sessions).
 *
 * - Admin: every ficha of the day; the open ones stand out (amber border, amount and "Cobrar"),
 *   paid / voided ones are quieter and sit after them.
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

  const [records, setRecords] = useState<ServiceRecordListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(CAP);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notice, setNotice] = useState<"updated" | "voided" | null>(null);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  const load = useCallback(() => {
    const { from, to } = todayRangeIso();
    listServiceRecordsPaged({ from, to, size: 100 })
      .then((page) => setRecords(Array.isArray(page?.content) ? page.content : []))
      .catch(() => setRecords([]))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshKey]);

  const sorted = useMemo(
    () =>
      [...records].sort((a, b) => {
        const rank = (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99);
        if (rank !== 0) return rank;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }),
    [records],
  );
  const openCount = records.filter((r) => r.status === "OPEN").length;
  const shown = sorted.slice(0, visible);

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

  return (
    <section className="flex flex-col gap-2.5" data-testid="dashboard-today-records">
      <SectionTitle
        title={t("femme.serviceRecords.today.title")}
        badge={openCount > 0 ? t("femme.serviceRecords.today.openCount", { count: openCount }) : undefined}
        badgeTone="amber"
        badgeTestId="dashboard-today-records-open-count"
      />
      <Card className="p-4 sm:p-5">
      {loaded && sorted.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-card border-[1.5px] border-dashed border-line px-4 py-6 text-center"
          data-testid="dashboard-service-records-empty"
        >
          <p className="text-sm text-ink-3">
            {professionalMode
              ? t("femme.serviceRecords.today.emptyOpen")
              : t("femme.serviceRecords.dashboard.empty")}
          </p>
          {onNewRecord ? (
            <Button
              type="button"
              className="min-h-11"
              data-testid="dashboard-service-records-create-first"
              onClick={onNewRecord}
            >
              {t("femme.serviceRecords.today.createFirst")}
            </Button>
          ) : null}
        </div>
      ) : (
        <ul data-testid="dashboard-service-records-grid" className="flex flex-col" role="list">
          {shown.map((r) => {
            const isOpen = r.status === "OPEN";
            const clientName = r.clientGeneric
              ? t("femme.serviceRecords.occasionalClient")
              : r.clientFullName;
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
          })}
          {sorted.length > visible ? (
            <li>
              <button
                type="button"
                data-testid="dashboard-service-records-more"
                onClick={() => setVisible((c) => c + CAP)}
                className="min-h-11 w-full rounded-card border border-line bg-surface p-3 text-sm font-semibold text-primary"
              >
                {t("femme.serviceRecords.dashboard.showMore")}
              </button>
            </li>
          ) : null}
          {onNewRecord ? (
            <li className="mt-1">
              <button
                type="button"
                data-testid="dashboard-service-records-add-row"
                onClick={onNewRecord}
                className="flex min-h-11 w-full items-center gap-2 text-sm font-bold text-primary"
              >
                <span aria-hidden="true" className="text-lg leading-none">
                  +
                </span>
                {t("femme.serviceRecords.today.addRow")}
              </button>
            </li>
          ) : null}
        </ul>
      )}

      {payError ? (
        <div role="alert" className="pt-3 text-sm text-danger">
          {payError}
        </div>
      ) : null}

      {!professionalMode ? (
        <Link
          to="/app/service-records"
          state={{ activeTab: "history" }}
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary"
        >
          {t("femme.serviceRecords.dashboard.viewHistory")}
        </Link>
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
