import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { ChartCard } from "./ChartCard";
import {
  CHART_GRID_COLOR,
  chartAxisTickStyle,
  chartSeriesColorPastel,
  chartTooltipContentStyle,
  chartTooltipLabelStyle,
} from "./chartTheme";

export type TopServicePoint = { serviceName: string; revenue: string | number };

/**
 * Issue #220 — "Dashboard: gráfico de servicios más vendidos": horizontal bar chart of the top
 * services by invoiced (`ISSUED`) revenue over the trailing `days`-day window the backend returns
 * (`DashboardResponse.topServices`, same window as `revenueTrend` — see `DashboardService`). The
 * backend already orders/caps the list (top `DashboardService.TOP_SERVICES_LIMIT` descending), so
 * this component only maps/renders — same division of responsibility as `RevenueTrendChart`.
 */
export function TopServicesChart({ data, days }: { data: TopServicePoint[]; days: number }) {
  const { t } = useTranslation();

  const points = data.map((p) => ({
    serviceName: p.serviceName,
    revenue: Number(p.revenue) || 0,
  }));
  const isEmpty = points.length === 0;

  // Taller for more bars, but bounded so the card doesn't dominate the dashboard.
  const height = Math.min(360, Math.max(180, points.length * 36 + 40));

  return (
    <ChartCard
      testId="dashboard-top-services"
      title={t("femme.dashboard.topServicesTitle")}
      subtitle={t("femme.dashboard.topServicesSubtitle", { days })}
      isEmpty={isEmpty}
      emptyMessage={t("femme.dashboard.topServicesEmpty")}
      height={height}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={points}
          layout="vertical"
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke={CHART_GRID_COLOR} horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatGuaraniesGs(v)}
            tick={chartAxisTickStyle}
            tickLine={false}
            axisLine={{ stroke: CHART_GRID_COLOR }}
          />
          <YAxis
            type="category"
            dataKey="serviceName"
            tick={chartAxisTickStyle}
            tickLine={false}
            axisLine={false}
            width={120}
          />
          <Tooltip
            contentStyle={chartTooltipContentStyle}
            labelStyle={chartTooltipLabelStyle}
            formatter={(value) => [formatGuaraniesGs(Number(value) || 0), t("femme.dashboard.invoiced")]}
          />
          <Bar dataKey="revenue" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {points.map((p, i) => (
              <Cell key={p.serviceName} fill={chartSeriesColorPastel(i)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
