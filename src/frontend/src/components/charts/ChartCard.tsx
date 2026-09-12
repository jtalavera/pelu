import type { ReactNode } from "react";

/**
 * Issue #219 — "Dashboard: fundamentos de gráficos + tendencia de facturación".
 *
 * Reusable card shell for a dashboard chart section: title/subtitle header, themed card chrome
 * matching the rest of `DashboardPage.tsx` (`cardStyle`), and a uniform empty-state message when
 * `isEmpty` is true — so a chart with no data in range renders a friendly message instead of an
 * empty/degenerate chart. Intended for every dashboard chart section, including the sibling charts
 * added by issues #220 (services sold), #221 (payment-method mix), #222 (appointments by
 * day/hour) and #223 (tips by professional) — each wraps its own recharts chart with this same
 * card so the dashboard's chart sections look and behave consistently.
 */

const cardStyle: React.CSSProperties = {
  background: "var(--color-white)",
  borderRadius: "var(--radius-xl)",
  border: "var(--border-default)",
  padding: 16,
};

export type ChartCardProps = {
  title: string;
  subtitle?: string;
  isEmpty: boolean;
  emptyMessage: string;
  testId?: string;
  /** Fixed pixel height for the chart's plot area (passed straight to recharts' ResponsiveContainer
   * by the caller) — kept here only as a prop so callers size their empty-state message the same. */
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
        {subtitle ?? " "}
      </div>

      {isEmpty ? (
        <div
          data-testid={testId ? `${testId}-empty` : undefined}
          style={{
            fontSize: 12,
            color: "var(--color-ink-3)",
            padding: "24px 0",
            textAlign: "center",
            minHeight: height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {emptyMessage}
        </div>
      ) : (
        <div style={{ width: "100%", minWidth: 0 }}>{children}</div>
      )}
    </div>
  );
}
