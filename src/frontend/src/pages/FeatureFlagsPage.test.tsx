import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import * as femmeClient from "../api/femmeClient";
import i18n from "../i18n";
import FeatureFlagsPage from "./FeatureFlagsPage";

let meRole: "PLATFORM_ADMIN" | "ADMIN" = "PLATFORM_ADMIN";
vi.mock("../hooks/useMe", () => ({
  useMe: () => ({
    me: {
      userId: 1,
      tenantId: meRole === "PLATFORM_ADMIN" ? null : 1,
      email: meRole === "PLATFORM_ADMIN" ? "platform-admin@pelu" : "admin@tenant.test",
      role: meRole,
      professionalId: null,
    },
    loading: false,
  }),
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

const defaultTenantSearchResult = {
  content: [
    { id: 1, name: "Tenant One", domain: null, tierId: null, tierName: null, status: "ACTIVE" },
  ],
  page: 0,
  size: 8,
  totalElements: 1,
  totalPages: 1,
};

/** Searches for and selects "Tenant One" via the tenant search field (HU-36: Platform Admin picks
 * the tenant explicitly — there is no implicit preview tenant anymore) so the page loads tenant
 * #1's rows, mirroring what every test below needs before it can assert on the loaded
 * feature-flag list. */
async function submitTenantId(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByLabelText("Organization");
  await user.type(input, "Tenant");
  await user.click(await screen.findByRole("button", { name: /Tenant One/i }));
}

describe("FeatureFlagsPage (acceptance: Platform Admin can review guided tour flag)", () => {
  afterEach(cleanup);

  beforeEach(() => {
    meRole = "PLATFORM_ADMIN";
    void i18n.changeLanguage("en");
    vi.mocked(femmeClient.femmeJson).mockReset();
    vi.mocked(femmeClient.femmePutJson).mockReset();
    vi.mocked(femmeClient.femmeDeleteJson).mockReset();
    vi.mocked(femmeClient.femmeJson).mockImplementation(async (path: string) => {
      if (path.includes("/api/platform/tenants")) {
        return defaultTenantSearchResult as never;
      }
      if (path.endsWith("/sifen-homologation")) {
        return defaultHomologation as never;
      }
      return [
        {
          flagKey: "GUIDED_TOUR",
          description: "Show guided tour tooltips on every screen",
          globalEnabled: true,
          hasTier: false,
          tierEnabled: null,
          hasOverride: false,
          overrideEnabled: null,
          effectiveEnabled: true,
          effectiveSource: "GLOBAL",
        },
      ] as never;
    });
    vi.mocked(femmeClient.femmePutJson).mockResolvedValue({});
    vi.mocked(femmeClient.femmeDeleteJson).mockResolvedValue(undefined);
  });

  it("shows a tenant search field before loading anything", async () => {
    renderPage();
    expect(await screen.findByLabelText("Organization")).toBeTruthy();
    expect(vi.mocked(femmeClient.femmeJson)).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/feature-flags"),
      expect.anything(),
    );
  });

  it("loads rows for the entered tenant and shows GUIDED_TOUR and global/tenant labels", async () => {
    const user = userEvent.setup();
    renderPage();
    await submitTenantId(user);

    expect(await screen.findByText("GUIDED_TOUR")).toBeTruthy();
    expect(screen.getByText("Global default")).toBeTruthy();
    expect(screen.getByText("This organization")).toBeTruthy();
    expect(screen.getByText("Using global default")).toBeTruthy();
    expect(screen.getByText("Managing Tenant One.")).toBeTruthy();
    expect(vi.mocked(femmeClient.femmeJson)).toHaveBeenCalledWith(
      "/api/admin/feature-flags/tenants/1",
      { json: false },
    );
  });

  // HU-47 AC-4: the tenant admin view shows explicitly which of the 3 levels (global/tier/override)
  // produced the currently-effective value.
  it("shows the tier default and the tier as the effective source when the tenant's tier defines the flag", async () => {
    const user = userEvent.setup();
    vi.mocked(femmeClient.femmeJson).mockImplementation(async (path: string) => {
      if (path.includes("/api/platform/tenants")) {
        return defaultTenantSearchResult as never;
      }
      if (path.endsWith("/sifen-homologation")) {
        return defaultHomologation as never;
      }
      return [
        {
          flagKey: "GUIDED_TOUR",
          description: "Show guided tour tooltips on every screen",
          globalEnabled: true,
          hasTier: true,
          tierEnabled: false,
          hasOverride: false,
          overrideEnabled: null,
          effectiveEnabled: false,
          effectiveSource: "TIER",
        },
      ] as never;
    });

    renderPage();
    await submitTenantId(user);

    expect(await screen.findByText("Tier default")).toBeTruthy();
    expect(screen.getByText("Using tier default")).toBeTruthy();
    const source = screen.getByTestId("feature-flag-source-GUIDED_TOUR");
    expect(source.textContent).toContain("From tier default");
  });

  it("shows the organization override as the effective source even when the tier also defines the flag", async () => {
    const user = userEvent.setup();
    vi.mocked(femmeClient.femmeJson).mockImplementation(async (path: string) => {
      if (path.includes("/api/platform/tenants")) {
        return defaultTenantSearchResult as never;
      }
      if (path.endsWith("/sifen-homologation")) {
        return defaultHomologation as never;
      }
      return [
        {
          flagKey: "GUIDED_TOUR",
          description: "Show guided tour tooltips on every screen",
          globalEnabled: true,
          hasTier: true,
          tierEnabled: false,
          hasOverride: true,
          overrideEnabled: true,
          effectiveEnabled: true,
          effectiveSource: "OVERRIDE",
        },
      ] as never;
    });

    renderPage();
    await submitTenantId(user);

    const source = screen.getByTestId("feature-flag-source-GUIDED_TOUR");
    expect(source.textContent).toContain("From organization override");
  });

  it("toggling global default calls admin PUT and reloads the tenant view", async () => {
    const user = userEvent.setup();
    renderPage();
    await submitTenantId(user);
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
    // Reloads the tenant view after the write (no separate app-level flags cache to refresh —
    // Platform Admin never mounts FeatureFlagProvider, see FeatureFlagsPage.tsx).
    await waitFor(() => {
      expect(vi.mocked(femmeClient.femmeJson)).toHaveBeenCalledWith(
        "/api/admin/feature-flags/tenants/1",
        { json: false },
      );
    });
  });

  it("changing tenant returns to the tenant search field", async () => {
    const user = userEvent.setup();
    renderPage();
    await submitTenantId(user);
    await screen.findByText("GUIDED_TOUR");

    await user.click(screen.getByRole("button", { name: "Change organization" }));

    expect(await screen.findByLabelText("Organization")).toBeTruthy();
    expect(screen.queryByText("GUIDED_TOUR")).toBeNull();
  });

  it("shows the last-change history when present (SIFEN HU-22 AC-05)", async () => {
    const user = userEvent.setup();
    vi.mocked(femmeClient.femmeJson).mockImplementation(async (path: string) => {
      if (path.includes("/api/platform/tenants")) {
        return defaultTenantSearchResult as never;
      }
      if (path.endsWith("/sifen-homologation")) {
        return defaultHomologation as never;
      }
      return [
        {
          flagKey: "SIFEN_ELECTRONIC_INVOICING",
          description: "Route new invoices through SIFEN",
          globalEnabled: false,
          hasTier: false,
          tierEnabled: null,
          hasOverride: true,
          overrideEnabled: true,
          effectiveEnabled: true,
          effectiveSource: "OVERRIDE",
          lastChange: {
            changedAt: "2026-08-01T15:30:00Z",
            changedByEmail: "platform-admin@pelu",
            previousEnabled: false,
            newEnabled: true,
          },
        },
      ] as never;
    });

    renderPage();
    await submitTenantId(user);
    const history = await screen.findByTestId("feature-flag-history-SIFEN_ELECTRONIC_INVOICING");
    expect(history.textContent).toContain("platform-admin@pelu");
    expect(history.textContent).toContain("Off");
    expect(history.textContent).toContain("On");
  });

  /** RT-19 (Hardening_SIFEN.md): warns a Platform Admin before relying on SIFEN in a tenant still PENDING. */
  it("shows a pending homologación warning next to SIFEN_ELECTRONIC_INVOICING", async () => {
    const user = userEvent.setup();
    vi.mocked(femmeClient.femmeJson).mockImplementation(async (path: string) => {
      if (path.includes("/api/platform/tenants")) {
        return defaultTenantSearchResult as never;
      }
      if (path.endsWith("/sifen-homologation")) {
        return defaultHomologation as never;
      }
      return [
        {
          flagKey: "SIFEN_ELECTRONIC_INVOICING",
          description: "Route new invoices through SIFEN",
          globalEnabled: false,
          hasTier: false,
          tierEnabled: null,
          hasOverride: false,
          overrideEnabled: null,
          effectiveEnabled: false,
          effectiveSource: "GLOBAL",
          lastChange: null,
        },
      ] as never;
    });

    renderPage();
    await submitTenantId(user);
    expect(await screen.findByText("Pending")).toBeTruthy();
    expect(
      screen.getByText(/not marked as having completed SIFEN homologación/),
    ).toBeTruthy();
  });

  /** RT-19: a Platform Admin can record that a tenant passed homologación. */
  it("marks homologación as approved and refreshes the badge", async () => {
    const user = userEvent.setup();
    vi.mocked(femmeClient.femmeJson).mockImplementation(async (path: string) => {
      if (path.includes("/api/platform/tenants")) {
        return defaultTenantSearchResult as never;
      }
      if (path.endsWith("/sifen-homologation")) {
        return defaultHomologation as never;
      }
      return [
        {
          flagKey: "SIFEN_ELECTRONIC_INVOICING",
          description: "Route new invoices through SIFEN",
          globalEnabled: false,
          hasTier: false,
          tierEnabled: null,
          hasOverride: false,
          overrideEnabled: null,
          effectiveEnabled: false,
          effectiveSource: "GLOBAL",
          lastChange: null,
        },
      ] as never;
    });
    vi.mocked(femmeClient.femmePutJson).mockResolvedValue({
      status: "APPROVED",
      markedByEmail: "platform-admin@pelu",
      markedAt: "2026-08-12T10:00:00Z",
    });

    renderPage();
    await submitTenantId(user);
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

describe("FeatureFlagsPage (non-platform-admin)", () => {
  afterEach(cleanup);

  beforeEach(() => {
    meRole = "ADMIN";
    void i18n.changeLanguage("en");
    vi.mocked(femmeClient.femmeJson).mockReset();
  });

  it("shows a forbidden message and never calls the API", async () => {
    renderPage();
    expect(
      await screen.findByText("You need Platform Admin access to manage feature flags."),
    ).toBeTruthy();
    expect(vi.mocked(femmeClient.femmeJson)).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/feature-flags"),
      expect.anything(),
    );
  });
});
