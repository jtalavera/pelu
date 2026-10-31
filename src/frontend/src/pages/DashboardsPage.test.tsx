import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "../test/renderWithTour";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import DashboardsPage from "./DashboardsPage";

const femmeJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
}));

afterEach(() => cleanup());

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <DashboardsPage />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

function dashboard(over: Record<string, unknown> = {}, days = 30) {
  return {
    revenueWeek: { invoiced: "900000", collected: "800000" },
    clientsThisMonth: 12,
    clientsInPeriod: 7,
    revenueTrend: [
      { date: "2026-08-01", invoiced: "0" },
      { date: "2026-08-02", invoiced: "150000" },
      { date: "2026-08-03", invoiced: "250000" },
    ],
    revenueTrendDays: days,
    topServices: [
      { serviceName: "Coloración", revenue: "400000" },
      { serviceName: "Corte", revenue: "200000" },
    ],
    paymentMethodMix: [
      { method: "CASH", amount: "300000" },
      { method: "CREDIT_CARD", amount: "100000" },
    ],
    appointmentsByDayOfWeek: [
      { dayOfWeek: "mon", count: 2 },
      { dayOfWeek: "tue", count: 0 },
      { dayOfWeek: "wed", count: 0 },
      { dayOfWeek: "thu", count: 0 },
      { dayOfWeek: "fri", count: 5 },
      { dayOfWeek: "sat", count: 9 },
      { dayOfWeek: "sun", count: 0 },
    ],
    ...over,
  };
}

describe("DashboardsPage (Resumen)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
  });

  it("asks for the default 30-day period; the two figures and the chart follow the period", async () => {
    femmeJson.mockResolvedValue(dashboard());
    renderPage();
    expect((await screen.findByTestId("summary-kpi-revenue")).textContent).toMatch(/400\.000/);
    expect(femmeJson).toHaveBeenCalledWith("/api/dashboard?days=30", expect.anything());
    expect(screen.getByTestId("summary-revenue-chart")).toBeTruthy();
    expect(screen.getByTestId("summary-kpi-revenue-label").textContent).toBe("Invoiced in 30 days");
    expect(screen.getByTestId("summary-kpi-clients-label").textContent).toBe("Clients served in 30 days");
    expect(screen.getByTestId("summary-kpi-clients").textContent).toBe("7");
    expect(screen.getByTestId("summary-range").textContent).toMatch(/^Last 30 days · average Gs\. 133\.333 per day$/);
    // The old fixed "this week / this month" figures are gone.
    expect(screen.queryByTestId("dashboards-revenue-week")).toBeNull();
    expect(screen.queryByTestId("dashboards-clients-month")).toBeNull();
  });

  it("changes the period with the 7 / 30 / 90 day selector and the texts below the title follow it", async () => {
    femmeJson.mockImplementation((url: string) =>
      Promise.resolve(dashboard({}, Number(new URL(url, "http://x").searchParams.get("days")))),
    );
    renderPage();
    await screen.findByTestId("summary-kpi-revenue");
    fireEvent.click(screen.getByTestId("summary-period-7"));
    await waitFor(() =>
      expect(femmeJson).toHaveBeenCalledWith("/api/dashboard?days=7", expect.anything()),
    );
    expect(screen.getByTestId("summary-period-7").getAttribute("aria-selected")).toBe("true");
    await waitFor(() =>
      expect(screen.getByTestId("summary-kpi-revenue-label").textContent).toBe("Invoiced in 7 days"),
    );
    expect(screen.getByTestId("summary-kpi-clients-label").textContent).toBe("Clients served in 7 days");
    expect(screen.getByTestId("summary-range").textContent).toMatch(/^Last 7 days/);
    fireEvent.click(screen.getByTestId("summary-period-90"));
    await waitFor(() =>
      expect(femmeJson).toHaveBeenCalledWith("/api/dashboard?days=90", expect.anything()),
    );
    await waitFor(() =>
      expect(screen.getByTestId("summary-kpi-revenue-label").textContent).toBe("Invoiced in 90 days"),
    );
    expect(screen.getByTestId("summary-kpi-clients-label").textContent).toBe("Clients served in 90 days");
  });

  it("groups a 90-day period by week (13 readable bars) and names the best one", async () => {
    const start = new Date(2026, 7, 3);
    const trend = Array.from({ length: 90 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { date: ymd, invoiced: i === 40 ? "500000" : "10000" };
    });
    femmeJson.mockResolvedValue(dashboard({ revenueTrend: trend }, 90));
    renderPage();
    const chart = await screen.findByTestId("summary-revenue-chart");
    expect(chart.querySelectorAll('[data-testid^="summary-bar-2"]')).toHaveLength(13);
    expect(screen.getByRole("heading", { name: /invoicing per week/i })).toBeTruthy();
    expect(screen.getByTestId("summary-bar-tip").textContent).toMatch(/Best week/);
    expect(screen.getByTestId("summary-range").textContent).toMatch(/per week$/);
  });

  it("shows one bar per day for 30 days or less and a tip with the tapped bar", async () => {
    femmeJson.mockResolvedValue(dashboard());
    renderPage();
    const chart = await screen.findByTestId("summary-revenue-chart");
    expect(chart.querySelectorAll('[data-testid^="summary-bar-2"]')).toHaveLength(3);
    expect(screen.getByTestId("summary-bar-tip").textContent).toMatch(/Best day/);
    fireEvent.click(screen.getByTestId("summary-bar-2026-08-02"));
    expect(screen.getByTestId("summary-bar-tip").textContent).toMatch(/150\.000/);
    expect(screen.getByTestId("summary-bar-tip").textContent).not.toMatch(/Best day/);
  });

  it("shows one short line (no chart) when there is no invoicing in the period", async () => {
    femmeJson.mockResolvedValue(
      dashboard({ revenueTrend: [{ date: "2026-08-01", invoiced: "0" }, { date: "2026-08-02", invoiced: 0 }] }),
    );
    renderPage();
    expect(await screen.findByTestId("summary-revenue-empty")).toBeTruthy();
    expect(screen.queryByTestId("summary-revenue-chart")).toBeNull();
  });

  it("still renders gracefully when revenueTrend is missing entirely (stale build)", async () => {
    femmeJson.mockResolvedValue(dashboard({ revenueTrend: undefined }));
    renderPage();
    expect(await screen.findByTestId("summary-revenue-empty")).toBeTruthy();
  });

  it("keeps the detail folded until 'See more detail' is opened", async () => {
    femmeJson.mockResolvedValue(dashboard());
    renderPage();
    const toggle = await screen.findByTestId("summary-more-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("summary-top-services")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("summary-top-services").textContent).toMatch(/Coloración/);
    // Payment methods use the shared billing labels and show each one's share.
    const methods = screen.getByTestId("summary-payment-methods").textContent ?? "";
    // One stacked bar with a legend row per method (not four loose bars).
    expect(screen.getByTestId("summary-payment-methods").querySelectorAll("li")).toHaveLength(2);
    expect(methods).toMatch(/75%/);
    expect(methods).toMatch(/25%/);
    expect(screen.getByTestId("summary-weekday-bars").textContent).toMatch(/9/);
  });

  it("shows a single line in the detail when there is no data at all", async () => {
    femmeJson.mockResolvedValue(
      dashboard({ topServices: [], paymentMethodMix: [], appointmentsByDayOfWeek: [] }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("summary-more-toggle"));
    expect(screen.getByTestId("summary-more-empty")).toBeTruthy();
  });

  it("has no tips section (tips live in the Propinas screen)", async () => {
    femmeJson.mockResolvedValue(dashboard());
    renderPage();
    fireEvent.click(await screen.findByTestId("summary-more-toggle"));
    expect(screen.queryByText(/tips by professional/i)).toBeNull();
  });
});
