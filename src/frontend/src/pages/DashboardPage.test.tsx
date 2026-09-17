import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import DashboardPage from "./DashboardPage";
import { listAppointments } from "../api/appointments";

const femmeJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
}));

vi.mock("../api/appointments", () => ({
  listAppointments: vi.fn(() => Promise.resolve([])),
}));

const listAppointmentsMock = vi.mocked(listAppointments);

// DashboardPage polls on an interval and re-fetches when `t` (i18next) identity changes; without
// unmounting between tests, a still-mounted instance from an earlier test can re-fetch mid-test
// using whatever the shared `femmeJson` mock happens to be at that moment (e.g. freshly
// `mockReset()` by the next test's `beforeEach`, before its own `mockResolvedValue` is set),
// leaking a second, differently-stated `<DashboardPage>` tree into `document.body` and breaking
// `getByText`/`getByTestId` uniqueness assertions in whichever test runs next. Explicit cleanup
// (this file doesn't rely on RTL's automatic afterEach hook) avoids that cross-test pollution.
afterEach(() => {
  cleanup();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <DashboardPage />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

describe("DashboardPage fiscal alerts (HU-02b)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    listAppointmentsMock.mockClear();
    femmeJson.mockReset();
    femmeJson.mockResolvedValue({
      appointmentsToday: {
        total: 0,
        pending: 0,
        confirmed: 0,
        inProgress: 0,
        completed: 0,
      },
      revenueDay: { invoiced: "0", collected: "0" },
      revenueWeek: { invoiced: "0", collected: "0" },
      clientsThisMonth: 0,
      fiscalAlerts: [
        {
          severity: "warning",
          messageKey: "fiscalExpiredOrExhausted",
          message: "fallback",
        },
      ],
      inactiveClients: [],
      inactiveClientsThresholdDays: 60,
    });
  });

  it("shows fiscal warning when a non-blocking fiscal alert is present", async () => {
    renderPage();
    expect(
      await screen.findByText(/fiscal stamp is expired/i),
    ).toBeTruthy();
  });

  it("requests today appointments with ISO-8601 day range (not bare date)", async () => {
    renderPage();
    await waitFor(() => {
      expect(listAppointmentsMock).toHaveBeenCalled();
    });
    const [from, to] = listAppointmentsMock.mock.calls[0] ?? [];
    expect(typeof from).toBe("string");
    expect(typeof to).toBe("string");
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(from < to).toBe(true);
  });

  it("formats revenue amounts with Gs. prefix and grouping", async () => {
    femmeJson.mockResolvedValue({
      appointmentsToday: {
        total: 0,
        pending: 0,
        confirmed: 0,
        inProgress: 0,
        completed: 0,
      },
      revenueDay: { invoiced: "1234567", collected: "890000" },
      revenueWeek: { invoiced: "0", collected: "0" },
      clientsThisMonth: 1284,
      fiscalAlerts: [],
      inactiveClients: [],
      inactiveClientsThresholdDays: 60,
    });
    renderPage();
    expect(await screen.findByText(/^Gs\.[\s\u00a0]*890/)).toBeTruthy();
    expect(screen.getByText(/^1,284$/)).toBeTruthy();
  });
});

describe("DashboardPage inactive clients widget (issue #216)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    listAppointmentsMock.mockClear();
    femmeJson.mockReset();
  });

  function baseDashboard(inactiveClients: unknown[], inactiveClientsThresholdDays = 60) {
    return {
      appointmentsToday: { total: 0, pending: 0, confirmed: 0, inProgress: 0, completed: 0 },
      revenueDay: { invoiced: "0", collected: "0" },
      revenueWeek: { invoiced: "0", collected: "0" },
      clientsThisMonth: 0,
      fiscalAlerts: [],
      inactiveClients,
      inactiveClientsThresholdDays,
    };
  }

  it("shows the empty state when there are no inactive clients", async () => {
    femmeJson.mockResolvedValue(baseDashboard([]));
    renderPage();
    expect(await screen.findByText("No inactive clients right now")).toBeTruthy();
  });

  it("renders name, phone and days of inactivity for each inactive client, in server order", async () => {
    femmeJson.mockResolvedValue(
      baseDashboard([
        {
          clientId: 1,
          fullName: "Ana Long Gone",
          phone: "0981000001",
          daysSinceLastVisit: 200,
          lastVisitAt: "2026-01-01T00:00:00Z",
        },
        {
          clientId: 2,
          fullName: "Carla Also Gone",
          phone: "0981000002",
          daysSinceLastVisit: 95,
          lastVisitAt: "2026-05-01T00:00:00Z",
        },
      ]),
    );
    renderPage();

    const rows = await screen.findAllByTestId("dashboard-inactive-client-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Ana Long Gone");
    expect(rows[0].textContent).toContain("0981000001");
    expect(rows[0].textContent).toContain("200 days");
    expect(rows[1].textContent).toContain("Carla Also Gone");
    expect(rows[1].textContent).toContain("95 days");
  });

  it("shows a 'View all' button linking to the full inactive-clients page when there are results", async () => {
    femmeJson.mockResolvedValue(
      baseDashboard([
        {
          clientId: 1,
          fullName: "Ana Long Gone",
          phone: "0981000001",
          daysSinceLastVisit: 200,
          lastVisitAt: "2026-01-01T00:00:00Z",
        },
      ]),
    );
    renderPage();
    expect(await screen.findByTestId("dashboard-inactive-clients-view-all")).toBeTruthy();
  });

  it("uses the server-provided threshold in the subtitle copy, not a hardcoded frontend value", async () => {
    femmeJson.mockResolvedValue(baseDashboard([], 45));
    renderPage();
    expect(
      await screen.findByText("Active clients with no completed visit in the last 45 days"),
    ).toBeTruthy();
  });
});
