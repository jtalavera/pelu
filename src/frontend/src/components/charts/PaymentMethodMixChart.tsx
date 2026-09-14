import { useTranslation } from "react-i18next";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { snakeToPascal } from "../invoice/invoiceFormShared";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { ChartCard } from "./ChartCard";
import {
  CHART_AXIS_TEXT_COLOR,
  chartSeriesColor,
  chartTooltipContentStyle,
  chartTooltipLabelStyle,
} from "./chartTheme";

export type PaymentMethodMixPoint = { method: string; amount: string | number };

/**
 * Issue #221 — "Dashboard: gráfico de mezcla de medios de pago": donut chart of invoiced revenue
 * by payment method over the same trailing `days`-day window as the sibling charts (see
 * `DashboardResponse.paymentMethodMix`/`DashboardService.buildPaymentMethodMix`). The backend
 * already includes every `PaymentMethod` actually present in the window (no fixed/hardcoded
 * subset) and orders it by amount descending — this component only maps/renders, same division of
 * responsibility as `RevenueTrendChart`/`TopServicesChart`. Labels reuse the
 * `femme.billing.invoice.paymentMethod*` i18n keys already used to render payment methods
 * elsewhere in the billing UI (`InvoicePaymentsEditor`, `InvoiceDetailModal`, `BillingPage`)
 * instead of duplicating a parallel translation.
 */
export function PaymentMethodMixChart({
  data,
  days,
}: {
  data: PaymentMethodMixPoint[];
  days: number;
}) {
  const { t } = useTranslation();

  const points = data.map((p) => ({
    method: p.method,
    label: t(`femme.billing.invoice.paymentMethod${snakeToPascal(p.method)}`),
    amount: Number(p.amount) || 0,
  }));
  const isEmpty = points.length === 0;

  return (
    <ChartCard
      testId="dashboard-payment-method-mix"
      title={t("femme.dashboard.paymentMethodMixTitle")}
      subtitle={t("femme.dashboard.paymentMethodMixSubtitle", { days })}
      isEmpty={isEmpty}
      emptyMessage={t("femme.dashboard.paymentMethodMixEmpty")}
      height={260}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={points}
            dataKey="amount"
            nameKey="label"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            isAnimationActive={false}
          >
            {points.map((p, i) => (
              <Cell key={p.method} fill={chartSeriesColor(i)} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={chartTooltipContentStyle}
            labelStyle={chartTooltipLabelStyle}
            formatter={(value, name) => [formatGuaraniesGs(Number(value) || 0), String(name)]}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            wrapperStyle={{ fontSize: 11, color: CHART_AXIS_TEXT_COLOR }}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
