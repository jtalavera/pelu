import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "../test/renderWithTour";
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
    });
    renderPage();
    expect(await screen.findByText(/^Gs\.[\s\u00a0]*890/)).toBeTruthy();
    expect(screen.getByText(/^1,284$/)).toBeTruthy();
  });
});
