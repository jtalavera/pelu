import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import CalendarPage from "./CalendarPage";

const femmeJsonMock = vi.fn();
const femmePostJsonMock = vi.fn();
const femmePutJsonMock = vi.fn();
const femmePatchJsonMock = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJsonMock(...args),
  femmePostJson: (...args: unknown[]) => femmePostJsonMock(...args),
  femmePutJson: (...args: unknown[]) => femmePutJsonMock(...args),
  femmePatchJson: (...args: unknown[]) => femmePatchJsonMock(...args),
}));

const PROFESSIONAL = { id: 10, fullName: "Ana Gomez", active: true };
const SERVICE = { id: 20, name: "Haircut", durationMinutes: 60, active: true };

const MOCK_APPOINTMENT = {
  id: 1,
  clientId: null,
  clientName: null,
  professionalId: 10,
  professionalName: "Ana Gomez",
  serviceId: 20,
  serviceName: "Haircut",
  durationMinutes: 60,
  startAt: new Date().toISOString(),
  endAt: new Date(Date.now() + 3600000).toISOString(),
  status: "PENDING",
  cancelReason: null,
};

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <CalendarPage />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("CalendarPage (HU-06, HU-07, HU-08, HU-09)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    femmeJsonMock.mockReset();
    femmePostJsonMock.mockReset();
    femmePutJsonMock.mockReset();
    femmePatchJsonMock.mockReset();

    femmeJsonMock.mockImplementation((url: string) => {
      if (url.includes("/api/professionals")) return Promise.resolve([PROFESSIONAL]);
      if (url.includes("/api/services")) return Promise.resolve([SERVICE]);
      if (url.includes("/api/clients")) return Promise.resolve([]);
      if (url.includes("/api/appointments")) return Promise.resolve([]);
      return Promise.resolve([]);
    });
  });

  describe("HU-06 - Calendar view", () => {
    it("renders calendar title", async () => {
      renderPage();
      expect(await screen.findAllByText(/appointments/i)).toBeTruthy();
    });

    it("renders navigation buttons", async () => {
      renderPage();
      await waitFor(() => {
        const prevButtons = screen.getAllByRole("button", { name: /previous week/i });
        expect(prevButtons.length).toBeGreaterThan(0);
      });
      const nextButtons = screen.getAllByRole("button", { name: /next week/i });
      expect(nextButtons.length).toBeGreaterThan(0);
    });

    it("renders today button", async () => {
      renderPage();
      await waitFor(() => {
        const todayButtons = screen.getAllByText(/today/i);
        expect(todayButtons.length).toBeGreaterThan(0);
      });
    });

    it("renders professional filter", async () => {
      renderPage();
      await waitFor(() => {
        const filter = screen.getAllByRole("combobox");
        expect(filter.length).toBeGreaterThan(0);
      });
    });

    it("shows appointment in calendar when appointments are loaded", async () => {
      femmeJsonMock.mockImplementation((url: string) => {
        if (url.includes("/api/professionals")) return Promise.resolve([PROFESSIONAL]);
        if (url.includes("/api/services")) return Promise.resolve([SERVICE]);
        if (url.includes("/api/clients")) return Promise.resolve([]);
        if (url.includes("/api/appointments")) return Promise.resolve([MOCK_APPOINTMENT]);
        return Promise.resolve([]);
      });

      renderPage();

      await waitFor(() => {
        const haircut = screen.queryAllByText(/haircut/i);
        expect(haircut.length).toBeGreaterThan(0);
      });
    });

    it("shows professional options in filter dropdown", async () => {
      renderPage();
      await waitFor(() => {
        const anaOptions = screen.queryAllByText(/ana gomez/i);
        expect(anaOptions.length).toBeGreaterThan(0);
      });
    });
  });

  describe("HU-07 - New appointment button", () => {
    it("renders new appointment button", async () => {
      renderPage();
      await waitFor(() => {
        const btns = screen.getAllByRole("button", { name: /new appointment/i });
        expect(btns.length).toBeGreaterThan(0);
      });
    });

    it("opens form modal when new appointment is clicked", async () => {
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => {
        const btns = screen.getAllByRole("button", { name: /new appointment/i });
        expect(btns.length).toBeGreaterThan(0);
      });

      const btn = screen.getAllByRole("button", { name: /new appointment/i })[0];
      await user.click(btn);

      await waitFor(() => {
        const dialog = screen.getByRole("dialog");
        expect(dialog).toBeTruthy();
      });
    });
  });

  describe("HU-08 - Status change from detail", () => {
    it("shows appointment detail modal when appointment is clicked", async () => {
      femmeJsonMock.mockImplementation((url: string) => {
        if (url.includes("/api/professionals")) return Promise.resolve([PROFESSIONAL]);
        if (url.includes("/api/services")) return Promise.resolve([SERVICE]);
        if (url.includes("/api/clients")) return Promise.resolve([]);
        if (url.includes("/api/appointments")) return Promise.resolve([MOCK_APPOINTMENT]);
        return Promise.resolve([]);
      });

      const user = userEvent.setup();
      renderPage();

      await waitFor(() => {
        const haircut = screen.queryAllByText(/haircut/i);
        expect(haircut.length).toBeGreaterThan(0);
      });

      const apptBtn = screen.getAllByText(/haircut/i)[0];
      await user.click(apptBtn);

      await waitFor(() => {
        const dialog = screen.getByRole("dialog");
        expect(dialog).toBeTruthy();
      });
    });
  });

  describe("HU-09 - Edit appointment restriction", () => {
    it("shows edit button for PENDING appointments in detail modal", async () => {
      femmeJsonMock.mockImplementation((url: string) => {
        if (url.includes("/api/professionals")) return Promise.resolve([PROFESSIONAL]);
        if (url.includes("/api/services")) return Promise.resolve([SERVICE]);
        if (url.includes("/api/clients")) return Promise.resolve([]);
        if (url.includes("/api/appointments")) return Promise.resolve([MOCK_APPOINTMENT]);
        return Promise.resolve([]);
      });

      const user = userEvent.setup();
      renderPage();

      await waitFor(() => {
        const haircut = screen.queryAllByText(/haircut/i);
        expect(haircut.length).toBeGreaterThan(0);
      });

      const apptBtn = screen.getAllByText(/haircut/i)[0];
      await user.click(apptBtn);

      await waitFor(() => {
        const editBtns = screen.queryAllByRole("button", { name: /edit appointment/i });
        expect(editBtns.length).toBeGreaterThan(0);
      });
    });

    it("does not show edit button for COMPLETED appointments", async () => {
      const completedAppt = { ...MOCK_APPOINTMENT, status: "COMPLETED" };
      femmeJsonMock.mockImplementation((url: string) => {
        if (url.includes("/api/professionals")) return Promise.resolve([PROFESSIONAL]);
        if (url.includes("/api/services")) return Promise.resolve([SERVICE]);
        if (url.includes("/api/clients")) return Promise.resolve([]);
        if (url.includes("/api/appointments")) return Promise.resolve([completedAppt]);
        return Promise.resolve([]);
      });

      const user = userEvent.setup();
      renderPage();

      await waitFor(() => {
        const haircut = screen.queryAllByText(/haircut/i);
        expect(haircut.length).toBeGreaterThan(0);
      });

      const apptBtn = screen.getAllByText(/haircut/i)[0];
      await user.click(apptBtn);

      await waitFor(() => {
        const dialogs = screen.queryAllByRole("dialog");
        expect(dialogs.length).toBeGreaterThan(0);
        // Check within the first dialog only (ThemeProvider renders dual trees)
        const editBtns = within(dialogs[0]).queryAllByRole("button", { name: /edit appointment/i });
        expect(editBtns.length).toBe(0);
      });
    });
  });

  describe("Error states", () => {
    it("shows error alert when appointments fail to load", async () => {
      femmeJsonMock.mockImplementation((url: string) => {
        if (url.includes("/api/professionals")) return Promise.resolve([]);
        if (url.includes("/api/services")) return Promise.resolve([]);
        if (url.includes("/api/appointments"))
          return Promise.reject(new Error('{"error":"GENERIC"}'));
        return Promise.resolve([]);
      });

      renderPage();

      await waitFor(() => {
        const alerts = screen.queryAllByRole("alert");
        expect(alerts.length).toBeGreaterThan(0);
      });
    });
  });
});
