import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { AppointmentFichaAction, canGetFicha } from "./AppointmentFichaAction";
import type { Appointment } from "../api/appointments";

const createFromAppointment = vi.fn();
const assignToAppointment = vi.fn();
const listAssignable = vi.fn();

vi.mock("../api/serviceRecords", () => ({
  createServiceRecordFromAppointment: (...a: unknown[]) => createFromAppointment(...a),
  assignServiceRecordToAppointment: (...a: unknown[]) => assignToAppointment(...a),
  listAssignableServiceRecords: (...a: unknown[]) => listAssignable(...a),
}));

const base: Appointment = {
  id: 100,
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

function renderIt(appt: Appointment, onOpenRecord = vi.fn(), onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <AppointmentFichaAction appt={appt} onOpenRecord={onOpenRecord} onChanged={onChanged} />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
  return { onOpenRecord, onChanged };
}

describe("AppointmentFichaAction", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    createFromAppointment.mockReset();
    assignToAppointment.mockReset();
    listAssignable.mockReset();
    listAssignable.mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  it("a turno with a ficha offers «Go to the service record»", async () => {
    const { onOpenRecord } = renderIt({ ...base, serviceRecordId: 9 });
    await userEvent.click(screen.getByTestId("appointment-ficha-go"));
    expect(onOpenRecord).toHaveBeenCalledWith(9);
    expect(screen.queryByTestId("appointment-ficha-create-or-assign")).toBeNull();
  });

  it("a turno without a ficha offers «Create or assign»; creating opens the new ficha", async () => {
    createFromAppointment.mockResolvedValue({ id: 42 });
    const { onOpenRecord, onChanged } = renderIt(base);
    await userEvent.click(screen.getByTestId("appointment-ficha-create-or-assign"));
    expect(await screen.findByTestId("appointment-ficha-no-candidates")).toBeTruthy();
    await userEvent.click(screen.getByTestId("appointment-ficha-create"));
    await waitFor(() => expect(onOpenRecord).toHaveBeenCalledWith(42));
    expect(createFromAppointment).toHaveBeenCalledWith(100);
    expect(onChanged).toHaveBeenCalled();
  });

  it("lists the open fichas of the client and assigns the chosen one", async () => {
    listAssignable.mockResolvedValue([
      { id: 7, clientId: 5, clientFullName: "María Rojas", status: "OPEN", totalAmount: null, createdAt: "2026-11-02T13:05:00Z", servicesSummary: "Corte, Manicura" },
    ]);
    assignToAppointment.mockResolvedValue({ id: 7 });
    const { onOpenRecord } = renderIt(base);
    await userEvent.click(screen.getByTestId("appointment-ficha-create-or-assign"));
    await userEvent.click(await screen.findByTestId("appointment-ficha-candidate"));
    await waitFor(() => expect(assignToAppointment).toHaveBeenCalledWith(100, 7));
    expect(onOpenRecord).toHaveBeenCalledWith(7);
  });

  it("only active turnos with a client can get a ficha", () => {
    expect(canGetFicha({ ...base, status: "PENDING" })).toBe(true);
    expect(canGetFicha({ ...base, status: "IN_PROGRESS" })).toBe(true);
    expect(canGetFicha({ ...base, status: "COMPLETED" })).toBe(false);
    expect(canGetFicha({ ...base, status: "CANCELLED" })).toBe(false);
    expect(canGetFicha({ ...base, clientId: null })).toBe(false);
    expect(canGetFicha({ ...base, serviceRecordId: 3 })).toBe(false);
  });
});
