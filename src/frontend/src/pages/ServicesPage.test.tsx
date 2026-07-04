import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import ServicesPage from "./ServicesPage";

const femmeJson = vi.fn();
const femmePostJson = vi.fn();
const listServicesPaged = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
  femmePutJson: vi.fn(),
}));

vi.mock("../api/services", () => ({
  listServicesPaged: (...args: unknown[]) => listServicesPaged(...args),
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ServicesPage />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

const sampleCategory = { id: 1, name: "Hair", active: true, accentKey: "rose" };

const inactiveService = {
  id: 10,
  categoryId: 1,
  categoryName: "Hair",
  categoryAccentKey: "rose",
  name: "Basic cut",
  priceMinor: 10000,
  durationMinutes: 30,
  active: false,
};

function makePageResponse(items: unknown[]) {
  return { content: items, page: 0, size: 10, totalElements: items.length, totalPages: 1 };
}

function mockLoad(categories: unknown[], services: unknown[]) {
  femmeJson.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("service-categories")) {
      return Promise.resolve(categories);
    }
    // Legacy /api/services (full list for categories tab count badge)
    if (typeof url === "string" && url.includes("/api/services")) {
      return Promise.resolve(services);
    }
    return Promise.resolve(undefined);
  });
  listServicesPaged.mockResolvedValue(makePageResponse(services));
}

describe("ServicesPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePostJson.mockReset();
    listServicesPaged.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("applies inactive card styling to inactive services", async () => {
    mockLoad([sampleCategory], [inactiveService]);
    const { container } = renderPage();
    expect(await screen.findByText("Basic cut")).toBeTruthy();
    expect(container.querySelector(".card-inactive")).toBeTruthy();
  });

  it("calls activate endpoint when Reactivate is clicked in the kebab menu", async () => {
    mockLoad([sampleCategory], [inactiveService]);
    femmePostJson.mockResolvedValue({ ...inactiveService, active: true });

    renderPage();
    await screen.findByText("Basic cut");

    const trigger = screen.getByTestId(`services-row-${inactiveService.id}-trigger`);
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("menuitem", { name: /^Reactivate$/i }));

    await waitFor(() => {
      expect(femmePostJson).toHaveBeenCalledWith("/api/services/10/activate", {});
    });
  });

  it("calls activate category endpoint when Reactivate is clicked in categories list", async () => {
    const inactiveCategory = { id: 2, name: "Beard", active: false, accentKey: "stone" };
    mockLoad([sampleCategory, inactiveCategory], []);
    femmePostJson.mockResolvedValue({ ...inactiveCategory, active: true });

    renderPage();
    const categoriesTab = await screen.findByRole("button", { name: /^Categories$/i });
    await userEvent.click(categoriesTab);
    await screen.findByText("Beard");

    const reactivateButtons = screen.getAllByRole("button", { name: /^Reactivate$/i });
    await userEvent.click(reactivateButtons[0]);

    await waitFor(() => {
      expect(femmePostJson).toHaveBeenCalledWith("/api/service-categories/2/activate", {});
    });
  });

  it("inactive service row shows a kebab menu with Reactivate and clicking the row opens the edit modal", async () => {
    mockLoad([sampleCategory], [inactiveService]);
    renderPage();
    await screen.findByText("Basic cut");

    const trigger = screen.getByTestId(`services-row-${inactiveService.id}-trigger`);
    await userEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: /^Reactivate$/i })).toBeTruthy();
    await userEvent.keyboard("{Escape}");

    const row = screen.getByTestId(`svc-row-${inactiveService.id}`);
    await userEvent.click(row);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/edit service/i);
  });

  it("lists active services before inactive ones", async () => {
    const activeSvc = {
      id: 1,
      categoryId: 1,
      categoryName: "Hair",
      categoryAccentKey: "rose",
      name: "Zeta active",
      priceMinor: 5000,
      durationMinutes: 20,
      active: true,
    };
    // Server returns active-first (backend sorts by active DESC)
    const servicesActiveFirst = [activeSvc, inactiveService];
    mockLoad([sampleCategory], servicesActiveFirst);
    // Override listServicesPaged to return active-first order (matching backend sort)
    listServicesPaged.mockResolvedValue(makePageResponse(servicesActiveFirst));
    renderPage();
    await screen.findByText("Zeta active");
    const names = screen.getAllByText(/Zeta active|Basic cut/);
    expect(names[0].textContent).toContain("Zeta active");
    expect(names[1].textContent).toContain("Basic cut");
  });

  it("filters to inactive-only services when the inactive quick filter is selected", async () => {
    const activeSvc = {
      id: 1,
      categoryId: 1,
      categoryName: "Hair",
      categoryAccentKey: "rose",
      name: "Other active",
      priceMinor: 5000,
      durationMinutes: 20,
      active: true,
    };
    mockLoad([sampleCategory], [activeSvc, inactiveService]);
    renderPage();
    await screen.findByText("Other active");

    // When the inactive filter is selected, listServicesPaged is called with active:false
    listServicesPaged.mockResolvedValue(makePageResponse([inactiveService]));
    await userEvent.click(screen.getByRole("button", { name: /inactive only/i }));

    await waitFor(() => {
      expect(screen.queryByText("Other active")).toBeNull();
      expect(screen.getByText("Basic cut")).toBeTruthy();
    });
  });
});
