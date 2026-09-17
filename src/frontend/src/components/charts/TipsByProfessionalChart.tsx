import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { ChartCard } from "./ChartCard";
import {
  CHART_GRID_COLOR,
  chartAxisTickStyle,
  chartSeriesColor,
  chartTooltipContentStyle,
  chartTooltipLabelStyle,
} from "./chartTheme";

export type TipsByProfessionalPoint = {
  professionalId: number;
  professionalName: string;
  total: string | number;
};

/**
 * Issue #223 — "Dashboard: gráfico de propinas por profesional": horizontal bar chart of tip
 * totals per professional over the same trailing `days`-day window as the sibling dashboard charts
 * (issues #219-#222).
 *
 * Unlike those charts, this data does NOT come from `GET /api/dashboard` — this issue explicitly
 * does not add any new backend aggregation. `DashboardsPage.tsx` instead calls the already-existing
 * `GET /api/propinas/report` endpoint (`TipsController`/`TipsService`, already used by
 * `PropinasPage.tsx`'s own report tab) with a client-computed equivalent of the same trailing
 * window (see `DashboardsPage.tsx`'s `tipsWindowRangeIso`). `data` is
 * `TipReportResponse.professionalTotals` as-is — already ordered by professional full name
 * ascending (`ServiceRecordTipRepository.findForReport`'s deterministic `ORDER BY p.fullName ASC`)
 * — this component only maps/renders, same division of responsibility as `TopServicesChart`
 * (issue #220), which this most closely resembles (a horizontal bar chart of a monetary total per
 * named entity).
 */
export function TipsByProfessionalChart({
  data,
  days,
}: {
  data: TipsByProfessionalPoint[];
  days: number;
}) {
  const { t } = useTranslation();

  const points = data.map((p) => ({
    professionalId: p.professionalId,
    professionalName: p.professionalName,
    total: Number(p.total) || 0,
  }));
  const isEmpty = points.length === 0;

  // Taller for more bars, but bounded so the card doesn't dominate the dashboard — same sizing rule
  // as `TopServicesChart`.
  const height = Math.min(360, Math.max(180, points.length * 36 + 40));

  return (
    <ChartCard
      testId="dashboard-tips-by-professional"
      title={t("femme.dashboard.tipsByProfessionalTitle")}
      subtitle={t("femme.dashboard.tipsByProfessionalSubtitle", { days })}
      isEmpty={isEmpty}
      emptyMessage={t("femme.dashboard.tipsByProfessionalEmpty")}
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
            dataKey="professionalName"
            tick={chartAxisTickStyle}
            tickLine={false}
            axisLine={false}
            width={120}
          />
          <Tooltip
            contentStyle={chartTooltipContentStyle}
            labelStyle={chartTooltipLabelStyle}
            formatter={(value) => [
              formatGuaraniesGs(Number(value) || 0),
              t("femme.dashboard.tipsByProfessionalValueLabel"),
            ]}
          />
          <Bar dataKey="total" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {points.map((p, i) => (
              <Cell key={p.professionalId} fill={chartSeriesColor(i)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
