import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "../test/renderWithTour";
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

const defaultHomologation = {
  status: "PENDING",
  markedByEmail: null,
  markedAt: null,
};

describe("FeatureFlagsPage (acceptance: system admin can review guided tour flag)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    refetch.mockReset();
    vi.mocked(femmeClient.femmeJson).mockReset();
    vi.mocked(femmeClient.femmePutJson).mockReset();
    vi.mocked(femmeClient.femmeDeleteJson).mockReset();
    vi.mocked(femmeClient.femmeJson).mockImplementation(async (path: string) => {
      if (path.endsWith("/sifen-homologation")) {
        return defaultHomologation as never;
      }
      return [
        {
          flagKey: "GUIDED_TOUR",
          description: "Show guided tour tooltips on every screen",
          globalEnabled: true,
          hasOverride: false,
          overrideEnabled: null,
        },
      ] as never;
    });
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

  it("shows the last-change history when present (SIFEN HU-22 AC-05)", async () => {
    vi.mocked(femmeClient.femmeJson).mockImplementation(async (path: string) => {
      if (path.endsWith("/sifen-homologation")) {
        return defaultHomologation as never;
      }
      return [
        {
          flagKey: "SIFEN_ELECTRONIC_INVOICING",
          description: "Route new invoices through SIFEN",
          globalEnabled: false,
          hasOverride: true,
          overrideEnabled: true,
          lastChange: {
            changedAt: "2026-08-01T15:30:00Z",
            changedByEmail: "root@pelu",
            previousEnabled: false,
            newEnabled: true,
          },
        },
      ] as never;
    });

    renderPage();
    const history = await screen.findByTestId("feature-flag-history-SIFEN_ELECTRONIC_INVOICING");
    expect(history.textContent).toContain("root@pelu");
    expect(history.textContent).toContain("Off");
    expect(history.textContent).toContain("On");
  });

  /** RT-19 (Hardening_SIFEN.md): warns a SYSTEM_ADMIN before relying on SIFEN in a tenant still PENDING. */
  it("shows a pending homologación warning next to SIFEN_ELECTRONIC_INVOICING", async () => {
    vi.mocked(femmeClient.femmeJson).mockImplementation(async (path: string) => {
      if (path.endsWith("/sifen-homologation")) {
        return defaultHomologation as never;
      }
      return [
        {
          flagKey: "SIFEN_ELECTRONIC_INVOICING",
          description: "Route new invoices through SIFEN",
          globalEnabled: false,
          hasOverride: false,
          overrideEnabled: null,
          lastChange: null,
        },
      ] as never;
    });

    renderPage();
    expect(await screen.findByText("Pending")).toBeTruthy();
    expect(
      screen.getByText(/not marked as having completed SIFEN homologación/),
    ).toBeTruthy();
  });

  /** RT-19: a SYSTEM_ADMIN can record that a tenant passed homologación. */
  it("marks homologación as approved and refreshes the badge", async () => {
    const user = userEvent.setup();
    vi.mocked(femmeClient.femmeJson).mockImplementation(async (path: string) => {
      if (path.endsWith("/sifen-homologation")) {
        return defaultHomologation as never;
      }
      return [
        {
          flagKey: "SIFEN_ELECTRONIC_INVOICING",
          description: "Route new invoices through SIFEN",
          globalEnabled: false,
          hasOverride: false,
          overrideEnabled: null,
          lastChange: null,
        },
      ] as never;
    });
    vi.mocked(femmeClient.femmePutJson).mockResolvedValue({
      status: "APPROVED",
      markedByEmail: "root@pelu",
      markedAt: "2026-08-12T10:00:00Z",
    });

    renderPage();
    const markButton = await screen.findByText("Mark as approved");
    await user.click(markButton);

    await waitFor(() => {
      expect(vi.mocked(femmeClient.femmePutJson)).toHaveBeenCalledWith(
        "/api/admin/feature-flags/tenants/1/sifen-homologation",
        { status: "APPROVED" },
      );
    });
    expect(await screen.findByText("Approved")).toBeTruthy();
  });
});
