import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { ChartCard } from "./ChartCard";
import {
  CHART_GRID_COLOR,
  CHART_PRIMARY_COLOR,
  CHART_WEEKEND_BG,
  chartAxisTickStyle,
  chartTooltipContentStyle,
  chartTooltipLabelStyle,
} from "./chartTheme";

function isWeekendDate(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

export type RevenueTrendPoint = { date: string; invoiced: string | number };

/**
 * Issue #219 — "Dashboard: fundamentos de gráficos + tendencia de facturación": bar chart of
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
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
    const dayMonth = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(d);
    return `${weekday} ${dayMonth}`;
  };

  // Bands consecutive Saturdays/Sundays into one shaded region each, so a weekend dip in
  // invoicing reads at a glance as expected rather than as an anomaly in the trend.
  const weekendBands = useMemo(() => {
    const bands: Array<{ start: string; end: string }> = [];
    points.forEach((p, i) => {
      if (!isWeekendDate(p.date)) return;
      const prevPoint = points[i - 1];
      const lastBand = bands[bands.length - 1];
      if (lastBand && prevPoint && prevPoint.date === lastBand.end) {
        lastBand.end = p.date;
      } else {
        bands.push({ start: p.date, end: p.date });
      }
    });
    return bands;
  }, [points]);

  return (
    <ChartCard
      testId="dashboard-revenue-trend"
      title={t("femme.dashboard.revenueTrendTitle")}
      subtitle={t("femme.dashboard.revenueTrendSubtitle", { days })}
      isEmpty={!hasRevenue}
      emptyMessage={t("femme.dashboard.revenueTrendEmpty")}
      height={220}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
          {weekendBands.map((band) => (
            <ReferenceArea
              key={`${band.start}-${band.end}`}
              data-testid="dashboard-revenue-trend-weekend-band"
              x1={band.start}
              x2={band.end}
              fill={CHART_WEEKEND_BG}
              fillOpacity={1}
              stroke="none"
              ifOverflow="visible"
            />
          ))}
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
          <Bar
            dataKey="invoiced"
            fill={CHART_PRIMARY_COLOR}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
