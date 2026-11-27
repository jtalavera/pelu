import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import * as api from "../api/platformWhatsapp";
import type { WhatsAppStatus } from "../api/platformWhatsapp";
import i18n from "../i18n";
import PlatformWhatsAppPage from "./PlatformWhatsAppPage";

vi.mock("../api/platformWhatsapp", () => ({
  getWhatsAppStatus: vi.fn(),
  refreshWhatsAppTemplates: vi.fn(),
  acknowledgeWhatsAppAlert: vi.fn(),
  sendWhatsAppTest: vi.fn(),
}));

function template(name: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    language: "es",
    category: "UTILITY",
    bodyVariables: 5,
    buttons: 1,
    bodyText: "Hola {{1}}",
    status,
    reason: null,
    checkedAt: "2026-11-26T12:00:00Z",
    ...extra,
  };
}

function status(overrides: Partial<WhatsAppStatus> = {}): WhatsAppStatus {
  return {
    enabled: true,
    provider: "meta",
    operational: true,
    configurationProblems: [],
    apiVersion: "v21.0",
    templates: [
      template("pelu_turno_confirmado", "APPROVED"),
      template("pelu_turno_cancelado", "PAUSED", { reason: "LOW_QUALITY" }),
    ],
    alerts: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <PlatformWhatsAppPage />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

describe("PlatformWhatsAppPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    void i18n.changeLanguage("en");
    vi.mocked(api.getWhatsAppStatus).mockReset().mockResolvedValue(status());
    vi.mocked(api.refreshWhatsAppTemplates).mockReset();
    vi.mocked(api.acknowledgeWhatsAppAlert).mockReset();
    vi.mocked(api.sendWhatsAppTest).mockReset();
  });

  it("shows each template with its approval status", async () => {
    renderPage();
    const ok = await screen.findByTestId("whatsapp-template-status-pelu_turno_confirmado");
    expect(ok.textContent).toBe("Approved");
    const paused = screen.getByTestId("whatsapp-template-pelu_turno_cancelado");
    expect(within(paused).getByText("Paused")).toBeTruthy();
    expect(within(paused).getByText("LOW_QUALITY")).toBeTruthy();
  });

  it("lists only the NAMES of missing configuration values", async () => {
    vi.mocked(api.getWhatsAppStatus).mockResolvedValue(
      status({
        operational: false,
        configurationProblems: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET"],
      }),
    );
    renderPage();
    const box = await screen.findByTestId("whatsapp-config-problems");
    expect(box.textContent).toContain("WHATSAPP_ACCESS_TOKEN");
    expect(box.textContent).toContain("WHATSAPP_APP_SECRET");
    expect(screen.getByTestId("whatsapp-operational").textContent).toBe("No");
  });

  it("shows open alerts and dismisses one", async () => {
    const alert = {
      id: 7,
      category: "WHATSAPP_TEMPLATE_PAUSED",
      subject: "pelu_turno_cancelado",
      detail: "LOW_QUALITY",
      createdAt: "2026-11-26T12:00:00Z",
    };
    vi.mocked(api.getWhatsAppStatus).mockResolvedValue(status({ alerts: [alert] }));
    vi.mocked(api.acknowledgeWhatsAppAlert).mockResolvedValue(status({ alerts: [] }));
    const user = userEvent.setup();
    renderPage();

    const row = await screen.findByTestId("whatsapp-alert-7");
    expect(row.textContent).toContain("Template paused");
    await user.click(within(row).getByRole("button", { name: "Dismiss alert" }));

    expect(api.acknowledgeWhatsAppAlert).toHaveBeenCalledWith(7);
    expect(await screen.findByTestId("whatsapp-no-alerts")).toBeTruthy();
  });

  it("refreshes the template statuses from Meta", async () => {
    vi.mocked(api.refreshWhatsAppTemplates).mockResolvedValue(
      status({ templates: [template("pelu_turno_confirmado", "REJECTED", { reason: "INCORRECT_CATEGORY" })] }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("whatsapp-templates");

    await user.click(screen.getByTestId("whatsapp-refresh"));

    await waitFor(() =>
      expect(
        screen.getByTestId("whatsapp-template-status-pelu_turno_confirmado").textContent,
      ).toBe("Rejected"),
    );
  });

  it("asks for a destination phone before sending a test", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("whatsapp-test-send");

    await user.click(screen.getByTestId("whatsapp-test-send"));

    const err = await screen.findByRole("alert");
    expect(err.textContent).toContain("Example: 0981 123 456");
    expect(api.sendWhatsAppTest).not.toHaveBeenCalled();
  });

  it("sends a test and shows the message id; shows the translated error on failure", async () => {
    vi.mocked(api.sendWhatsAppTest)
      .mockResolvedValueOnce({ wamid: "wamid.ABC" })
      .mockRejectedValueOnce(new Error(JSON.stringify({ error: "WHATSAPP_TEMPLATE_UNAVAILABLE" })));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("whatsapp-test-send");

    await user.type(screen.getByLabelText("Destination phone"), "0981 123 456");
    await user.click(screen.getByTestId("whatsapp-test-send"));
    expect((await screen.findByTestId("whatsapp-test-result")).textContent).toContain("wamid.ABC");
    expect(api.sendWhatsAppTest).toHaveBeenCalledWith("0981 123 456", "pelu_turno_confirmado");

    await user.click(screen.getByTestId("whatsapp-test-send"));
    expect((await screen.findByTestId("whatsapp-test-error")).textContent).toBe(
      "The template is not approved by Meta.",
    );
  });
});
