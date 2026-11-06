import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { ServiceRecordDetailModal } from "./ServiceRecordDetailModal";

const femmeJson = vi.fn();
vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: vi.fn(),
  femmePutJson: vi.fn(),
}));

describe("ServiceRecordDetailModal loading", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    femmeJson.mockReset();
  });
  afterEach(cleanup);

  it("asks for the ficha and the light professionals list at once", async () => {
    // The ficha never answers: if the other two still go out, nothing waits for the editor.
    femmeJson.mockImplementation((url: string) => {
      if (url.startsWith("/api/service-records/7")) return new Promise(() => undefined);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            <ServiceRecordDetailModal serviceRecordId={7} onClose={() => undefined} />
          </ThemeProvider>
        </I18nextProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      const urls = femmeJson.mock.calls.map((c) => String(c[0]));
      expect(urls).toContain("/api/service-records/7");
      expect(urls).toContain("/api/professionals/options");
      // The frequent services are gone: nothing asks for them.
      expect(urls.some((u) => u.includes("frequent-services"))).toBe(false);
    });
    // The heavy list (photos + schedules) is not used for the ficha any more.
    expect(femmeJson.mock.calls.map((c) => String(c[0]))).not.toContain("/api/professionals");
  });

  it("«View appointment» opens the turno in place instead of going to the Agenda", async () => {
    const ficha = {
      id: 7,
      clientId: 1,
      clientFullName: "Marta Benítez",
      clientRuc: null,
      status: "OPEN",
      totalAmount: "50000",
      tipsTotal: "0",
      voidReason: null,
      createdAt: "2026-11-05T13:30:00Z",
      closedAt: null,
      invoiceId: null,
      invoiceNumberFormatted: null,
      lines: [],
      tips: [],
      appointmentId: 9,
      appointmentStartAt: "2026-11-05T17:00:00Z",
      appointments: [{ id: 9, startAt: "2026-11-05T17:00:00Z" }],
    };
    const appointment = {
      id: 9,
      clientId: 1,
      clientName: "Marta Benítez",
      professionalId: 3,
      professionalName: "Laura",
      serviceId: 11,
      serviceName: "Coloración",
      durationMinutes: 60,
      startAt: "2026-11-05T17:00:00Z",
      endAt: "2026-11-05T18:00:00Z",
      status: "IN_PROGRESS",
      cancelReason: null,
      reminderSentAt: null,
      serviceRecordId: 7,
    };
    femmeJson.mockImplementation((url: string) => {
      if (url.startsWith("/api/service-records/7")) return Promise.resolve(ficha);
      if (url.startsWith("/api/appointments/9")) return Promise.resolve(appointment);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            <ServiceRecordDetailModal serviceRecordId={7} onClose={() => undefined} />
          </ThemeProvider>
        </I18nextProvider>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByTestId("service-record-more"));
    await userEvent.click(await screen.findByTestId("service-record-view-appointment"));

    // The turno is asked for and its detail opens on top of the ficha; the ficha stays open.
    await waitFor(() => {
      expect(femmeJson.mock.calls.map((c) => String(c[0]))).toContain("/api/appointments/9");
    });
    expect(await screen.findByTestId("calendar-next-step", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByTestId("service-record-more")).toBeTruthy();
  });
});
