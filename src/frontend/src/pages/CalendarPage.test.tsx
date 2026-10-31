import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
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
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <CalendarPage />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
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
        // The Day view is the default: the arrows move one day.
        const prevButtons = screen.getAllByRole("button", { name: /previous day/i });
        expect(prevButtons.length).toBeGreaterThan(0);
      });
      const nextButtons = screen.getAllByRole("button", { name: /next day/i });
      expect(nextButtons.length).toBeGreaterThan(0);
    });

    it("renders today button", async () => {
      renderPage();
      await waitFor(() => {
        const todayButtons = screen.getAllByText(/today/i);
        expect(todayButtons.length).toBeGreaterThan(0);
      });
    });

    it("renders the professional filter as chips", async () => {
      renderPage();
      expect(await screen.findByRole("button", { name: /^all professionals$/i })).toBeTruthy();
      expect(await screen.findByRole("button", { name: /^ana gomez$/i })).toBeTruthy();
    });

    it("opens on the Day view and switches to the Week grid with one tap", async () => {
      const user = userEvent.setup();
      renderPage();
      expect(await screen.findByTestId("calendar-week-strip")).toBeTruthy();
      expect(screen.queryByTestId("calendar-day-col-mon")).toBeNull();
      await user.click(screen.getAllByTestId("calendar-view-week")[0]);
      expect(await screen.findByTestId("calendar-day-col-mon")).toBeTruthy();
      expect(screen.queryByTestId("calendar-week-strip")).toBeNull();
      expect(screen.getAllByRole("button", { name: /next week/i }).length).toBeGreaterThan(0);
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

    it("filters the day by professional with the chips (HU-19)", async () => {
      const user = userEvent.setup();
      renderPage();
      const chip = await screen.findByRole("button", { name: /^ana gomez$/i });
      expect(chip.getAttribute("aria-pressed")).toBe("false");
      await user.click(chip);
      expect(chip.getAttribute("aria-pressed")).toBe("true");
      await waitFor(() => {
        const urls = femmeJsonMock.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes("/api/appointments") && u.includes("professionalId=10"))).toBe(true);
      });
    });

    it("does not list non-grid statuses (HU-19)", async () => {
      const completedAppt = {
        ...MOCK_APPOINTMENT,
        id: 99,
        status: "COMPLETED",
        serviceName: "HiddenService",
      };
      femmeJsonMock.mockImplementation((url: string) => {
        if (url.includes("/api/professionals")) return Promise.resolve([PROFESSIONAL]);
        if (url.includes("/api/services")) return Promise.resolve([SERVICE]);
        if (url.includes("/api/clients")) return Promise.resolve([]);
        if (url.includes("/api/appointments")) return Promise.resolve([completedAppt]);
        return Promise.resolve([]);
      });

      renderPage();

      await waitFor(() => {
        expect(screen.queryByText(/hiddenservice/i)).toBeNull();
      });
    });
  });

  describe("Appointment form validation", () => {
    it("shows validation when date and time are in the past", async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: /new appointment/i }).length).toBeGreaterThan(0);
      });
      await user.click(screen.getAllByRole("button", { name: /new appointment/i })[0]);
      await waitFor(() => {
        expect(screen.getAllByRole("dialog").length).toBeGreaterThan(0);
      });

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = yesterday.toISOString().slice(0, 10);

      const formDialog = screen.getAllByRole("dialog")[0];

      // Use fireEvent.change instead of user.type to avoid LocalizedDateInput's
      // useEffect resetting text mid-keystroke (partial ISO matches like "2026-06-1"
      // trigger onChange, which resets the display text and corrupts the final value).
      fireEvent.change(screen.getByLabelText(/^date$/i), { target: { value: yStr } });
      const timeInput = screen.getByLabelText(/^time$/i);
      fireEvent.change(timeInput, { target: { value: "10:00" } });
      fireEvent.blur(timeInput);

      await user.click(screen.getByRole("combobox", { name: /^professional$/i }));
      // The page also has an "Ana Gomez" filter chip: pick the option inside the opened list.
      await user.click(
        within(await screen.findByRole("listbox")).getByRole("button", { name: /^ana gomez$/i }),
      );

      await user.click(screen.getByRole("combobox", { name: /^service$/i }));
      await user.click(await screen.findByRole("button", { name: /^haircut/i }));

      await user.click(within(formDialog).getByRole("button", { name: /^save$/i }));

      expect(
        await screen.findByText(/must be in the future/i, {}, { timeout: 3000 }),
      ).toBeTruthy();
      expect(femmePostJsonMock).not.toHaveBeenCalled();
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
        expect(screen.getAllByRole("dialog").length).toBeGreaterThan(0);
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
        expect(screen.getByText(/appointment detail/i)).toBeTruthy();
      });
    });
  });

  describe("HU-09 - Edit appointment restriction", () => {
    it("offers Confirm as the main step and Edit behind the ⋯ menu for PENDING appointments", async () => {
      femmeJsonMock.mockImplementation((url: string) => {
        if (url.includes("/api/professionals")) return Promise.resolve([PROFESSIONAL]);
        if (url.includes("/api/services")) return Promise.resolve([SERVICE]);
        if (url.includes("/api/clients")) return Promise.resolve([]);
        if (url.includes("/api/appointments")) return Promise.resolve([MOCK_APPOINTMENT]);
        return Promise.resolve([]);
      });

      const user = userEvent.setup();
      renderPage();

      const apptBtn = await screen.findByRole("button", { name: /haircut/i });
      await user.click(apptBtn);

      const next = await screen.findByTestId("calendar-next-step");
      expect(next.textContent).toMatch(/confirm/i);
      await user.click(screen.getByTestId("calendar-more-actions"));
      expect(await screen.findByRole("button", { name: /edit appointment/i })).toBeTruthy();
      expect(screen.getByTestId("calendar-action-cancel")).toBeTruthy();
      expect(screen.getByTestId("calendar-action-noshow")).toBeTruthy();
    });

    // COMPLETED appointments are excluded from the week grid entirely since HU-19
    // (see CALENDAR_GRID_STATUSES / the "does not show non-grid statuses" test above), so they
    // can no longer be opened from here to exercise this restriction. IN_PROGRESS is still
    // grid-visible but outside EDITABLE_STATUSES, so it covers the same "not editable" intent.
    it("does not show edit button for IN_PROGRESS appointments", async () => {
      const inProgressAppt = { ...MOCK_APPOINTMENT, status: "IN_PROGRESS" };
      femmeJsonMock.mockImplementation((url: string) => {
        if (url.includes("/api/professionals")) return Promise.resolve([PROFESSIONAL]);
        if (url.includes("/api/services")) return Promise.resolve([SERVICE]);
        if (url.includes("/api/clients")) return Promise.resolve([]);
        if (url.includes("/api/appointments")) return Promise.resolve([inProgressAppt]);
        return Promise.resolve([]);
      });

      const user = userEvent.setup();
      renderPage();

      // getByRole excludes the ThemeProvider's hidden duplicate tree (unlike getAllByText,
      // which would match it too and could click a copy that never opens an accessible dialog).
      const apptBtn = await screen.findByRole("button", { name: /haircut/i });
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
