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

  function renderChart(points = data) {
    void i18n.changeLanguage("en");
    return render(
      <I18nextProvider i18n={i18n}>
        <RevenueTrendChart data={points} days={points.length} locale="en-US" />
      </I18nextProvider>,
    );
  }

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

  it("does not draw the line (nor list it in the legend) when the window is shorter than a week", () => {
    const { container } = renderChart(data.slice(0, 5));
    expect(container.querySelector(".recharts-line-curve")).toBeNull();
    expect(screen.queryByTestId("dashboard-revenue-trend-end-dot")).toBeNull();
    expect(container.querySelector(".recharts-legend-wrapper")?.textContent).not.toContain("7-day average");
  });
});
