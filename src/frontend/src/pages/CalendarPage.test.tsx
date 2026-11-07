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

    it("puts the professional filter inside the search field, with a menu of professionals", async () => {
      const user = userEvent.setup();
      renderPage();
      const trigger = await screen.findByTestId("calendar-prof-trigger");
      // One field: the search box and the filter live in the same container, and there is no row of chips.
      expect(trigger.closest("[data-tour='calendar-search']")).toBe(
        screen.getByTestId("calendar-search").closest("[data-tour='calendar-search']"),
      );
      expect(screen.queryByTestId("calendar-prof-panel")).toBeNull();
      await user.click(trigger);
      const panel = await screen.findByTestId("calendar-prof-panel");
      expect(within(panel).getByTestId("calendar-prof-chip-all").getAttribute("aria-pressed")).toBe("true");
      expect(within(panel).getByRole("button", { name: /^ana gomez$/i })).toBeTruthy();
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

    it("filters the day by professional from the menu, shows her as a tag and removes it with ×", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByTestId("calendar-prof-trigger"));
      const option = await screen.findByRole("button", { name: /^ana gomez$/i });
      expect(option.getAttribute("aria-pressed")).toBe("false");
      await user.click(option);
      // The menu closes and her name stays in the field as a tag.
      expect(screen.queryByTestId("calendar-prof-panel")).toBeNull();
      expect(screen.getByTestId("calendar-prof-pill").textContent).toContain("Ana Gomez");
      await waitFor(() => {
        const urls = femmeJsonMock.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes("/api/appointments") && u.includes("professionalId=10"))).toBe(true);
      });
      await user.click(screen.getByTestId("calendar-prof-pill-clear"));
      expect(screen.queryByTestId("calendar-prof-pill")).toBeNull();
    });

    it("searches inside the professional menu", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByTestId("calendar-prof-trigger"));
      await user.type(await screen.findByTestId("calendar-prof-search"), "zzz");
      expect(screen.queryByTestId("calendar-prof-chip-10")).toBeNull();
      expect(screen.queryByTestId("calendar-prof-chip-all")).toBeNull();
      await user.clear(screen.getByTestId("calendar-prof-search"));
      await user.type(screen.getByTestId("calendar-prof-search"), "gom");
      expect(screen.getByTestId("calendar-prof-chip-10")).toBeTruthy();
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
      expect(await screen.findByRole("menuitem", { name: /edit appointment/i })).toBeTruthy();
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

describe("CalendarPage · turnos completados siguen en la agenda", () => {
  const at = (h: number) => {
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const completed = (id: number, hour: number, invoiceId: number | null) => ({
    ...MOCK_APPOINTMENT,
    id,
    clientName: `CLIENTE ${id}`,
    status: "COMPLETED",
    startAt: at(hour).toISOString(),
    endAt: at(hour + 1).toISOString(),
    serviceRecordId: null,
    invoiceId,
  });

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    femmeJsonMock.mockReset();
    femmeJsonMock.mockImplementation((url: string) => {
      if (url.includes("/api/professionals")) return Promise.resolve([PROFESSIONAL]);
      if (url.includes("/api/services")) return Promise.resolve([SERVICE]);
      if (url.includes("/api/appointments")) {
        return Promise.resolve([
          completed(101, 10, 555), // charged: has an issued comprobante
          completed(102, 12, null), // completed, not charged yet
          { ...MOCK_APPOINTMENT, id: 103, status: "CANCELLED", startAt: at(14).toISOString(), clientName: "CANCELADO" },
        ]);
      }
      return Promise.resolve([]);
    });
  });

  it("the Day list keeps completed turnos, marked «Charged» with a comprobante and «Completed» without", async () => {
    renderPage();
    const charged = await screen.findByTestId("calendar-done-badge-101");
    expect(charged.textContent).toContain("Charged");
    expect(charged.getAttribute("data-charged")).toBe("true");
    const notCharged = await screen.findByTestId("calendar-done-badge-102");
    expect(notCharged.textContent).toContain("Completed");
    expect(notCharged.getAttribute("data-charged")).toBe("false");
    // Cancelled turnos stay hidden.
    expect(screen.queryByTestId("calendar-appt-103")).toBeNull();
  });

  it("the Week grid draws them as clean cards with a status icon", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByTestId("calendar-view-week"))[0]);
    const block = await screen.findByTestId("calendar-appt-101");
    expect(block.getAttribute("data-done")).toBe("charged");
    expect(within(block).getByTestId("calendar-done-badge-101").getAttribute("aria-label")).toBe("Charged");
    const other = await screen.findByTestId("calendar-appt-102");
    expect(other.getAttribute("data-done")).toBe("completed");
    expect(within(other).getByTestId("calendar-done-badge-102").getAttribute("aria-label")).toBe("Completed");
    // Clean-grid week: no legend (each icon explains itself on hover) and a «N turnos»/«libre» caption per day.
    expect(screen.queryByTestId("calendar-week-legend")).toBeNull();
    expect(within(block).getByTestId("calendar-done-badge-101").getAttribute("title")).toBe("Charged");
    expect(screen.getAllByTestId(/^calendar-day-head-/).length).toBe(7);
    expect(screen.queryByTestId("calendar-appt-103")).toBeNull();
  });

  describe("buscador por cliente o servicio", () => {
    const todayAt = (hour: number) => {
      const d = new Date();
      d.setHours(hour, 0, 0, 0);
      return d.toISOString();
    };
    const turno = (id: number, hour: number, clientName: string | null, serviceName: string) => ({
      ...MOCK_APPOINTMENT,
      id,
      clientName,
      serviceName,
      startAt: todayAt(hour),
      endAt: todayAt(hour + 1),
    });

    beforeEach(() => {
      femmeJsonMock.mockImplementation((url: string) => {
        if (url.includes("/api/professionals")) return Promise.resolve([PROFESSIONAL]);
        if (url.includes("/api/services")) return Promise.resolve([SERVICE]);
        if (url.includes("/api/appointments")) {
          return Promise.resolve([
            turno(201, 10, "TANIA NUÑEZ Z", "SPA DE PIES"),
            turno(202, 11, "JUAN TALAVERA", "SPA DE PIES"),
            turno(203, 12, null, "MAQUILLAJE"),
          ]);
        }
        return Promise.resolve([]);
      });
    });

    it("filters the Day list by client, ignoring case and accents, and counts the matches", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("calendar-appt-201");
      await user.type(screen.getByTestId("calendar-search"), "nunez");
      expect(screen.getByTestId("calendar-appt-201")).toBeTruthy();
      expect(screen.queryByTestId("calendar-appt-202")).toBeNull();
      expect(screen.queryByTestId("calendar-appt-203")).toBeNull();
      expect(screen.getByTestId("calendar-search-count").textContent).toBe("1 of 3 appointments");
      // The matching part is highlighted.
      expect(within(screen.getByTestId("calendar-appt-201")).getByText(/Nu/i, { selector: "mark" })).toBeTruthy();
    });

    it("filters by service and also finds the occasional client by its label", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("calendar-appt-201");
      await user.type(screen.getByTestId("calendar-search"), "spa de");
      expect(screen.getByTestId("calendar-search-count").textContent).toBe("2 of 3 appointments");
      expect(screen.queryByTestId("calendar-appt-203")).toBeNull();
      await user.clear(screen.getByTestId("calendar-search"));
      await user.type(screen.getByTestId("calendar-search"), "occasional");
      expect(screen.getByTestId("calendar-appt-203")).toBeTruthy();
      expect(screen.queryByTestId("calendar-appt-201")).toBeNull();
    });

    it("shows «No results» with a button that clears the search, and the × clears it too", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("calendar-appt-201");
      expect(screen.queryByTestId("calendar-search-clear")).toBeNull();
      await user.type(screen.getByTestId("calendar-search"), "zzz");
      const empty = screen.getByTestId("calendar-search-empty");
      expect(empty.textContent).toContain("No results");
      await user.click(within(empty).getByRole("button", { name: "Clear search" }));
      expect((screen.getByTestId("calendar-search") as HTMLInputElement).value).toBe("");
      expect(screen.getByTestId("calendar-appt-202")).toBeTruthy();
      await user.type(screen.getByTestId("calendar-search"), "talavera");
      await user.click(screen.getByTestId("calendar-search-clear"));
      expect(screen.getByTestId("calendar-appt-201")).toBeTruthy();
      expect(screen.queryByTestId("calendar-search-count")).toBeNull();
    });

    it("dims (instead of removing) the Week blocks that do not match", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click((await screen.findAllByTestId("calendar-view-week"))[0]);
      await user.type(screen.getByTestId("calendar-search"), "talavera");
      expect((await screen.findByTestId("calendar-appt-202")).getAttribute("data-dimmed")).toBeNull();
      expect(screen.getByTestId("calendar-appt-201").getAttribute("data-dimmed")).toBe("true");
      expect(screen.getByTestId("calendar-search-count").textContent).toBe("1 of 3 appointments this week");
    });
  });
});

describe("CalendarPage · vista semanal con horarios muy ocupados", () => {
  const at = (h: number) => {
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const at10 = (id: number, professionalId: number, clientName: string) => ({
    ...MOCK_APPOINTMENT,
    id,
    professionalId,
    professionalName: `Prof ${professionalId}`,
    clientName,
    status: "PENDING",
    startAt: at(10).toISOString(),
    endAt: at(11).toISOString(),
  });

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    femmeJsonMock.mockReset();
    femmeJsonMock.mockImplementation((url: string) => {
      if (url.includes("/api/professionals")) return Promise.resolve([PROFESSIONAL]);
      if (url.includes("/api/services")) return Promise.resolve([SERVICE]);
      if (url.includes("/api/appointments")) {
        return Promise.resolve([at10(201, 10, "UNO"), at10(202, 11, "DOS"), at10(203, 12, "TRES")]);
      }
      return Promise.resolve([]);
    });
  });

  it("shows two turnos side by side and a «+1 more» chip that lists all three", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByTestId("calendar-view-week"))[0]);
    expect(await screen.findByTestId("calendar-appt-201")).toBeTruthy();
    expect(screen.getByTestId("calendar-appt-202")).toBeTruthy();
    expect(screen.queryByTestId("calendar-appt-203")).toBeNull();
    const chip = await screen.findByTestId("calendar-more-chip");
    expect(chip.textContent).toBe("+1 more");
    expect(screen.queryByTestId("calendar-more-popover")).toBeNull();
    await user.click(chip);
    const pop = await screen.findByTestId("calendar-more-popover");
    expect(within(pop).getByTestId("calendar-more-row-201")).toBeTruthy();
    expect(within(pop).getByTestId("calendar-more-row-202")).toBeTruthy();
    expect(within(pop).getByTestId("calendar-more-row-203").textContent).toContain("TRES");
    // Escape closes the list.
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("calendar-more-popover")).toBeNull();
  });
});

describe("CalendarPage · tarjetas resumidas de la semana", () => {
  const at = (h: number) => {
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    return d;
  };
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    femmeJsonMock.mockReset();
    femmeJsonMock.mockImplementation((url: string) => {
      if (url.includes("/api/professionals")) return Promise.resolve([PROFESSIONAL]);
      if (url.includes("/api/services")) return Promise.resolve([SERVICE]);
      if (url.includes("/api/appointments")) {
        return Promise.resolve([
          { ...MOCK_APPOINTMENT, id: 301, clientName: "TANIA NUÑEZ Z", startAt: at(10).toISOString(), durationMinutes: 60 },
          { ...MOCK_APPOINTMENT, id: 302, clientName: null, startAt: at(13).toISOString(), durationMinutes: 90 },
        ]);
      }
      return Promise.resolve([]);
    });
  });

  it("shows a short name, gives every card the same height and keeps the full detail for the hover", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByTestId("calendar-view-week"))[0]);
    const a = await screen.findByTestId("calendar-appt-301");
    const b = await screen.findByTestId("calendar-appt-302");
    expect(screen.getByTestId("calendar-appt-name-301").textContent).toBe("Tania N.");
    expect(screen.getByTestId("calendar-appt-name-302").textContent).toBe("Occasional");
    // Same height whatever the duration (60 vs 90 min).
    expect(a.style.height).toBe(b.style.height);
    // The accessible name keeps the full client name.
    expect(a.getAttribute("aria-label")).toContain("TANIA NUÑEZ Z");
    // Hover: a floating box with everything; the card does not change size.
    const h0 = a.style.height;
    await user.hover(a);
    const tip = await screen.findByTestId("calendar-appt-tip-301");
    expect(tip.textContent).toContain("TANIA NUÑEZ Z");
    expect(tip.textContent).toContain("Haircut");
    expect(tip.textContent).toContain("60 min");
    expect(a.style.height).toBe(h0);
    await user.unhover(a);
    expect(screen.queryByTestId("calendar-appt-tip-301")).toBeNull();
  });
});
