import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Card, Heading, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";
import {
  PaymentStack,
  RankedBars,
  RevenueBars,
  WeekdayBars,
  revenueBuckets,
  trendTotal,
  type TrendPoint,
} from "../components/charts/SummaryCharts";
import { getDateLocale } from "../i18n/dateLocale";
import { formatGuaraniesGs } from "../lib/formatMoney";
import { capitalize } from "./billing/billingShared";

type DashboardsResponse = {
  revenueWeek?: { invoiced: string | number; collected: string | number };
  clientsThisMonth?: number;
  /** Distinct clients with appointments in the requested period. */
  clientsInPeriod?: number;
  revenueTrend: TrendPoint[];
  revenueTrendDays: number;
  topServices: Array<{ serviceName: string; revenue: string | number }>;
  paymentMethodMix: Array<{ method: string; amount: string | number }>;
  appointmentsByDayOfWeek: Array<{ dayOfWeek: string; count: number | string }>;
};

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TOP_SERVICES_SHOWN = 5;

const asNumber = (v: string | number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Resumen (the "Dashboards" charts screen, redesigned): two figures that follow the period, ONE main chart
 * (invoicing, with a 7 / 30 / 90 day period) and everything else folded under "Ver más detalle" as
 * short ranked lists. Tips by professional live in the Propinas screen. Same `/api/dashboard`
 * aggregate as Inicio, asked for the chosen period (`?days=`).
 */
export default function DashboardsPage() {
  const { t, i18n } = useTranslation();
  const locale = getDateLocale(i18n);

  const [days, setDays] = useState<Period>(30);
  const [data, setData] = useState<DashboardsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Keep the previous figures on screen while the next period loads (no spinner flash).
    femmeJson<DashboardsResponse>(`/api/dashboard?days=${days}`, { json: false })
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError(t("femme.dashboard.error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, t]);

  const trend = useMemo(() => (Array.isArray(data?.revenueTrend) ? data!.revenueTrend : []), [data]);
  const total = trendTotal(trend);
  const { buckets, unit } = useMemo(() => revenueBuckets(trend), [trend]);
  const average = buckets.length > 0 ? total / buckets.length : 0;

  const services = useMemo(
    () =>
      (Array.isArray(data?.topServices) ? data!.topServices : [])
        .map((s) => ({ label: s.serviceName, value: asNumber(s.revenue) }))
        .filter((s) => s.value > 0)
        .slice(0, TOP_SERVICES_SHOWN),
    [data],
  );
  const methods = useMemo(
    () =>
      (Array.isArray(data?.paymentMethodMix) ? data!.paymentMethodMix : [])
        .map((m) => ({
          label: t(`femme.billing.invoice.paymentMethod${capitalize(m.method)}`),
          value: asNumber(m.amount),
        }))
        .filter((m) => m.value > 0),
    [data, t],
  );
  const weekdays = useMemo(() => {
    const byDay = new Map(
      (Array.isArray(data?.appointmentsByDayOfWeek) ? data!.appointmentsByDayOfWeek : []).map((d) => [
        d.dayOfWeek,
        asNumber(d.count),
      ]),
    );
    return DAY_KEYS.map((k) => ({
      label: t(`femme.calendar.days.${k}`),
      count: byDay.get(k) ?? 0,
    }));
  }, [data, t]);
  const hasDetail = services.length > 0 || methods.length > 0 || weekdays.some((d) => d.count > 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading as="h1" className="text-2xl">
          {t("femme.dashboardsPage.pageTitle")}
        </Heading>
        <div
          role="tablist"
          aria-label={t("femme.summary.periodLabel")}
          data-tour="summary-period"
          className="grid min-w-[230px] grid-cols-3 gap-1 rounded-2xl bg-primary-lt p-1"
        >
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={days === p}
              data-testid={`summary-period-${p}`}
              onClick={() => setDays(p)}
              className={`min-h-10 rounded-xl text-sm font-bold ${
                days === p ? "bg-surface text-primary shadow" : "text-ink-2"
              }`}
            >
              {t("femme.summary.period", { count: p })}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-3">
          <Spinner size="lg" />
          <Text>{t("femme.dashboard.loading")}</Text>
        </div>
      ) : error && !data ? (
        <Alert variant="destructive" title={t("femme.dashboard.error")}>
          {error}
        </Alert>
      ) : (
        data && (
          <>
            {error && (
              <Alert variant="destructive" title={t("femme.dashboard.error")}>
                {error}
              </Alert>
            )}
            {/* Two figures that follow the selected period. */}
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2" data-testid="summary-kpis">
              <div className="flex flex-col">
                <span className="text-sm text-ink-3" data-testid="summary-kpi-revenue-label">
                  {t("femme.summary.kpiRevenue", { count: days })}
                </span>
                <b className="font-heading text-2xl font-extrabold tabular-nums" data-testid="summary-kpi-revenue">
                  {formatGuaraniesGs(total)}
                </b>
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-ink-3" data-testid="summary-kpi-clients-label">
                  {t("femme.summary.kpiClients", { count: days })}
                </span>
                <b className="font-heading text-2xl font-extrabold tabular-nums" data-testid="summary-kpi-clients">
                  {data.clientsInPeriod ?? 0}
                </b>
              </div>
            </div>

            <Card className={`p-4 sm:p-6 ${loading ? "opacity-70" : ""}`} data-testid="summary-revenue-card">
              <Heading as="h2" className="text-lg">
                {t(unit === "week" ? "femme.summary.revenueTitleWeek" : "femme.summary.revenueTitleDay")}
              </Heading>
              <Text variant="muted" className="text-sm" data-testid="summary-range">
                {t("femme.summary.lastDays", { count: days })}
                {total > 0
                  ? ` · ${t(unit === "week" ? "femme.summary.averageWeek" : "femme.summary.averageDay", {
                      amount: formatGuaraniesGs(average),
                    })}`
                  : ""}
              </Text>
              <RevenueBars buckets={buckets} unit={unit} locale={locale} />
            </Card>

            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls="summary-more"
              data-testid="summary-more-toggle"
              onClick={() => setMoreOpen((o) => !o)}
              className="flex min-h-14 w-full items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left font-heading font-extrabold text-ink shadow-sm sm:px-6"
            >
              {t(moreOpen ? "femme.summary.lessDetail" : "femme.summary.moreDetail")}
              <span aria-hidden className={`text-ink-3 transition-transform ${moreOpen ? "rotate-180" : ""}`}>
                ⌄
              </span>
            </button>
            {moreOpen && (
              <div id="summary-more" className="flex flex-col gap-4" data-testid="summary-more">
                {!hasDetail ? (
                  <Card className="p-4 sm:p-6">
                    <p className="text-ink-3" data-testid="summary-more-empty">
                      {t("femme.summary.noData")}
                    </p>
                  </Card>
                ) : (
                  <>
                    <Card className="flex flex-col gap-4 p-4 sm:p-6">
                      <Heading as="h3" className="text-base">
                        {t("femme.summary.topServices")}
                      </Heading>
                      {services.length === 0 ? (
                        <p className="text-sm text-ink-3">{t("femme.summary.noServices")}</p>
                      ) : (
                        <RankedBars items={services} testId="summary-top-services" />
                      )}
                    </Card>
                    <Card className="flex flex-col gap-4 p-4 sm:p-6">
                      <Heading as="h3" className="text-base">
                        {t("femme.summary.paymentMethods")}
                      </Heading>
                      {methods.length === 0 ? (
                        <p className="text-sm text-ink-3">{t("femme.summary.noPayments")}</p>
                      ) : (
                        <PaymentStack items={methods} testId="summary-payment-methods" />
                      )}
                    </Card>
                    <Card className="flex flex-col gap-4 p-4 sm:p-6">
                      <Heading as="h3" className="text-base">
                        {t("femme.summary.appointmentsByDay")}
                      </Heading>
                      <WeekdayBars items={weekdays} />
                    </Card>
                  </>
                )}
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
