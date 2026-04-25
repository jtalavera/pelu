import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import * as femmeClient from "../api/femmeClient";
import i18n from "../i18n";
import FeatureFlagsPage from "./FeatureFlagsPage";

const refetch = vi.fn();

vi.mock("../hooks/useMe", () => ({
  useMe: () => ({
    me: {
      userId: 1,
      tenantId: 1,
      email: "root@pelu",
      role: "SYSTEM_ADMIN" as const,
      professionalId: null,
      previewTenantId: 1,
    },
    loading: false,
  }),
}));

vi.mock("../hooks/useFeatureFlags", () => ({
  useFeatureFlagsState: () => ({ refetch }),
}));

vi.mock("../api/femmeClient", () => ({
  femmeJson: vi.fn(),
  femmePutJson: vi.fn(),
  femmeDeleteJson: vi.fn(),
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <FeatureFlagsPage />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("FeatureFlagsPage (acceptance: system admin can review guided tour flag)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    refetch.mockReset();
    vi.mocked(femmeClient.femmeJson).mockReset();
    vi.mocked(femmeClient.femmePutJson).mockReset();
    vi.mocked(femmeClient.femmeDeleteJson).mockReset();
    vi.mocked(femmeClient.femmeJson).mockResolvedValue([
      {
        flagKey: "GUIDED_TOUR",
        description: "Show guided tour tooltips on every screen",
        globalEnabled: true,
        hasOverride: false,
        overrideEnabled: null,
      },
    ]);
    vi.mocked(femmeClient.femmePutJson).mockResolvedValue({});
    vi.mocked(femmeClient.femmeDeleteJson).mockResolvedValue(undefined);
  });

  it("loads rows and shows GUIDED_TOUR and global/tenant labels", async () => {
    renderPage();
    expect(await screen.findByText("GUIDED_TOUR")).toBeTruthy();
    expect(screen.getByText("Global default")).toBeTruthy();
    expect(screen.getByText("This organization")).toBeTruthy();
    expect(screen.getByText("Using global default")).toBeTruthy();
  });

  it("toggling global default calls admin PUT and refetches app flags", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("GUIDED_TOUR");
    const globalSwitch = document.getElementById("ff-global-GUIDED_TOUR");
    expect(globalSwitch).toBeTruthy();
    await user.click(globalSwitch!);
    await waitFor(() => {
      expect(vi.mocked(femmeClient.femmePutJson)).toHaveBeenCalledWith(
        "/api/admin/feature-flags/GUIDED_TOUR",
        { enabled: false, description: "Show guided tour tooltips on every screen" },
      );
    });
    expect(refetch).toHaveBeenCalled();
  });
});
