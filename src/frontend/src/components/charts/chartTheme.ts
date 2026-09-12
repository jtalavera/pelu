import type { CSSProperties } from "react";

/**
 * Issue #219 — "Dashboard: fundamentos de gráficos + tendencia de facturación".
 *
 * Shared recharts theming for every dashboard chart (this issue's revenue trend, plus the sibling
 * charts issues #220-#223 add: services sold, payment-method mix, appointments by day/hour, tips by
 * professional). Every value here is a `var(--color-*)` string from `src/styles/tokens.css` — never
 * a hardcoded hex — so charts repaint automatically with the design-system's light/dark theme
 * switch, exactly like the rest of the app (see `DashboardPage.tsx`'s inline styles). Recharts'
 * `stroke`/`fill`/etc. props accept CSS variable strings directly, so no `getComputedStyle` /
 * theme-context plumbing is needed here.
 */

/**
 * Categorical palette for multi-series charts (e.g. a pie/bar chart with one slice per payment
 * method or per professional) — the "Acentos de categoría" tokens, in a stable order. Single-series
 * charts (like the revenue-trend area chart below) use `CHART_PRIMARY_COLOR` instead.
 */
export const CHART_SERIES_COLORS = [
  "var(--color-rose)",
  "var(--color-mauve)",
  "var(--color-coral)",
  "var(--color-fuchsia)",
  "var(--color-violet)",
  "var(--color-indigo)",
  "var(--color-sky)",
  "var(--color-teal)",
  "var(--color-lime)",
  "var(--color-amber)",
] as const;

/** Picks a stable categorical color by series index, wrapping around the palette. */
export function chartSeriesColor(index: number): string {
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length];
}

/** Primary accent for a single-series chart (matches the "revenue" metric cards elsewhere). */
export const CHART_PRIMARY_COLOR = "var(--color-rose)";
export const CHART_PRIMARY_COLOR_LIGHT = "var(--color-rose-lt)";

/** Gridlines, axes and tooltip chrome — neutral tokens shared by every chart. */
export const CHART_GRID_COLOR = "var(--color-stone-md)";
export const CHART_AXIS_TEXT_COLOR = "var(--color-ink-3)";
export const CHART_TOOLTIP_BACKGROUND = "var(--color-white)";
export const CHART_TOOLTIP_BORDER_COLOR = "var(--color-stone-md)";
export const CHART_TOOLTIP_TEXT_COLOR = "var(--color-ink)";

/** Shared axis tick text style (matches the rest of the dashboard's 10-11px muted labels). */
export const chartAxisTickStyle = { fontSize: 10, fill: CHART_AXIS_TEXT_COLOR } as const;

/** Shared recharts `<Tooltip contentStyle={...}>` — themed card matching `cardStyle` elsewhere. */
export const chartTooltipContentStyle: CSSProperties = {
  background: CHART_TOOLTIP_BACKGROUND,
  border: `0.5px solid ${CHART_TOOLTIP_BORDER_COLOR}`,
  borderRadius: "var(--radius-md)",
  fontSize: 11,
  color: CHART_TOOLTIP_TEXT_COLOR,
  padding: "6px 10px",
};

export const chartTooltipLabelStyle: CSSProperties = {
  color: CHART_AXIS_TEXT_COLOR,
  marginBottom: 2,
};

/**
 * Shared card chrome for every `DashboardPage.tsx` section — metrics, mini calendar, occupancy,
 * service records, inactive clients, and every `ChartCard` (this issue's revenue trend plus
 * issues #220-#223's charts). Single source of truth: `DashboardPage.tsx` and `ChartCard.tsx` both
 * import this instead of each keeping their own byte-for-byte copy, so a future palette/radius
 * tweak only ever needs to change here.
 */
export const cardStyle: CSSProperties = {
  background: "var(--color-white)",
  borderRadius: "var(--radius-xl)",
  border: "var(--border-default)",
  padding: 16,
};
