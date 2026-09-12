import { useTranslation } from "react-i18next";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { ChartCard } from "./ChartCard";
import {
  CHART_GRID_COLOR,
  CHART_PRIMARY_COLOR,
  CHART_PRIMARY_COLOR_LIGHT,
  chartAxisTickStyle,
  chartTooltipContentStyle,
  chartTooltipLabelStyle,
} from "./chartTheme";

export type RevenueTrendPoint = { date: string; invoiced: string | number };

/**
 * Issue #219 — "Dashboard: fundamentos de gráficos + tendencia de facturación": area chart of
 * daily invoiced revenue (`ISSUED` invoices) over the trailing `days`-day window the backend
 * returns (`DashboardResponse.revenueTrend`/`revenueTrendDays`, see `DashboardService`). Every
 * point in `data` is expected to already be gap-free (backend fills zero-revenue days), so this
 * component only has to decide whether the *whole* window has zero revenue (→ empty state).
 */
export function RevenueTrendChart({
  data,
  days,
  locale,
}: {
  data: RevenueTrendPoint[];
  days: number;
  locale: string;
}) {
  const { t } = useTranslation();

  const points = data.map((p) => ({ date: p.date, invoiced: Number(p.invoiced) || 0 }));
  const hasRevenue = points.some((p) => p.invoiced > 0);

  const tickFormatter = (value: string) => {
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(d);
  };

  return (
    <ChartCard
      testId="dashboard-revenue-trend"
      title={t("femme.dashboard.revenueTrendTitle")}
      subtitle={t("femme.dashboard.revenueTrendSubtitle", { days })}
      isEmpty={!hasRevenue}
      emptyMessage={t("femme.dashboard.revenueTrendEmpty")}
      height={220}
    >
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="revenueTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_PRIMARY_COLOR} stopOpacity={0.35} />
                <stop offset="95%" stopColor={CHART_PRIMARY_COLOR_LIGHT} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={tickFormatter}
              tick={chartAxisTickStyle}
              tickLine={false}
              axisLine={{ stroke: CHART_GRID_COLOR }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => formatGuaraniesGs(v)}
              tick={chartAxisTickStyle}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <Tooltip
              contentStyle={chartTooltipContentStyle}
              labelStyle={chartTooltipLabelStyle}
              labelFormatter={(value) => tickFormatter(String(value ?? ""))}
              formatter={(value) => [formatGuaraniesGs(Number(value) || 0), t("femme.dashboard.invoiced")]}
            />
            <Area
              type="monotone"
              dataKey="invoiced"
              stroke={CHART_PRIMARY_COLOR}
              strokeWidth={2}
              fill="url(#revenueTrendFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
