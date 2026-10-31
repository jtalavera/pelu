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

  it("asks for the default 30-day period and shows the total and the main chart", async () => {
    femmeJson.mockResolvedValue(dashboard());
    renderPage();
    expect((await screen.findByTestId("summary-revenue-total")).textContent).toMatch(/400\.000/);
    expect(femmeJson).toHaveBeenCalledWith("/api/dashboard?days=30", expect.anything());
    expect(screen.getByTestId("summary-revenue-chart")).toBeTruthy();
    expect(screen.getByTestId("summary-range").textContent).toBe("Last 30 days");
    expect(screen.getByTestId("dashboards-revenue-week").textContent).toMatch(/800\.000/);
    expect(screen.getByTestId("dashboards-clients-month").textContent).toBe("12");
  });

  it("changes the period with the 7 / 30 / 90 day selector", async () => {
    femmeJson.mockImplementation((url: string) =>
      Promise.resolve(dashboard({}, Number(new URL(url, "http://x").searchParams.get("days")))),
    );
    renderPage();
    await screen.findByTestId("summary-revenue-total");
    fireEvent.click(screen.getByTestId("summary-period-7"));
    await waitFor(() =>
      expect(femmeJson).toHaveBeenCalledWith("/api/dashboard?days=7", expect.anything()),
    );
    expect(screen.getByTestId("summary-period-7").getAttribute("aria-selected")).toBe("true");
    expect((await screen.findByTestId("summary-range")).textContent).toBe("Last 7 days");
    fireEvent.click(screen.getByTestId("summary-period-90"));
    await waitFor(() =>
      expect(femmeJson).toHaveBeenCalledWith("/api/dashboard?days=90", expect.anything()),
    );
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
