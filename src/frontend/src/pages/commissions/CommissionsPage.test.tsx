import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../../i18n";
import CommissionsPage from "./CommissionsPage";

const femmeJson = vi.fn();
vi.mock("../../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: vi.fn(),
  femmePutJson: vi.fn(),
}));
vi.mock("../../hooks/useFeatureFlags", () => ({
  useFeatureFlag: () => true,
  useFeatureFlagsState: () => ({ loading: false }),
}));
vi.mock("../../hooks/useMe", () => ({ useMe: () => ({ me: { role: "ADMIN" } }) }));

const settlements = {
  items: [
    {
      id: 14,
      professionalId: 1,
      professionalName: "Laura Gómez",
      periodFrom: "2026-10-16",
      periodTo: "2026-10-31",
      status: "DRAFT",
      totalAmount: 223500,
      createdAt: "2026-10-31T10:00:00Z",
      approvedAt: null,
      paidAt: null,
      paymentMethod: null,
      paymentReference: null,
      voidReason: null,
    },
    {
      id: 11,
      professionalId: 2,
      professionalName: "Ana Duarte",
      periodFrom: "2026-10-01",
      periodTo: "2026-10-15",
      status: "PAID",
      totalAmount: 38500,
      createdAt: "2026-10-16T10:00:00Z",
      approvedAt: null,
      paidAt: null,
      paymentMethod: "CASH",
      paymentReference: null,
      voidReason: null,
    },
  ],
  page: 0,
  size: 20,
  total: 2,
};
const settings = {
  base: "NET_OF_TAX",
  defaultPercentService: 10,
  defaultPercentProduct: 10,
  periodicity: "BIWEEKLY",
  currentPeriod: { periodicity: "BIWEEKLY", from: "2026-10-16", to: "2026-10-31", nextFrom: "2026-11-01" },
  scheduledChanges: [],
  history: [],
};
const rulesView = (kind: string) => ({
  kind,
  date: "2026-10-31",
  baseType: "NET_OF_TAX",
  generalPercent: 10,
  itemCount: 1,
  itemsWithExceptions: 1,
  professionals: [{ id: 1, fullName: "Laura Gómez" }],
  categories: [
    {
      categoryId: 1,
      name: "Cabello",
      exceptions: 1,
      items: [
        {
          serviceId: 3,
          name: kind === "SERVICE" ? "Tintura pelo corto" : "Shampoo nutritivo",
          price: 180000,
          baseAmount: 180000,
          standardPercent: 45,
          ownStandard: true,
          exceptions: [{ professionalId: 1, professionalName: "Laura Gómez", professionalActive: true, percent: 50 }],
          scheduled: false,
        },
      ],
    },
  ],
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/commissions"]}>
      <Routes>
        <Route
          path="/app/commissions"
          element={
            <I18nextProvider i18n={i18n}>
              <ThemeProvider>
                <CommissionsPage />
              </ThemeProvider>
            </I18nextProvider>
          }
        />
        <Route path="/app/commissions/settlements/:id" element={<div>Settlement detail page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const urls = () => femmeJson.mock.calls.map((c) => String(c[0]));

describe("CommissionsPage (redesigned)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    femmeJson.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/commissions/settlements")) return settlements;
      if (url.startsWith("/api/commissions/settings")) return settings;
      if (url.startsWith("/api/commissions/rules")) return rulesView(url.includes("PRODUCT") ? "PRODUCT" : "SERVICE");
      if (url.startsWith("/api/commissions/entries")) return [];
      if (url.startsWith("/api/professionals")) return [{ id: 1, fullName: "Laura Gómez", active: true }];
      return [];
    });
  });
  afterEach(() => {
    cleanup();
    femmeJson.mockReset();
  });

  it("shows three tabs, the generate action and compact settlement rows", async () => {
    renderPage();
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual(["Settlements", "Movements", "Rules"]);
    expect(await screen.findByText("Laura Gómez")).toBeTruthy();
    expect(screen.getByTestId("commission-generate-open")).toBeTruthy();
    expect(screen.getAllByTestId("commission-settlement-row")).toHaveLength(2);
    expect(screen.getByText(/BIWEEKLY|Biweekly|1–15/i)).toBeTruthy();
  });

  it("filters settlements by status chip", async () => {
    renderPage();
    await screen.findByText("Laura Gómez");
    await userEvent.click(screen.getByTestId("settlements-chip-PAID"));
    await waitFor(() => expect(urls().some((u) => u.includes("status=PAID"))).toBe(true));
    expect(screen.getByTestId("settlements-chip-PAID").getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the generate dialog with the current period prefilled", async () => {
    renderPage();
    await screen.findByText("Laura Gómez");
    await userEvent.click(screen.getByTestId("commission-generate-open"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("commission-generate-settlements")).toBeTruthy();
  });

  it("lists rules as rows and stages an exception removal behind the pending bar", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Rules" }));
    const row = await screen.findByTestId("rules-row-3");
    expect(within(row).getByText("Tintura pelo corto")).toBeTruthy();
    expect(screen.getByTestId("rules-standard-3").textContent).toContain("45");
    expect(screen.queryByTestId("rules-pending-bar")).toBeNull();
    await userEvent.click(row);
    await userEvent.click(await screen.findByTestId("rules-change-standard"));
    const input = screen.getByTestId("rules-standard-input");
    await userEvent.clear(input);
    await userEvent.type(input, "42");
    await userEvent.click(screen.getByTestId("rules-standard-apply"));
    await userEvent.click(screen.getByTestId("rules-panel-close"));
    expect(await screen.findByTestId("rules-pending-bar")).toBeTruthy();
    expect(screen.getByTestId("rules-pending-count").textContent).toMatch(/1/);
    await userEvent.click(screen.getByTestId("rules-discard"));
    expect(screen.queryByTestId("rules-pending-bar")).toBeNull();
  });

  it("reaches Settings from the more menu and lists the four settings", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Settings" }));
    expect(await screen.findByTestId("commission-setting-BASE")).toBeTruthy();
    expect(screen.getByTestId("commission-setting-DEFAULT_SERVICE")).toBeTruthy();
    expect(screen.getByTestId("commission-setting-DEFAULT_PRODUCT")).toBeTruthy();
    expect(screen.getByTestId("commission-setting-PERIODICITY")).toBeTruthy();
    expect(screen.getByTestId("commissions-more-title").textContent).toBe("Settings");
  });
});
