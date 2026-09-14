import type { ReactNode } from "react";
import { cardStyle } from "./chartTheme";

/**
 * Issue #219 — "Dashboard: fundamentos de gráficos + tendencia de facturación".
 *
 * Reusable card shell for a dashboard chart section: title/subtitle header, themed card chrome
 * (`cardStyle`, shared with the rest of `DashboardPage.tsx`), and a single fixed-height plot area
 * that both the chart (`children`) and the empty-state message render inside — so a caller
 * specifies `height` exactly once and it can never drift between the two (unlike a caller-owned
 * wrapper `div` around its own `ResponsiveContainer`, which would have to repeat the same number).
 * Intended for every dashboard chart section, including the sibling charts added by issues #220
 * (services sold), #221 (payment-method mix), #222 (appointments by day/hour) and #223 (tips by
 * professional) — each wraps its own recharts chart with this same card so the dashboard's chart
 * sections look and behave consistently.
 */

export type ChartCardProps = {
  title: string;
  subtitle?: string;
  isEmpty: boolean;
  emptyMessage: string;
  testId?: string;
  /** Fixed pixel height of the plot area — applies to both the chart and the empty-state message.
   * Callers pass this straight through to their `ResponsiveContainer` (`height="100%"` on a
   * `height: "100%"` wrapper) rather than repeating the number themselves. */
  height?: number;
  children: ReactNode;
};

export function ChartCard({
  title,
  subtitle,
  isEmpty,
  emptyMessage,
  testId,
  height = 220,
  children,
}: ChartCardProps) {
  return (
    <div data-testid={testId} style={{ ...cardStyle, marginTop: 16, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-ink)" }}>{title}</div>
      <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2, marginBottom: 12 }}>
        {subtitle ?? " "}
      </div>

      <div style={{ width: "100%", minWidth: 0, height }}>
        {isEmpty ? (
          <div
            data-testid={testId ? `${testId}-empty` : undefined}
            style={{
              width: "100%",
              height: "100%",
              fontSize: 12,
              color: "var(--color-ink-3)",
              textAlign: "center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
