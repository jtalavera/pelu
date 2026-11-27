import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import * as api from "../api/whatsappNotices";
import i18n from "../i18n";
import { WhatsAppConsentSwitch } from "./WhatsAppConsentSwitch";

let flagsOn = true;
vi.mock("../hooks/useFeatureFlags", () => ({
  useFeatureFlag: (key: string) => flagsOn && (key === "WHATSAPP_REMINDERS" || key === "ONLINE_BOOKING"),
}));
vi.mock("../api/whatsappNotices", () => ({ setClientWhatsAppConsent: vi.fn() }));

type Props = Partial<Parameters<typeof WhatsAppConsentSwitch>[0]>;

function renderSwitch(props: Props = {}, onChanged = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <WhatsAppConsentSwitch
        clientId={5}
        savedPhone="(0981) 123-456"
        phoneDirty={false}
        active
        optIn={false}
        onChanged={onChanged}
        {...props}
      />
    </I18nextProvider>,
  );
  return onChanged;
}

describe("WhatsAppConsentSwitch (HU-WAP-03)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    flagsOn = true;
    void i18n.changeLanguage("en");
    vi.mocked(api.setClientWhatsAppConsent).mockReset();
  });

  it("does not exist when the salon has no WhatsApp channel (RT-01)", () => {
    flagsOn = false;
    renderSwitch();
    expect(screen.queryByTestId("client-whatsapp-consent")).toBeNull();
  });

  it("explains that it must only be turned on if the client agreed", () => {
    renderSwitch();
    expect(screen.getByText("Accepts WhatsApp notices")).toBeTruthy();
    expect(screen.getByTestId("client-whatsapp-hint").textContent).toBe(
      "Turn it on only if the client agreed.",
    );
    expect((screen.getByTestId("client-whatsapp-switch") as HTMLInputElement).checked).toBe(false);
  });

  it("turns the consent on and reports the answer", async () => {
    vi.mocked(api.setClientWhatsAppConsent).mockResolvedValue({
      id: 5,
      whatsappOptIn: true,
      whatsappOptInAt: "2026-11-26T12:00:00Z",
      whatsappOptInSource: "STAFF",
    });
    const user = userEvent.setup();
    const onChanged = renderSwitch();

    await user.click(screen.getByTestId("client-whatsapp-switch"));

    expect(api.setClientWhatsAppConsent).toHaveBeenCalledWith(5, true);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ whatsappOptIn: true })));
  });

  it("turns the consent off when it was on, and shows when it was recorded", async () => {
    vi.mocked(api.setClientWhatsAppConsent).mockResolvedValue({
      id: 5,
      whatsappOptIn: false,
      whatsappOptInAt: null,
      whatsappOptInSource: null,
    });
    const user = userEvent.setup();
    renderSwitch({ optIn: true, optInAt: "2026-11-26T12:00:00Z" });

    expect(screen.getByTestId("client-whatsapp-since").textContent).toContain("Recorded on");
    await user.click(screen.getByTestId("client-whatsapp-switch"));

    expect(api.setClientWhatsAppConsent).toHaveBeenCalledWith(5, false);
  });

  it("needs a valid saved phone to be turned on", () => {
    renderSwitch({ savedPhone: null });
    expect((screen.getByTestId("client-whatsapp-switch") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId("client-whatsapp-hint").textContent).toContain("Example: 0981 123 456");
  });

  it("can always be turned OFF, even without a phone", () => {
    renderSwitch({ savedPhone: null, optIn: true });
    expect((screen.getByTestId("client-whatsapp-switch") as HTMLInputElement).disabled).toBe(false);
  });

  it("is blocked while the phone field has unsaved edits", () => {
    renderSwitch({ phoneDirty: true });
    expect((screen.getByTestId("client-whatsapp-switch") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId("client-whatsapp-hint").textContent).toContain("Save the phone change first");
  });

  it("is blocked for an inactive client", () => {
    renderSwitch({ active: false });
    expect((screen.getByTestId("client-whatsapp-switch") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId("client-whatsapp-hint").textContent).toContain("Reactivate the client");
  });

  it("shows the translated reason in red when the server refuses", async () => {
    vi.mocked(api.setClientWhatsAppConsent).mockRejectedValue(
      new Error(JSON.stringify({ error: "WHATSAPP_PHONE_OPTED_OUT" })),
    );
    const user = userEvent.setup();
    renderSwitch();

    await user.click(screen.getByTestId("client-whatsapp-switch"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("asked not to receive WhatsApp notices");
  });
});
