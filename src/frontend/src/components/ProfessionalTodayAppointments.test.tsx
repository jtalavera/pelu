import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { ProfessionalTodayAppointments } from "./ProfessionalTodayAppointments";
import type { Appointment } from "../api/appointments";

const listAppointments = vi.fn();
vi.mock("../api/appointments", () => ({ listAppointments: (...a: unknown[]) => listAppointments(...a) }));
vi.mock("../hooks/useMe", () => ({ useMe: () => ({ me: { professionalId: 3 } }) }));
vi.mock("./AppointmentFichaAction", () => ({
  AppointmentFichaAction: (p: { appt: Appointment; onOpenRecord: (id: number) => void }) => (
    <button type="button" onClick={() => p.onOpenRecord(p.appt.serviceRecordId ?? 0)}>
      ficha-{p.appt.id}
    </button>
  ),
}));

const base: Appointment = {
  id: 1,
  clientId: 5,
  clientName: "María Rojas",
  professionalId: 3,
  professionalName: "Laura",
  serviceId: 11,
  serviceName: "Corte",
  durationMinutes: 30,
  startAt: "2026-11-02T13:30:00Z",
  endAt: "2026-11-02T14:00:00Z",
  status: "CONFIRMED",
  cancelReason: null,
  reminderSentAt: null,
  serviceRecordId: null,
};

function renderIt(onOpenRecord = vi.fn()) {
  render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <ProfessionalTodayAppointments onOpenRecord={onOpenRecord} />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
  return onOpenRecord;
}

describe("ProfessionalTodayAppointments", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    listAppointments.mockReset();
  });
  afterEach(() => cleanup());

  it("lists only her own turnos still to attend, in time order", async () => {
    listAppointments.mockResolvedValue([
      { ...base, id: 2, clientName: "Ana Gómez", startAt: "2026-11-02T15:00:00Z" },
      { ...base, id: 3, clientName: "Otra Profe", professionalId: 9 },
      { ...base, id: 4, clientName: "Ya Atendida", status: "COMPLETED" },
      { ...base, id: 5, clientName: "Cancelada", status: "CANCELLED" },
      base,
    ]);
    renderIt();
    const rows = await screen.findAllByTestId("professional-appointment-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("María Rojas"),
      expect.stringContaining("Ana Gómez"),
    ]);
    expect(listAppointments.mock.calls[0][2]).toBe(3);
  });

  it("shows an empty state and hands the ficha action to the host", async () => {
    listAppointments.mockResolvedValue([]);
    renderIt();
    expect(await screen.findByTestId("professional-appointments-empty")).toBeTruthy();
  });

  it("opens the ficha through the shared action", async () => {
    listAppointments.mockResolvedValue([{ ...base, serviceRecordId: 9 }]);
    const onOpen = renderIt();
    await userEvent.click(await screen.findByRole("button", { name: "ficha-1" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(9));
  });
});
