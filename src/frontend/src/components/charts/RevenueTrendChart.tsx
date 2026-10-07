import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { ChartCard } from "./ChartCard";
import {
  CHART_AXIS_TEXT_COLOR,
  CHART_BAR_CONTEXT_OPACITY,
  CHART_GRID_COLOR,
  CHART_PRIMARY_COLOR,
  CHART_SURFACE_COLOR,
  CHART_TREND_LINE_COLOR,
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

/** Width of the trailing moving average drawn as the trend line (one full week, so weekday/weekend
 * seasonality cancels out and the line shows the real direction of the business). */
export const TREND_WINDOW_DAYS = 7;

/**
 * Trailing moving average: the value at day `i` is the mean of days `i-window+1 … i`. Days before
 * the first full window are `null` (the line simply starts one week in) instead of averaging a
 * partial window, which would drag the line's start toward a misleading low/high.
 */
export function trailingAverage(values: number[], window: number): Array<number | null> {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += values[j];
    return sum / window;
  });
}

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

  const points = useMemo(() => {
    const daily = data.map((p) => ({ date: p.date, invoiced: Number(p.invoiced) || 0 }));
    const average = trailingAverage(
      daily.map((p) => p.invoiced),
      TREND_WINDOW_DAYS,
    );
    return daily.map((p, i) => ({ ...p, trend: average[i] }));
  }, [data]);
  const hasRevenue = points.some((p) => p.invoiced > 0);
  const lastTrendIndex = points.reduce((last, p, i) => (p.trend != null ? i : last), -1);
  const hasTrend = lastTrendIndex >= 0;

  // Direct label: only the line's last point gets a dot + value (never a number on every point).
  const renderTrendEndDot = (props: {
    cx?: number;
    cy?: number;
    index?: number;
    value?: number | null;
  }): ReactElement => {
    const { cx, cy, index, value } = props;
    if (index !== lastTrendIndex || cx == null || cy == null || value == null) {
      return <g key={`trend-dot-${index}`} />;
    }
    return (
      <g key={`trend-dot-${index}`} data-testid="dashboard-revenue-trend-end-dot">
        <circle cx={cx} cy={cy} r={4} fill={CHART_TREND_LINE_COLOR} stroke={CHART_SURFACE_COLOR} strokeWidth={2} />
        <text
          x={cx}
          y={cy - 10}
          textAnchor="end"
          fontSize={11}
          fontWeight={500}
          fill="var(--color-ink)"
        >
          {formatGuaraniesGs(value)}
        </text>
      </g>
    );
  };

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
      height={250}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 22, right: 8, left: 0, bottom: 0 }}>
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
            cursor={{ fill: CHART_WEEKEND_BG, fillOpacity: 0.7 }}
            // One tooltip lists both series at the hovered day: the day's amount and the 7-day
            // average. Days before the first full week have no average (`null`) → that row is
            // dropped (returning `null` instead of a [value, name] tuple, see recharts'
            // `DefaultTooltipContent`) rather than shown as a bogus "Gs. 0".
            formatter={(value, name) => {
              if (value == null) return null;
              return [
                formatGuaraniesGs(Number(value) || 0),
                name === "trend"
                  ? t("femme.dashboard.revenueTrendLine", { days: TREND_WINDOW_DAYS })
                  : t("femme.dashboard.invoiced"),
              ];
            }}
          />
          <Legend
            verticalAlign="bottom"
            height={28}
            wrapperStyle={{ fontSize: 11, color: CHART_AXIS_TEXT_COLOR }}
            formatter={(value) =>
              value === "trend"
                ? t("femme.dashboard.revenueTrendLine", { days: TREND_WINDOW_DAYS })
                : t("femme.dashboard.invoiced")
            }
          />
          {/* Daily amounts: a recessive tint of the hue, thin bars (≤ 24px), 4px rounded tops. */}
          <Bar
            dataKey="invoiced"
            name="invoiced"
            legendType="rect"
            fill={CHART_PRIMARY_COLOR}
            fillOpacity={CHART_BAR_CONTEXT_OPACITY}
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          {/* Trend = 7-day moving average, same hue at full strength: 2px, round caps, with a
              ringed end dot + value as the one direct label. */}
          {hasTrend ? (
            <Line
              dataKey="trend"
              name="trend"
              legendType="line"
              type="monotone"
              stroke={CHART_TREND_LINE_COLOR}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              connectNulls={false}
              dot={renderTrendEndDot}
              activeDot={{ r: 4, fill: CHART_TREND_LINE_COLOR, stroke: CHART_SURFACE_COLOR, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
