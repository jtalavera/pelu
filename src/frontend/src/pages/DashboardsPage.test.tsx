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
