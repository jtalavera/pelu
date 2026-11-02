import { useCallback, useEffect, useMemo, useState } from "react";
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
import { ServiceRecordDetailModal } from "./ServiceRecordDetailModal";

const POLL_MS = 30_000;
const CAP = 12;
const STATUS_RANK: Record<string, number> = { OPEN: 0, CLOSED: 1, VOIDED: 2 };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Local calendar day bounds as ISO instants (the API parses `Instant`, not dates). */
function todayRangeIso(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * "Fichas de hoy" as eye-catching cards, shared by the admin's Inicio and the professional's
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
}: {
  professionalMode?: boolean;
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
    <Card className="p-4 sm:p-5" data-testid="dashboard-today-records">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-extrabold text-ink">
          {t("femme.serviceRecords.today.title")}
        </h2>
        {openCount > 0 ? (
          <span
            className="rounded-full bg-warning-lt px-3 py-0.5 text-sm font-extrabold text-warning"
            data-testid="dashboard-today-records-open-count"
          >
            {t("femme.serviceRecords.today.openCount", { count: openCount })}
          </span>
        ) : null}
      </div>

      {loaded && sorted.length === 0 ? (
        <p className="py-2 text-ink-3" data-testid="dashboard-service-records-empty">
          {professionalMode
            ? t("femme.serviceRecords.today.emptyOpen")
            : t("femme.serviceRecords.dashboard.empty")}
        </p>
      ) : (
        <div
          data-testid="dashboard-service-records-grid"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {shown.map((r) => {
            const isOpen = r.status === "OPEN";
            const services = (r.servicesSummary ?? "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
            const meta = [
              formatParaguayTime(r.createdAt, locale),
              r.professionalsSummary || null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <article
                key={r.id}
                data-testid="dashboard-service-record-card"
                data-status={r.status}
                className={`relative flex flex-col gap-2 rounded-card border bg-surface p-4 ${
                  isOpen
                    ? "border-[1.5px] border-warning/50 shadow-md"
                    : "border-line opacity-90"
                }`}
              >
                {/* The whole card opens the ficha; "Cobrar" sits above it. */}
                <button
                  type="button"
                  aria-label={t("femme.serviceRecords.history.openDetail", { client: r.clientFullName })}
                  onClick={() => setSelectedId(r.id)}
                  className="absolute inset-0 rounded-card"
                />
                <div className="pointer-events-none flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-lt font-heading text-sm font-extrabold text-primary"
                  >
                    {initialsOf(r.clientFullName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="break-words font-heading text-base font-extrabold leading-tight text-ink">
                      {r.clientFullName}
                    </div>
                    <div className="truncate text-xs text-ink-3">{meta}</div>
                  </div>
                  {!isOpen ? (
                    <span
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
                  ) : null}
                </div>

                <span
                  data-testid="dashboard-service-record-appointment-tag"
                  className={`pointer-events-none self-start rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    r.appointmentId
                      ? "bg-primary-lt text-primary"
                      : "border border-line bg-bg text-ink-3"
                  }`}
                >
                  {r.appointmentId && r.appointmentStartAt
                    ? t("femme.appointmentFicha.appointmentTag", {
                        time: formatParaguayTime(r.appointmentStartAt, locale),
                      })
                    : t("femme.appointmentFicha.noAppointmentTag")}
                </span>

                {isOpen ? (
                  <div className="pointer-events-none flex flex-wrap gap-1.5">
                    {services.length > 0 ? (
                      services.map((name) => (
                        <span
                          key={name}
                          className="rounded-lg bg-primary-lt px-2 py-0.5 text-xs font-bold text-primary"
                        >
                          {name}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-ink-3">{t("femme.serviceRecords.noServices")}</span>
                    )}
                  </div>
                ) : null}

                {!professionalMode && isOpen ? (
                  <div className="pointer-events-none mt-1 flex items-center justify-between gap-3 border-t border-dashed border-line pt-3">
                    <span className="font-heading text-xl font-extrabold tabular-nums text-ink">
                      {Number(r.totalAmount) > 0 ? `Gs. ${formatAmountDecimal(r.totalAmount)}` : "—"}
                    </span>
                    <button
                      type="button"
                      data-testid={`dashboard-service-record-pay-${r.id}`}
                      aria-label={t("femme.serviceRecords.payFor", { client: r.clientFullName })}
                      onClick={() => void pay(r.id)}
                      className="pointer-events-auto relative min-h-11 rounded-full bg-primary px-5 font-extrabold text-primary-fg hover:opacity-90"
                    >
                      {t("femme.serviceRecords.pay")}
                    </button>
                  </div>
                ) : null}

                {!professionalMode && !isOpen && Number(r.totalAmount) > 0 ? (
                  <div className="pointer-events-none text-sm tabular-nums text-ink-3">
                    Gs. {formatAmountDecimal(r.totalAmount)}
                  </div>
                ) : null}
              </article>
            );
          })}
          {sorted.length > visible ? (
            <button
              type="button"
              data-testid="dashboard-service-records-more"
              onClick={() => setVisible((c) => c + CAP)}
              className="min-h-11 rounded-card border border-line bg-surface p-3 text-sm font-semibold text-primary"
            >
              {t("femme.serviceRecords.dashboard.showMore")}
            </button>
          ) : null}
        </div>
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
  );
}
