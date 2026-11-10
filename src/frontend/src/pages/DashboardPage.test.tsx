import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "../test/renderWithTour";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import DashboardPage from "./DashboardPage";
import { listAppointments, type AppointmentStatus } from "../api/appointments";

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
    // Billing redesign: Inicio shows a one-line summary; week/month totals live in Dashboards.
    expect((await screen.findByTestId("dashboard-summary-collected")).textContent).toMatch(
      /^Gs\.[\s\u00a0]*890.*collected$/,
    );
    expect(screen.queryByText(/^1,284$/)).toBeNull();
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
    fireEvent.click(await screen.findByTestId("dashboard-more-inactive"));
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
    fireEvent.click(await screen.findByTestId("dashboard-more-inactive"));

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
    fireEvent.click(await screen.findByTestId("dashboard-more-inactive"));
    expect(await screen.findByTestId("dashboard-inactive-clients-view-all")).toBeTruthy();
  });

  it("uses the server-provided threshold in the subtitle copy, not a hardcoded frontend value", async () => {
    femmeJson.mockResolvedValue(baseDashboard([], 45));
    renderPage();
    fireEvent.click(await screen.findByTestId("dashboard-more-inactive"));
    expect(
      await screen.findByText("Active clients with no completed visit in the last 45 days"),
    ).toBeTruthy();
  });
});

describe("DashboardPage · Turnos de hoy (por atender o cobrar, cobrados plegados)", () => {
  const todayAt = (hour: number) => {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const appt = (id: number, hour: number, name: string, status: AppointmentStatus, invoiceId: number | null) => ({
    id,
    clientId: id,
    clientName: name,
    professionalId: 3,
    professionalName: "Maria",
    serviceId: 11,
    serviceName: "SPA DE PIES",
    durationMinutes: 60,
    startAt: todayAt(hour),
    endAt: todayAt(hour + 1),
    status,
    cancelReason: null,
    reminderSentAt: null,
    serviceRecordId: null,
    invoiceId,
  });

  beforeEach(() => {
    void i18n.changeLanguage("en");
    listAppointmentsMock.mockReset();
    femmeJson.mockReset();
    femmeJson.mockResolvedValue({
      appointmentsToday: { total: 4, pending: 1, confirmed: 0, inProgress: 1, completed: 2 },
      revenueDay: { invoiced: "0", collected: "0" },
      revenueWeek: { invoiced: "0", collected: "0" },
      clientsThisMonth: 0,
      fiscalAlerts: [],
      inactiveClients: [],
      inactiveClientsThresholdDays: 60,
    });
    listAppointmentsMock.mockResolvedValue([
      appt(1, 8, "ANA DUARTE", "COMPLETED", 501), // charged
      appt(2, 9, "PEDRO LÓPEZ", "COMPLETED", null), // completed, not charged yet
      appt(3, 10, "TANIA NUÑEZ Z", "IN_PROGRESS", null),
      appt(4, 12, "LUCÍA GÓMEZ", "PENDING", null),
    ]);
  });

  it("keeps what is still to attend or charge on view and folds only the charged ones", async () => {
    renderPage();
    await screen.findAllByTestId("dashboard-appointment-row");
    const rows = screen.getAllByTestId("dashboard-appointment-row").map((r) => r.textContent ?? "");
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.includes("ANA DUARTE"))).toBe(false);
    // The completed one without a comprobante stays visible, marked as not charged.
    const pedro = screen.getAllByTestId("dashboard-appointment-row").find((r) => r.textContent?.includes("PEDRO"));
    expect(pedro?.querySelector('[data-testid="dashboard-appointment-uncharged-tag"]')?.textContent).toContain("not charged");
    // The title counts what is on view; the fold counts the charged ones.
    expect(screen.getByTestId("dashboard-appointments-count").textContent).toBe("3");
    expect(screen.getByTestId("dashboard-appointments-charged-count").textContent).toBe("1");
  });

  it("the «Charged» fold opens to show the charged turnos with their mark", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("dashboard-appointments-charged-toggle"));
    const list = await screen.findByTestId("dashboard-appointments-charged-list");
    expect(list.textContent).toContain("ANA DUARTE");
    expect(list.querySelector('[data-testid="dashboard-appointment-charged-tag"]')?.textContent).toContain("Charged");
  });

  it("the search opens the fold by itself when the match is a charged turno", async () => {
    renderPage();
    await screen.findAllByTestId("dashboard-appointment-row");
    fireEvent.change(screen.getByLabelText(/filter list/i), { target: { value: "ana duarte" } });
    const list = await screen.findByTestId("dashboard-appointments-charged-list");
    expect(list.textContent).toContain("ANA DUARTE");
  });

  it("with everything charged, shows «nothing left to attend or charge» and the fold", async () => {
    listAppointmentsMock.mockResolvedValue([appt(1, 8, "ANA DUARTE", "COMPLETED", 501)]);
    renderPage();
    expect(await screen.findByTestId("dashboard-appointments-all-done")).toBeTruthy();
    expect(screen.getByTestId("dashboard-appointments-charged-count").textContent).toBe("1");
  });
});

describe("DashboardPage loads in one go", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmeJson.mockResolvedValue({
      appointmentsToday: { total: 3, pending: 3, confirmed: 0, inProgress: 0, completed: 0 },
      revenueDay: { invoiced: "0", collected: "41000" },
      revenueWeek: { invoiced: "0", collected: "0" },
      clientsThisMonth: 0,
      fiscalAlerts: [],
      inactiveClients: [],
      inactiveClientsThresholdDays: 60,
    });
  });

  it("keeps the whole page hidden behind one loading state until the agenda has answered", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    listAppointmentsMock.mockReset();
    listAppointmentsMock.mockImplementation(() => gate.then(() => []));

    renderPage();
    expect(await screen.findByTestId("dashboard-loading")).toBeTruthy();
    // The summary request answered long ago, but its numbers (e.g. «0 turnos hoy» while the agenda
    // is still loading) must not be on screen yet.
    await waitFor(() => expect(femmeJson).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId("dashboard-loading")).toBeTruthy();
    expect(screen.getByTestId("dashboard-summary").closest("[hidden]")).not.toBeNull();

    release();
    await waitFor(() => expect(screen.queryByTestId("dashboard-loading")).toBeNull());
    expect(screen.getByTestId("dashboard-summary").closest("[hidden]")).toBeNull();
  });

  it("never mounts the summary with placeholder zeros: it exists only once the numbers arrived", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    femmeJson.mockImplementation(() =>
      gate.then(() => ({
        appointmentsToday: { total: 3, pending: 3, confirmed: 0, inProgress: 0, completed: 0 },
        revenueDay: { invoiced: "0", collected: "890000" },
        revenueWeek: { invoiced: "0", collected: "0" },
        clientsThisMonth: 0,
        fiscalAlerts: [],
        inactiveClients: [],
        inactiveClientsThresholdDays: 60,
      })),
    );
    renderPage();
    await screen.findByTestId("dashboard-loading");
    await new Promise((r) => setTimeout(r, 30));
    // Still waiting for /api/dashboard: no «Gs. 0 collected» (hidden or not) can be queried yet.
    expect(screen.queryByTestId("dashboard-summary-collected")).toBeNull();

    release();
    // The first thing a query can ever find is already the real figure.
    expect((await screen.findByTestId("dashboard-summary-collected")).textContent).toMatch(/890/);
  });
});
