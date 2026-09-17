import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";
import { RevenueTrendChart } from "../components/charts/RevenueTrendChart";
import { TopServicesChart } from "../components/charts/TopServicesChart";
import { PaymentMethodMixChart } from "../components/charts/PaymentMethodMixChart";
import { AppointmentsByDayOfWeekChart } from "../components/charts/AppointmentsByDayOfWeekChart";
import { getDateLocale } from "../i18n/dateLocale";

type DashboardsResponse = {
  revenueTrend: Array<{ date: string; invoiced: string | number }>;
  revenueTrendDays: number;
  topServices: Array<{ serviceName: string; revenue: string | number }>;
  paymentMethodMix: Array<{ method: string; amount: string | number }>;
  appointmentsByDayOfWeek: Array<{ dayOfWeek: string; count: number | string }>;
};

/**
 * Issue #220 follow-up — "Dashboards": dedicated screen for the dashboard's charts (revenue trend,
 * top services, payment method mix, appointments by day of week), split out of `DashboardPage.tsx`
 * so the main panel stays focused on today's operational snapshot. Reuses the same
 * `/api/dashboard` aggregate the main dashboard fetches — the chart data (`revenueTrend`/
 * `revenueTrendDays`/`topServices`/`paymentMethodMix`/`appointmentsByDayOfWeek`) already lives
 * there.
 */
export default function DashboardsPage() {
  const { t, i18n } = useTranslation();
  const locale = getDateLocale(i18n);

  const [data, setData] = useState<DashboardsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    femmeJson<DashboardsResponse>("/api/dashboard", { json: false })
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
  }, [t]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-ink)" }}>
          {t("femme.dashboardsPage.pageTitle")}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
          {t("femme.dashboardsPage.pageSubtitle")}
        </div>
      </div>

      {loading ? (
        <div
          style={{
            display: "flex",
            minHeight: "40vh",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          <Spinner size="lg" />
          <Text>{t("femme.dashboard.loading")}</Text>
        </div>
      ) : error || !data ? (
        <Alert variant="destructive" title={t("femme.dashboard.error")}>
          {error}
        </Alert>
      ) : (
        <>
          <RevenueTrendChart
            data={Array.isArray(data.revenueTrend) ? data.revenueTrend : []}
            days={data.revenueTrendDays ?? 30}
            locale={locale}
          />
          <TopServicesChart
            data={Array.isArray(data.topServices) ? data.topServices : []}
            days={data.revenueTrendDays ?? 30}
          />
          <PaymentMethodMixChart
            data={Array.isArray(data.paymentMethodMix) ? data.paymentMethodMix : []}
            days={data.revenueTrendDays ?? 30}
          />
          <AppointmentsByDayOfWeekChart
            data={Array.isArray(data.appointmentsByDayOfWeek) ? data.appointmentsByDayOfWeek : []}
            days={data.revenueTrendDays ?? 30}
          />
        </>
      )}
    </div>
  );
}
