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
 * method or per professional). Restricted to the muted teal (green) and dusty-rose tokens rather
 * than the full "Acentos de categoría" set — a deliberate toning-down so dashboard charts read as
 * calm/analytical rather than a rainbow of bright accents. Alternates hue (green/rose) at each step
 * for adjacent-category contrast; 5 entries covers every current use (max 5 `PaymentMethod` values).
 * Single-series charts (like the revenue-trend bar chart below) use `CHART_PRIMARY_COLOR` instead.
 */
export const CHART_SERIES_COLORS = [
  "var(--color-teal)",
  "var(--color-rose)",
  "var(--color-teal-md)",
  "var(--color-rose-md)",
  "var(--color-rose-dk)",
] as const;

/** Picks a stable categorical color by series index, wrapping around the palette. */
export function chartSeriesColor(index: number): string {
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length];
}

/**
 * Lighter, softer tier of the same muted green/rose hues — for charts where a pastel look reads
 * better than `CHART_SERIES_COLORS`, such as `TopServicesChart`'s bars (no color-matched legend, so
 * fewer distinct tones is fine).
 */
export const CHART_SERIES_COLORS_PASTEL = ["var(--color-rose-md)", "var(--color-teal-md)"] as const;

/** Picks a stable pastel categorical color by series index, wrapping around the palette. */
export function chartSeriesColorPastel(index: number): string {
  return CHART_SERIES_COLORS_PASTEL[index % CHART_SERIES_COLORS_PASTEL.length];
}

/** Primary accent for a single-series chart (muted green — calmer than the bold brand pink). */
export const CHART_PRIMARY_COLOR = "var(--color-teal)";
export const CHART_PRIMARY_COLOR_LIGHT = "var(--color-teal-lt)";

/** Gridlines, axes and tooltip chrome — neutral tokens shared by every chart. */
export const CHART_GRID_COLOR = "var(--color-stone-md)";
/** Weekend-day background band on a date-axis chart (e.g. revenue trend) — a neutral tint distinct
 * from `CHART_GRID_COLOR` so it doesn't read as an extra gridline. */
export const CHART_WEEKEND_BG = "var(--color-stone)";
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
