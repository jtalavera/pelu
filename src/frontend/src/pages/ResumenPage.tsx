import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Text } from "@design-system";
import { listAppointments, type Appointment } from "../api/appointments";
import { getCurrentSession, getSessionDetail, type CashSessionDetail } from "../api/cashSessions";
import { femmeJson } from "../api/femmeClient";
import { listInvoicesPaged, type InvoiceListItem } from "../api/invoices";
import {
  getServiceRecord,
  listServiceRecordsPaged,
  type ServiceRecordListItem,
} from "../api/serviceRecords";
import { AppointmentFormModal } from "../components/AppointmentFormModal";
import { ACTION_BUTTON } from "../components/actionButtons";
import { deriveInvoiceState } from "../components/InvoiceStatePill";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { getDateLocale } from "../i18n/dateLocale";
import { formatAmountDecimal, formatGuaraniesGs } from "../lib/formatMoney";
import { initialsOf } from "../lib/initials";
import { formatParaguayTime } from "../lib/paraguayDateTime";
import { billServiceRecord } from "../lib/serviceRecordBilling";

/** HU-77 · «Resumen»: how the salon is doing today, in four cards. */

const POLL_MS = 60_000;
/** Open fichas of the day come in one page (the server caps a page at 200). */
const OPEN_FICHAS_MAX = 200;
const INVOICES_PAGE = 200;
/** How many open fichas / next appointments the cards list. */
const FICHAS_SHOWN = 3;
const APPOINTMENTS_SHOWN = 4;

type SummaryResponse = {
  appointmentsToday: { total: number; pending: number; confirmed: number };
  fiscalAlerts: Array<{ severity: string; messageKey: string; message: string }>;
};

type FichasState = {
  open: ServiceRecordListItem[];
  closedCount: number;
  voidedCount: number;
  olderOpenCount: number;
};

type InvoicesState = { total: number; attention: number };

function dayBoundsIso(d: Date): { from: string; to: string } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** From a year ago to the end of yesterday: the days before today (the API never returns more). */
function olderBoundsIso(d: Date): { from: string; to: string } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return {
    from: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 360).toISOString(),
    to: new Date(start.getTime() - 1).toISOString(),
  };
}

function Card({
  title,
  testId,
  action,
  className = "",
  children,
}: {
  title: string;
  testId: string;
  /** Link at the right of the title. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={`flex min-w-0 flex-col gap-3.5 rounded-card border border-line bg-surface p-5 sm:p-6 ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 font-heading text-[17px] font-extrabold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const bigNumber = "font-heading font-extrabold leading-none text-primary";
const cardLink =
  "inline-flex min-h-11 items-center self-start text-sm font-extrabold text-primary hover:underline";

export default function ResumenPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const sifenEnabled = useFeatureFlag("SIFEN_ELECTRONIC_INVOICING");
  const locale = getDateLocale(i18n);

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  // `undefined` = not answered yet; `null` = no register open.
  const [cash, setCash] = useState<CashSessionDetail | null | undefined>(undefined);
  const [fichas, setFichas] = useState<FichasState | null>(null);
  const [invoices, setInvoices] = useState<InvoicesState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [newApptOpen, setNewApptOpen] = useState(false);
  const [chargingId, setChargingId] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const today = new Date();
    const range = dayBoundsIso(today);
    const older = olderBoundsIso(today);
    try {
      const [sum, appts, session, open, closed, voided, olderOpen, inv] = await Promise.all([
        femmeJson<SummaryResponse>("/api/dashboard", { json: false }),
        listAppointments(range.from, range.to),
        getCurrentSession().then((s) => (s && s.isOpen !== false ? getSessionDetail(s.id) : null)),
        listServiceRecordsPaged({ ...range, status: "OPEN", page: 0, size: OPEN_FICHAS_MAX }),
        listServiceRecordsPaged({ ...range, status: "CLOSED", page: 0, size: 1 }),
        listServiceRecordsPaged({ ...range, status: "VOIDED", page: 0, size: 1 }),
        listServiceRecordsPaged({ ...older, status: "OPEN", page: 0, size: 1 }),
        listInvoicesPaged({ ...range, page: 0, size: INVOICES_PAGE }),
      ]);
      setSummary(sum);
      setAppointments(Array.isArray(appts) ? appts : []);
      setCash(session ?? null);
      setFichas({
        open: open.content,
        closedCount: closed.totalElements,
        voidedCount: voided.totalElements,
        olderOpenCount: olderOpen.totalElements,
      });
      const issued = inv.content.filter((i: InvoiceListItem) => i.status === "ISSUED");
      setInvoices({
        total: inv.totalElements,
        attention: issued.filter((i) => deriveInvoiceState(i) === "attention").length,
      });
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const dateLabel = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(now);

  const nextAppointments = useMemo(
    () =>
      appointments
        .filter((a) => a.status === "PENDING" || a.status === "CONFIRMED" || a.status === "IN_PROGRESS")
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
        .slice(0, APPOINTMENTS_SHOWN),
    [appointments],
  );

  /** Cash by how it was paid: cash, card (debit + credit), transfer, and anything else. */
  const cashRows = useMemo(() => {
    const byMethod = new Map<string, number>();
    for (const p of cash?.paymentSummary ?? []) byMethod.set(p.method, Number(p.total) || 0);
    const sum = (...methods: string[]) => methods.reduce((acc, m) => acc + (byMethod.get(m) ?? 0), 0);
    const known = ["CASH", "DEBIT_CARD", "CREDIT_CARD", "TRANSFER"];
    const other = [...byMethod.entries()].filter(([m]) => !known.includes(m)).reduce((acc, [, v]) => acc + v, 0);
    const total = [...byMethod.values()].reduce((acc, v) => acc + v, 0);
    return {
      total,
      rows: [
        { key: "cash", label: t("femme.resumen.cash.cash"), amount: sum("CASH") },
        { key: "card", label: t("femme.resumen.cash.card"), amount: sum("DEBIT_CARD", "CREDIT_CARD") },
        { key: "transfer", label: t("femme.resumen.cash.transfer"), amount: sum("TRANSFER") },
        ...(other > 0 ? [{ key: "other", label: t("femme.resumen.cash.other"), amount: other }] : []),
      ],
    };
  }, [cash, t]);

  const openFichas = useMemo(
    () => [...(fichas?.open ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [fichas],
  );
  const toCollect = openFichas.reduce((acc, f) => acc + (Number(f.totalAmount) || 0), 0);

  function ago(iso: string): string {
    const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
    if (minutes < 1) return t("femme.resumen.ago.justNow");
    if (minutes < 60) return t("femme.resumen.ago.minutes", { m: minutes });
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? t("femme.resumen.ago.hours", { h }) : t("femme.resumen.ago.hoursMinutes", { h, m });
  }

  async function collect(ficha: ServiceRecordListItem) {
    setChargingId(ficha.id);
    try {
      await billServiceRecord(navigate, await getServiceRecord(ficha.id));
    } catch {
      setChargingId(null);
    }
  }

  const fiscalAlert = !alertDismissed
    ? (summary?.fiscalAlerts.find((a) => a.severity !== "blocking") ?? null)
    : null;

  if (!loaded) {
    return (
      <div
        data-testid="resumen-loading"
        role="status"
        aria-busy="true"
        className="mx-auto flex w-full max-w-5xl animate-pulse flex-col gap-5"
      >
        <span className="sr-only">{t("femme.resumen.loading")}</span>
        <div className="h-9 w-56 rounded-md bg-line" />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-56 rounded-card border border-line bg-surface" />
          ))}
        </div>
      </div>
    );
  }

  if (failed && summary === null) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Alert variant="destructive" title={t("femme.resumen.error")} data-testid="resumen-error" />
      </div>
    );
  }

  const apptsToday = summary?.appointmentsToday ?? { total: 0, pending: 0, confirmed: 0 };
  const fichasTotal = openFichas.length + (fichas?.closedCount ?? 0) + (fichas?.voidedCount ?? 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5" data-testid="resumen-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 font-heading text-[28px] font-extrabold text-ink" data-testid="resumen-title">
            {t("femme.resumen.greeting")}
          </h1>
          <p className="m-0 mt-1 text-[15px] text-ink-3" data-testid="resumen-subtitle">
            {t("femme.resumen.subtitle", { date: dateLabel })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button
            type="button"
            variant="primary"
            className={ACTION_BUTTON}
            data-testid="resumen-new-appointment"
            onClick={() => setNewApptOpen(true)}
          >
            {t("femme.resumen.newAppointment")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={ACTION_BUTTON}
            data-testid="resumen-new-invoice"
            onClick={() => navigate("/app/billing", { state: { activeTab: "invoice" } })}
          >
            {t("femme.resumen.newInvoice")}
          </Button>
        </div>
      </div>

      {fiscalAlert ? (
        <Alert
          variant="warning"
          title={fiscalAlert.message}
          data-testid="resumen-fiscal-alert"
          onClose={() => setAlertDismissed(true)}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* ── Turnos de hoy ── */}
        <Card title={t("femme.resumen.appointments.title")} testId="resumen-appointments">
          <div className="flex gap-5">
            <div className="w-28 shrink-0">
              <div className={`${bigNumber} text-[52px]`} data-testid="resumen-appointments-total">
                {apptsToday.total}
              </div>
              <div className="mt-2 text-[13px] leading-relaxed text-ink-3">
                <div data-testid="resumen-appointments-pending">
                  {t("femme.resumen.appointments.pending", { count: apptsToday.pending })}
                </div>
                <div data-testid="resumen-appointments-confirmed">
                  {t("femme.resumen.appointments.confirmed", { count: apptsToday.confirmed })}
                </div>
              </div>
            </div>
            {nextAppointments.length === 0 ? (
              <Text variant="muted" className="min-w-0 flex-1 self-center" data-testid="resumen-appointments-empty">
                {t("femme.resumen.appointments.empty")}
              </Text>
            ) : (
              <ul className="m-0 flex min-w-0 flex-1 list-none flex-col p-0" data-testid="resumen-appointments-list">
                {nextAppointments.map((a) => (
                  <li
                    key={a.id}
                    data-testid="resumen-appointment"
                    className="flex min-h-9 items-center gap-3.5 border-t border-line text-sm first:border-t-0"
                  >
                    <b className="w-12 shrink-0 tabular-nums">{formatParaguayTime(a.startAt, locale)}</b>
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {a.clientName ?? t("femme.calendar.detail.occasionalClient")}
                    </span>
                    <span className="hidden shrink-0 text-ink-3 sm:inline">{a.serviceName}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link to="/app/calendar" className={`${cardLink} mt-auto`} data-testid="resumen-view-agenda">
            {t("femme.resumen.appointments.viewAgenda")}
          </Link>
        </Card>

        {/* ── Caja del día ── */}
        {cash ? (
          <Card title={t("femme.resumen.cash.title")} testId="resumen-cash">
            <div className={`${bigNumber} text-[44px]`} data-testid="resumen-cash-total">
              {formatGuaraniesGs(cashRows.total)}
            </div>
            <div className="flex flex-col">
              {cashRows.rows.map((r) => (
                <div
                  key={r.key}
                  data-testid={`resumen-cash-${r.key}`}
                  className="flex min-h-9 items-center justify-between border-t border-line text-[15px]"
                >
                  <span className="text-ink-2">{r.label}</span>
                  <b className="tabular-nums">{formatGuaraniesGs(r.amount)}</b>
                </div>
              ))}
            </div>
            <Link to="/app/billing" className={`${cardLink} mt-auto`} data-testid="resumen-view-cash">
              {t("femme.resumen.cash.openedSince", { time: formatParaguayTime(cash.openedAt, locale) })} ·{" "}
              {t("femme.resumen.cash.viewCash")}
            </Link>
          </Card>
        ) : (
          <Card title={t("femme.resumen.cash.title")} testId="resumen-cash">
            <div className="font-heading text-[28px] font-extrabold leading-tight text-ink-2" data-testid="resumen-cash-closed">
              {t("femme.resumen.cash.closedTitle")}
            </div>
            <Text variant="muted">{t("femme.resumen.cash.closedBody")}</Text>
            <Link to="/app/billing" className={`${cardLink} mt-auto`} data-testid="resumen-view-cash">
              {t("femme.resumen.cash.goCash")}
            </Link>
          </Card>
        )}

        {/* ── Fichas de hoy ── */}
        <Card
          title={t("femme.resumen.fichas.title")}
          testId="resumen-fichas"
          className="pb-3 sm:pb-4"
          action={
            <Link to="/app/service-records" className={cardLink} data-testid="resumen-fichas-view-all">
              {t("femme.resumen.fichas.viewAll")}
            </Link>
          }
        >
          {fichasTotal === 0 && (fichas?.olderOpenCount ?? 0) === 0 ? (
            <Text variant="muted" data-testid="resumen-fichas-empty">
              {t("femme.resumen.fichas.empty")}
            </Text>
          ) : (
            <>
              <div>
                <div className={`${bigNumber} text-[40px]`} data-testid="resumen-fichas-to-collect">
                  {formatGuaraniesGs(toCollect)}
                </div>
                <div className="mt-1.5 text-sm text-ink-3">
                  {t("femme.resumen.fichas.toCollectIn")}{" "}
                  <b className="text-ink" data-testid="resumen-fichas-open-count">
                    {t("femme.resumen.fichas.openRecords", { count: openFichas.length })}
                  </b>
                </div>
              </div>

              <div>
                <div
                  className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-line"
                  role="img"
                  aria-label={t("femme.resumen.fichas.barLabel")}
                  data-testid="resumen-fichas-bar"
                >
                  {fichas && fichas.closedCount > 0 ? (
                    <div className="bg-success" style={{ flex: `${fichas.closedCount} 1 0` }} />
                  ) : null}
                  {openFichas.length > 0 ? (
                    <div className="bg-warning" style={{ flex: `${openFichas.length} 1 0` }} />
                  ) : null}
                  {fichas && fichas.voidedCount > 0 ? (
                    <div className="bg-ink-3" style={{ flex: `${fichas.voidedCount} 1 0` }} />
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2" data-testid="resumen-fichas-legend">
                  <span>
                    <b>{fichas?.closedCount ?? 0}</b> {t("femme.resumen.fichas.paid", { count: fichas?.closedCount ?? 0 })}
                  </span>
                  <span>
                    <b>{openFichas.length}</b> {t("femme.resumen.fichas.open", { count: openFichas.length })}
                  </span>
                  <span>
                    <b>{fichas?.voidedCount ?? 0}</b>{" "}
                    {t("femme.resumen.fichas.voided", { count: fichas?.voidedCount ?? 0 })}
                  </span>
                </div>
              </div>

              {openFichas.length > 0 ? (
                <ul className="m-0 flex list-none flex-col p-0" data-testid="resumen-fichas-list">
                  {openFichas.slice(0, FICHAS_SHOWN).map((f) => {
                    const client = f.clientGeneric
                      ? t("femme.serviceRecords.occasionalClient")
                      : f.clientFullName;
                    return (
                      <li
                        key={f.id}
                        data-testid="resumen-ficha"
                        className="flex min-h-[3.75rem] items-center gap-3 border-t border-line"
                      >
                        <span
                          aria-hidden
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-lt text-sm font-extrabold text-primary-dk"
                        >
                          {initialsOf(client)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14.5px] font-bold text-ink">{client}</div>
                          <div className="truncate text-[12.5px] text-ink-3">
                            {[f.servicesSummary, f.professionalsSummary, ago(f.createdAt)].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <b className="shrink-0 text-[14.5px] tabular-nums">{formatAmountDecimal(f.totalAmount)}</b>
                        <Button
                          type="button"
                          variant="ghost"
                          className={`${ACTION_BUTTON} shrink-0 px-2 font-extrabold text-primary`}
                          disabled={chargingId === f.id}
                          aria-label={t("femme.resumen.fichas.collectFor", { client })}
                          data-testid={`resumen-ficha-collect-${f.id}`}
                          onClick={() => void collect(f)}
                        >
                          {t("femme.resumen.fichas.collect")}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {openFichas.length > FICHAS_SHOWN ? (
                <div className="-mt-1 text-[12.5px] text-ink-3" data-testid="resumen-fichas-more">
                  {t("femme.resumen.fichas.moreOpen", { count: openFichas.length - FICHAS_SHOWN })}
                </div>
              ) : null}
              {fichas && fichas.olderOpenCount > 0 ? (
                <Link
                  to="/app/service-records?status=OPEN"
                  className="text-[12.5px] font-bold text-primary hover:underline"
                  data-testid="resumen-fichas-older"
                >
                  {t("femme.resumen.fichas.olderOpen", { count: fichas.olderOpenCount })}
                </Link>
              ) : null}
            </>
          )}
        </Card>

        {/* ── Factura electrónica ── */}
        <Card
          title={sifenEnabled ? t("femme.resumen.invoices.titleSifen") : t("femme.resumen.invoices.title")}
          testId="resumen-invoices"
        >
          <div className={`${bigNumber} text-[44px]`} data-testid="resumen-invoices-total">
            {invoices?.total ?? 0}
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-sm text-ink-3">
            {sifenEnabled ? t("femme.resumen.invoices.emittedSifen") : t("femme.resumen.invoices.emitted")}
            {sifenEnabled ? (
              invoices && invoices.attention > 0 ? (
                <span
                  data-testid="resumen-invoices-attention"
                  className="inline-flex min-h-6 items-center rounded-full bg-danger-lt px-2.5 text-xs font-extrabold text-danger"
                >
                  {t("femme.resumen.invoices.needAttention", { count: invoices.attention })}
                </span>
              ) : (
                <span
                  data-testid="resumen-invoices-ok"
                  className="inline-flex min-h-6 items-center rounded-full bg-success-lt px-2.5 text-xs font-extrabold text-success"
                >
                  {t("femme.resumen.invoices.allUpToDate")}
                </span>
              )
            ) : null}
          </div>
          <Link to="/app/billing" className={`${cardLink} mt-auto`} data-testid="resumen-view-invoices">
            {t("femme.resumen.invoices.view")}
          </Link>
        </Card>
      </div>

      <AppointmentFormModal open={newApptOpen} onClose={() => setNewApptOpen(false)} onSaved={() => void load()} />
    </div>
  );
}
