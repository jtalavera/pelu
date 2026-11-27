import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../test/renderWithTour";
import { I18nextProvider } from "react-i18next";
import * as api from "../api/whatsappNotices";
import type { AppointmentNotice } from "../api/whatsappNotices";
import i18n from "../i18n";
import { AppointmentNoticeLine } from "./AppointmentNoticeLine";

let flagsOn = true;
vi.mock("../hooks/useFeatureFlags", () => ({
  useFeatureFlag: (key: string) => flagsOn && (key === "WHATSAPP_REMINDERS" || key === "ONLINE_BOOKING"),
}));
vi.mock("../api/whatsappNotices", () => ({ getAppointmentNotices: vi.fn() }));

function notice(overrides: Partial<AppointmentNotice>): AppointmentNotice {
  return {
    template: "pelu_recordatorio_turno",
    purpose: "REMINDER",
    status: "SENT",
    errorCode: null,
    queuedAt: null,
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    fallbackEmailSent: false,
    fallbackEmailAvailable: false,
    recipient: "+595981123456",
    ...overrides,
  };
}

function show(last: AppointmentNotice | null, hasNotice = true) {
  vi.mocked(api.getAppointmentNotices).mockResolvedValue({ hasNotice, last });
  render(
    <I18nextProvider i18n={i18n}>
      <AppointmentNoticeLine appointmentId={9} />
    </I18nextProvider>,
  );
}

describe("AppointmentNoticeLine (HU-WAP-07)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    flagsOn = true;
    void i18n.changeLanguage("en");
    vi.mocked(api.getAppointmentNotices).mockReset();
  });

  it.each([
    ["SENT", "Notice sent by WhatsApp"],
    ["DELIVERED", "Notice delivered by WhatsApp"],
    ["READ", "Notice read on WhatsApp"],
    ["QUEUED", "Sending the WhatsApp notice…"],
  ])("says %s", async (status, text) => {
    show(notice({ status }));
    expect((await screen.findByTestId("appointment-notice")).textContent).toContain(text);
  });

  it("says a failed notice was not delivered and names the number to call", async () => {
    show(notice({ status: "FAILED" }));
    const el = await screen.findByTestId("appointment-notice");
    expect(el.textContent).toContain("Not delivered — call the client at +595981123456");
    expect(el.getAttribute("data-status")).toBe("FAILED");
  });

  it("says when the email took over", async () => {
    show(notice({ status: "FAILED", fallbackEmailSent: true }));
    expect((await screen.findByTestId("appointment-notice")).textContent).toContain(
      "sent by email instead",
    );
  });

  it("says a notice was not sent because the client does not accept WhatsApp", async () => {
    show(notice({ status: "CANCELLED" }));
    expect((await screen.findByTestId("appointment-notice")).textContent).toContain(
      "does not accept WhatsApp",
    );
  });

  it("only says whether a notice went out when the viewer is the professional (no details)", async () => {
    show(null);
    const el = await screen.findByTestId("appointment-notice");
    expect(el.textContent).toContain("A notice was sent");
    expect(el.textContent).not.toMatch(/\+595|\d{6}/);
  });

  it("renders nothing when no notice was ever sent", async () => {
    show(null, false);
    await vi.waitFor(() => expect(api.getAppointmentNotices).toHaveBeenCalled());
    expect(screen.queryByTestId("appointment-notice")).toBeNull();
  });

  it("does not even ask when the salon has no WhatsApp channel", () => {
    flagsOn = false;
    show(notice({}));
    expect(api.getAppointmentNotices).not.toHaveBeenCalled();
    expect(screen.queryByTestId("appointment-notice")).toBeNull();
  });

  it("stays silent when the request fails", async () => {
    vi.mocked(api.getAppointmentNotices).mockRejectedValue(new Error("x"));
    render(
      <I18nextProvider i18n={i18n}>
        <AppointmentNoticeLine appointmentId={9} />
      </I18nextProvider>,
    );
    await vi.waitFor(() => expect(api.getAppointmentNotices).toHaveBeenCalled());
    expect(screen.queryByTestId("appointment-notice")).toBeNull();
  });
});
