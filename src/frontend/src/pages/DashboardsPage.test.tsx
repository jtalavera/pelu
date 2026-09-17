import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../test/renderWithTour";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import DashboardsPage from "./DashboardsPage";

const femmeJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
}));

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

describe("DashboardsPage revenue trend chart (issue #219)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
  });

  function baseDashboard(
    revenueTrend: Array<{ date: string; invoiced: string | number }>,
    revenueTrendDays = 30,
  ) {
    return {
      revenueTrend,
      revenueTrendDays,
      topServices: [],
    };
  }

  it("shows the empty state when every day in range has zero invoiced revenue", async () => {
    femmeJson.mockResolvedValue(
      baseDashboard([
        { date: "2026-08-01", invoiced: "0" },
        { date: "2026-08-02", invoiced: 0 },
      ]),
    );
    renderPage();
    expect(await screen.findByText("No invoiced revenue in this period yet")).toBeTruthy();
    expect(screen.getByTestId("dashboard-revenue-trend-empty")).toBeTruthy();
  });

  it("renders the chart section (no empty state) once there is invoiced revenue in range", async () => {
    femmeJson.mockResolvedValue(
      baseDashboard([
        { date: "2026-08-01", invoiced: "0" },
        { date: "2026-08-02", invoiced: "150000" },
      ]),
    );
    renderPage();
    expect(await screen.findByTestId("dashboard-revenue-trend")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-revenue-trend-empty")).toBeNull();
  });

  it("still shows the empty state gracefully when revenueTrend is missing entirely (stale build)", async () => {
    femmeJson.mockResolvedValue({});
    renderPage();
    expect(await screen.findByText("No invoiced revenue in this period yet")).toBeTruthy();
  });

  it("uses the server-provided window length in the subtitle copy, not a hardcoded frontend value", async () => {
    femmeJson.mockResolvedValue(baseDashboard([{ date: "2026-08-01", invoiced: "0" }], 45));
    renderPage();
    expect(await screen.findByText("Invoiced revenue over the last 45 days")).toBeTruthy();
  });
});

describe("DashboardsPage top services chart (issue #220)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
  });

  function baseDashboard(
    topServices: Array<{ serviceName: string; revenue: string | number }>,
    revenueTrendDays = 30,
  ) {
    return {
      revenueTrend: [],
      revenueTrendDays,
      topServices,
    };
  }

  it("shows the empty state when there is no service revenue in range", async () => {
    femmeJson.mockResolvedValue(baseDashboard([]));
    renderPage();
    expect(await screen.findByText("No invoiced services in this period yet")).toBeTruthy();
    expect(screen.getByTestId("dashboard-top-services-empty")).toBeTruthy();
  });

  it("renders the chart section (no empty state) once there is service revenue in range", async () => {
    femmeJson.mockResolvedValue(
      baseDashboard([
        { serviceName: "Corte de cabello", revenue: "500000" },
        { serviceName: "Manicura", revenue: "300000" },
      ]),
    );
    renderPage();
    expect(await screen.findByTestId("dashboard-top-services")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-top-services-empty")).toBeNull();
  });

  it("still shows the empty state gracefully when topServices is missing entirely (stale build)", async () => {
    femmeJson.mockResolvedValue({ revenueTrend: [], revenueTrendDays: 30 });
    renderPage();
    expect(await screen.findByText("No invoiced services in this period yet")).toBeTruthy();
  });

  it("uses the server-provided window length in the subtitle copy, not a hardcoded frontend value", async () => {
    femmeJson.mockResolvedValue(
      baseDashboard([{ serviceName: "Corte de cabello", revenue: "500000" }], 45),
    );
    renderPage();
    expect(
      await screen.findByText(
        "Top services by revenue over the last 45 days (excludes custom line items not linked to a catalog service)",
      ),
    ).toBeTruthy();
  });
});

describe("DashboardsPage payment method mix chart (issue #221)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
  });

  function baseDashboard(
    paymentMethodMix: Array<{ method: string; amount: string | number }>,
    revenueTrendDays = 30,
  ) {
    return {
      revenueTrend: [],
      revenueTrendDays,
      topServices: [],
      paymentMethodMix,
    };
  }

  it("shows the empty state when there are no payment allocations in range", async () => {
    femmeJson.mockResolvedValue(baseDashboard([]));
    renderPage();
    expect(await screen.findByText("No invoiced payments in this period yet")).toBeTruthy();
    expect(screen.getByTestId("dashboard-payment-method-mix-empty")).toBeTruthy();
  });

  it("renders the chart section (no empty state) with more than one payment method present, using the shared billing-UI labels", async () => {
    femmeJson.mockResolvedValue(
      baseDashboard([
        { method: "CASH", amount: "500000" },
        { method: "DEBIT_CARD", amount: "300000" },
        { method: "TRANSFER", amount: "150000" },
      ]),
    );
    renderPage();
    expect(await screen.findByTestId("dashboard-payment-method-mix")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-payment-method-mix-empty")).toBeNull();
  });

  it("still shows the empty state gracefully when paymentMethodMix is missing entirely (stale build)", async () => {
    femmeJson.mockResolvedValue({ revenueTrend: [], revenueTrendDays: 30, topServices: [] });
    renderPage();
    expect(await screen.findByText("No invoiced payments in this period yet")).toBeTruthy();
  });

  it("uses the server-provided window length in the subtitle copy, not a hardcoded frontend value", async () => {
    femmeJson.mockResolvedValue(baseDashboard([{ method: "CASH", amount: "500000" }], 45));
    renderPage();
    expect(
      await screen.findByText("Invoiced revenue by payment method over the last 45 days"),
    ).toBeTruthy();
  });
});

describe("DashboardsPage appointments by day of week chart (issue #222)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
  });

  function baseDashboard(
    appointmentsByDayOfWeek: Array<{ dayOfWeek: string; count: number | string }>,
    revenueTrendDays = 30,
  ) {
    return {
      revenueTrend: [],
      revenueTrendDays,
      topServices: [],
      paymentMethodMix: [],
      appointmentsByDayOfWeek,
    };
  }

  const allZero = [
    { dayOfWeek: "mon", count: 0 },
    { dayOfWeek: "tue", count: 0 },
    { dayOfWeek: "wed", count: 0 },
    { dayOfWeek: "thu", count: 0 },
    { dayOfWeek: "fri", count: 0 },
    { dayOfWeek: "sat", count: 0 },
    { dayOfWeek: "sun", count: 0 },
  ];

  it("shows the empty state when every day in range has zero appointments", async () => {
    femmeJson.mockResolvedValue(baseDashboard(allZero));
    renderPage();
    expect(await screen.findByText("No appointments in this period yet")).toBeTruthy();
    expect(screen.getByTestId("dashboard-appointments-by-day-of-week-empty")).toBeTruthy();
  });

  it("renders the chart section (no empty state) once there are appointments in range", async () => {
    femmeJson.mockResolvedValue(
      baseDashboard([
        { dayOfWeek: "mon", count: 3 },
        { dayOfWeek: "tue", count: 0 },
        { dayOfWeek: "wed", count: "2" },
        { dayOfWeek: "thu", count: 0 },
        { dayOfWeek: "fri", count: 1 },
        { dayOfWeek: "sat", count: 0 },
        { dayOfWeek: "sun", count: 0 },
      ]),
    );
    renderPage();
    expect(await screen.findByTestId("dashboard-appointments-by-day-of-week")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-appointments-by-day-of-week-empty")).toBeNull();
  });

  it("still shows the empty state gracefully when appointmentsByDayOfWeek is missing entirely (stale build)", async () => {
    femmeJson.mockResolvedValue({
      revenueTrend: [],
      revenueTrendDays: 30,
      topServices: [],
      paymentMethodMix: [],
    });
    renderPage();
    expect(await screen.findByText("No appointments in this period yet")).toBeTruthy();
  });

  it("uses the server-provided window length in the subtitle copy, not a hardcoded frontend value", async () => {
    femmeJson.mockResolvedValue(baseDashboard(allZero, 45));
    renderPage();
    expect(
      await screen.findByText("Appointment count by day of week over the last 45 days"),
    ).toBeTruthy();
  });
});
