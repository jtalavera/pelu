import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "./ChartCard";
import {
  CHART_GRID_COLOR,
  CHART_PRIMARY_COLOR,
  chartAxisTickStyle,
  chartTooltipContentStyle,
  chartTooltipLabelStyle,
} from "./chartTheme";

export type AppointmentsByDayOfWeekPoint = { dayOfWeek: string; count: number | string };

/**
 * Monday-first day-of-week order, matching `DashboardService.buildAppointmentsByDayOfWeek`
 * (`DayOfWeek.values()` is already Monday..Sunday) and the app's existing week-ordering convention
 * (`ProfessionalsPage.tsx`'s `DAYS` array). The backend always returns exactly these 7 keys, but
 * this fixed order is repeated on the frontend defensively (same reasoning as `RevenueTrendChart`
 * zero-filling days) in case of a stale build talking to a differently-ordered response.
 */
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * Issue #222 — "Dashboard: gráfico de turnos por día de semana": bar chart of appointment counts
 * by day of week (business timezone) over the same trailing `days`-day window as the sibling
 * charts (see `DashboardResponse.appointmentsByDayOfWeek`/`DashboardService.
 * buildAppointmentsByDayOfWeek` — counts only `PENDING`/`CONFIRMED`/`IN_PROGRESS`/`COMPLETED`
 * appointments, excluding `CANCELLED`/`NO_SHOW`). Day labels reuse the existing
 * `femme.calendar.days.*` (short, for the axis) and `femme.professionals.days.*` (full, for the
 * tooltip) i18n keys already used elsewhere in the app instead of a duplicate mapping.
 */
export function AppointmentsByDayOfWeekChart({
  data,
  days,
}: {
  data: AppointmentsByDayOfWeekPoint[];
  days: number;
}) {
  const { t } = useTranslation();

  const countByDay = new Map(data.map((p) => [p.dayOfWeek, Number(p.count) || 0]));
  const points = DAY_ORDER.map((key) => ({
    dayOfWeek: key,
    shortLabel: t(`femme.calendar.days.${key}`),
    fullLabel: t(`femme.professionals.days.${key}`),
    count: countByDay.get(key) ?? 0,
  }));
  const isEmpty = points.every((p) => p.count === 0);

  return (
    <ChartCard
      testId="dashboard-appointments-by-day-of-week"
      title={t("femme.dashboard.appointmentsByDayOfWeekTitle")}
      subtitle={t("femme.dashboard.appointmentsByDayOfWeekSubtitle", { days })}
      isEmpty={isEmpty}
      emptyMessage={t("femme.dashboard.appointmentsByDayOfWeekEmpty")}
      height={220}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="shortLabel"
            tick={chartAxisTickStyle}
            tickLine={false}
            axisLine={{ stroke: CHART_GRID_COLOR }}
          />
          <YAxis
            allowDecimals={false}
            tick={chartAxisTickStyle}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={chartTooltipContentStyle}
            labelStyle={chartTooltipLabelStyle}
            labelFormatter={(_, payload) =>
              (payload && payload[0] && (payload[0].payload as { fullLabel?: string }).fullLabel) ??
              ""
            }
            formatter={(value) => [String(value), t("femme.dashboard.appointmentsByDayOfWeekCountLabel")]}
          />
          <Bar
            dataKey="count"
            fill={CHART_PRIMARY_COLOR}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
