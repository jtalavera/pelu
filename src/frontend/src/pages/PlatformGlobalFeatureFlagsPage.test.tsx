import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import * as femmeClient from "../api/femmeClient";
import i18n from "../i18n";
import PlatformGlobalFeatureFlagsPage from "./PlatformGlobalFeatureFlagsPage";

let meRole: "PLATFORM_ADMIN" | "ADMIN" = "PLATFORM_ADMIN";
vi.mock("../hooks/useMe", () => ({
  useMe: () => ({
    me: { userId: 1, tenantId: null, email: "platform-admin@pelu", role: meRole, professionalId: null },
    loading: false,
  }),
}));

vi.mock("../api/femmeClient", () => ({
  femmeJson: vi.fn(),
  femmePutJson: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <PlatformGlobalFeatureFlagsPage />
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

const globalFlags = [
  { flagKey: "GUIDED_TOUR", enabled: true, description: "Show guided tour tooltips on every screen" },
  { flagKey: "SIFEN_ELECTRONIC_INVOICING", enabled: false, description: "Route new invoices through SIFEN" },
];

describe("PlatformGlobalFeatureFlagsPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    meRole = "PLATFORM_ADMIN";
    void i18n.changeLanguage("en");
    vi.mocked(femmeClient.femmeJson).mockReset();
    vi.mocked(femmeClient.femmePutJson).mockReset();
    vi.mocked(femmeClient.femmeJson).mockResolvedValue(globalFlags as never);
    vi.mocked(femmeClient.femmePutJson).mockResolvedValue({});
  });

  it("lists every global flag with its value", async () => {
    renderPage();
    expect(await screen.findByText("GUIDED_TOUR")).toBeTruthy();
    expect(screen.getByText("SIFEN_ELECTRONIC_INVOICING")).toBeTruthy();
    expect(vi.mocked(femmeClient.femmeJson)).toHaveBeenCalledWith("/api/admin/feature-flags", {
      json: false,
    });
  });

  it("toggling a flag calls the global PUT with the flag's description and reloads", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("GUIDED_TOUR");
    const toggle = document.getElementById("global-flag-GUIDED_TOUR");
    expect(toggle).toBeTruthy();
    await user.click(toggle!);
    await waitFor(() => {
      expect(vi.mocked(femmeClient.femmePutJson)).toHaveBeenCalledWith(
        "/api/admin/feature-flags/GUIDED_TOUR",
        { enabled: false, description: "Show guided tour tooltips on every screen" },
      );
    });
    await waitFor(() => {
      // reloads the list after the write (femmeJson called twice: initial + reload)
      expect(vi.mocked(femmeClient.femmeJson).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows a forbidden message and no flag list for a non-platform-admin", async () => {
    meRole = "ADMIN";
    renderPage();
    expect(
      await screen.findByText("You need Platform Admin access to manage global feature flags."),
    ).toBeTruthy();
    expect(screen.queryByTestId("global-feature-flags-list")).toBeNull();
  });
});
