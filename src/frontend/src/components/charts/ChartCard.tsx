import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconChevronRight } from "@design-system";
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
 *
 * The header also doubles as an accordion-style collapse toggle (issue #224 dashboard layout
 * pass), so a user can close the charts they don't care about and leave the rest open — defaults
 * to expanded so every existing test asserting a chart's content is visible on load keeps passing.
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  return (
    <div data-testid={testId} style={{ ...cardStyle, minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t(open ? "femme.dashboard.collapseChart" : "femme.dashboard.expandChart", {
          title,
        })}
        style={{
          display: "flex",
          width: "100%",
          minHeight: 44,
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--color-ink)" }}>
            {title}
          </span>
          <span style={{ display: "block", fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
            {subtitle ?? " "}
          </span>
        </span>
        <IconChevronRight
          style={{
            color: "var(--color-ink-3)",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        />
      </button>

      {open && (
        <div style={{ width: "100%", minWidth: 0, height, marginTop: 12 }}>
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
      )}
    </div>
  );
}
