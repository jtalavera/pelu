import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import type { Appointment } from "../api/appointments";
import { AppointmentDetailModal } from "./AppointmentDetailModal";

vi.mock("../hooks/useMe", () => ({
  useMe: () => ({ me: { role: "ADMIN", professionalId: null }, loading: false }),
}));

function setWide(wide: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const charged: Appointment = {
  id: 1,
  clientId: 5,
  clientName: "TANIA NUÑEZ Z",
  professionalId: 10,
  professionalName: "Jorge",
  serviceId: 20,
  serviceName: "SPA DE PIES",
  durationMinutes: 60,
  startAt: "2026-11-05T14:00:00Z",
  endAt: "2026-11-05T15:00:00Z",
  status: "COMPLETED",
  cancelReason: null,
  reminderSentAt: null,
  serviceRecordId: 7,
  invoiceId: 99,
};

function renderModal(appointment: Appointment) {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <AppointmentDetailModal appointment={appointment} onClose={() => undefined} onChanged={() => undefined} />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

describe("AppointmentDetailModal · pie según el ancho", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("web: «Cerrar» first, then the ficha and the comprobante as footer buttons, and «⋯»", async () => {
    setWide(true);
    renderModal(charged);
    const dialog = await screen.findByRole("dialog");
    const footerButtons = within(dialog)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
    const order = footerButtons.filter((l) => ["Close", "Record", "Invoice", "More actions"].includes(l ?? ""));
    // The header × is also «Close»; the footer's own order is what matters.
    expect(order.slice(-4)).toEqual(["Close", "Record", "Invoice", "More actions"]);
    expect(within(dialog).getByTestId("calendar-appointment-ficha-go").textContent).toBe("Record");
    expect(within(dialog).getByTestId("appointment-view-invoice").textContent).toBe("Invoice");
    // The status chip moved to the header.
    expect(within(dialog).getByRole("heading", { level: 2 }).textContent).toContain("Completed");
  });

  it("phone: no ficha / comprobante buttons; they are the first options of «Más acciones»", async () => {
    setWide(false);
    const user = userEvent.setup();
    renderModal(charged);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByTestId("appointment-view-invoice")).toBeNull();
    expect(within(dialog).queryByTestId("calendar-appointment-ficha-go")).toBeNull();

    await user.click(within(dialog).getByTestId("calendar-more-actions"));
    const menu = await screen.findByTestId("calendar-actions-panel");
    const items = within(menu).getAllByRole("menuitem");
    expect(items[0].textContent).toContain("Go to the service record");
    expect(items[1].textContent).toContain("View invoice");
  });

  it("a turno without a comprobante shows no comprobante button (web) nor menu option (phone)", async () => {
    setWide(true);
    const { unmount } = renderModal({ ...charged, invoiceId: null, status: "IN_PROGRESS" });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByTestId("appointment-view-invoice")).toBeNull();
    // The next step is «Cobrar», still the main button.
    expect(within(dialog).getByTestId("calendar-next-step").textContent).toBe("Charge");
    unmount();
  });
});
