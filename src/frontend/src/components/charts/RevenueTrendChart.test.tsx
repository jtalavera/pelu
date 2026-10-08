import { cloneElement, type ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { RevenueTrendChart, TREND_WINDOW_DAYS, trailingAverage } from "./RevenueTrendChart";

// jsdom has no layout, so ResponsiveContainer would render a 0×0 chart: hand the chart a fixed size.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 700, height: 250 } as Record<string, unknown>),
  };
});

describe("trailingAverage (revenue trend line)", () => {
  it("uses a one-week window", () => {
    expect(TREND_WINDOW_DAYS).toBe(7);
  });

  it("is null until the first full window, then the mean of the last N values", () => {
    const result = trailingAverage([10, 20, 30, 40, 50], 3);
    expect(result).toEqual([null, null, 20, 30, 40]);
  });

  it("averages zero-revenue days too (they are real days with no invoicing)", () => {
    expect(trailingAverage([0, 0, 90, 0], 3)).toEqual([null, null, 30, 30]);
  });

  it("is all null when there are fewer points than the window (the line is not drawn)", () => {
    expect(trailingAverage([1, 2, 3], 7)).toEqual([null, null, null]);
    expect(trailingAverage([], 7)).toEqual([]);
  });
});

describe("RevenueTrendChart rendering", () => {
  afterEach(() => cleanup());

  /** 14 consecutive days (2026-09-01 …), 100.000 Gs. each except the last one at 240.000. */
  const data = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    invoiced: i === 13 ? 240000 : 100000,
  }));

  function renderChart(points = data, lookback: typeof data = []) {
    void i18n.changeLanguage("en");
    return render(
      <I18nextProvider i18n={i18n}>
        <RevenueTrendChart data={points} lookback={lookback} days={points.length} locale="en-US" />
      </I18nextProvider>,
    );
  }

  /** The 6 days right before `data` (2026-08-26 … 2026-08-31), 100.000 Gs. each. */
  const lookback = Array.from({ length: 6 }, (_, i) => ({
    date: `2026-08-${String(26 + i)}`,
    invoiced: 100000,
  }));

  it("draws the trend as a 2px line in the full hue over recessive same-hue bars", () => {
    const { container } = renderChart();
    const line = container.querySelector(".recharts-line-curve");
    expect(line?.getAttribute("stroke")).toBe("var(--color-teal)");
    expect(line?.getAttribute("stroke-width")).toBe("2");
    const bar = container.querySelector(".recharts-bar-rectangle path");
    expect(bar?.getAttribute("fill")).toBe("var(--color-teal)");
    expect(bar?.getAttribute("fill-opacity")).toBe("0.55");
  });

  it("labels only the line's last point (ringed dot + value) and names the 7-day average in the legend", () => {
    const { container } = renderChart();
    const endDots = screen.getAllByTestId("dashboard-revenue-trend-end-dot");
    expect(endDots).toHaveLength(1);
    // Mean of the last 7 days: six at 100.000 and one at 240.000 → 120.000.
    expect(endDots[0].querySelector("text")?.textContent).toBe("Gs. 120.000");
    expect(endDots[0].querySelector("circle")?.getAttribute("stroke")).toBe("var(--color-white)");
    const legend = container.querySelector(".recharts-legend-wrapper");
    expect(legend?.textContent).toContain("Invoiced");
    expect(legend?.textContent).toContain("7-day average");
  });

  /** X where the trend line starts, and X of the left edge of the first plotted bar. */
  function lineStartAndFirstBarX(container: HTMLElement) {
    const lineD = container.querySelector(".recharts-line-curve")?.getAttribute("d") ?? "";
    const barD = container.querySelector(".recharts-bar-rectangle path")?.getAttribute("d") ?? "";
    return {
      lineStartX: Number(/^M\s*([\d.]+)/.exec(lineD)?.[1]),
      firstBarX: Number(/^M\s*([\d.]+)/.exec(barD)?.[1]),
    };
  }

  it("with the backend's lookback days the line starts on the first plotted day (no one-week gap)", () => {
    const { container } = renderChart(data, lookback);
    const { lineStartX, firstBarX } = lineStartAndFirstBarX(container);
    // The first bar is ≤ 24px wide and starts at firstBarX: the line starts over it.
    expect(lineStartX).toBeGreaterThanOrEqual(firstBarX);
    expect(lineStartX).toBeLessThanOrEqual(firstBarX + 24);
    // The lookback days are context only: not drawn as bars (14 bars, not 20).
    expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBe(data.length);
  });

  it("without lookback (older backend) the line still starts once a full week is available", () => {
    const { container } = renderChart(data);
    const { lineStartX, firstBarX } = lineStartAndFirstBarX(container);
    // Starts over the 7th bar, far to the right of the first one.
    expect(lineStartX).toBeGreaterThan(firstBarX + 200);
  });

  // Issue #284: days without invoicing must be visible (not just an invisible 0-height bar) and
  // still count in the 7-day average.
  it("marks every day with no invoicing on the baseline and lists it in the legend", () => {
    const withGaps = data.map((p, i) => (i === 2 || i === 3 || i === 9 ? { ...p, invoiced: 0 } : p));
    const { container } = renderChart(withGaps);
    const markers = screen.getAllByTestId("dashboard-revenue-trend-zero-day");
    expect(markers.map((m) => m.getAttribute("data-date"))).toEqual([
      "2026-09-03",
      "2026-09-04",
      "2026-09-10",
    ]);
    expect(container.querySelector(".recharts-legend-wrapper")?.textContent).toContain("No invoicing");
  });

  it("does not draw zero-day markers (nor the legend entry) when every day has invoicing", () => {
    const { container } = renderChart();
    expect(screen.queryAllByTestId("dashboard-revenue-trend-zero-day")).toHaveLength(0);
    expect(container.querySelector(".recharts-legend-wrapper")?.textContent).not.toContain("No invoicing");
  });

  it("the zero days lower the 7-day average (last point = mean including the zeros)", () => {
    // Last 7 days: 100k, 0, 0, 100k, 100k, 100k, 240k → mean 91.428,57… → Gs. 91.429
    const withGaps = data.map((p, i) => (i === 8 || i === 9 ? { ...p, invoiced: 0 } : p));
    renderChart(withGaps);
    const endDot = screen.getByTestId("dashboard-revenue-trend-end-dot");
    expect(endDot.querySelector("text")?.textContent).toBe("Gs. 91.429");
  });

  it("does not draw the line (nor list it in the legend) when the window is shorter than a week", () => {
    const { container } = renderChart(data.slice(0, 5));
    expect(container.querySelector(".recharts-line-curve")).toBeNull();
    expect(screen.queryByTestId("dashboard-revenue-trend-end-dot")).toBeNull();
    expect(container.querySelector(".recharts-legend-wrapper")?.textContent).not.toContain("7-day average");
  });
});
