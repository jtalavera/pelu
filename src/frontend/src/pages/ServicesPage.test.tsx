import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import ServicesPage from "./ServicesPage";

const femmeJson = vi.fn();
const femmePostJson = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
  femmePutJson: vi.fn(),
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

function mockLoad(categories: unknown[], services: unknown[]) {
  femmeJson.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("service-categories")) {
      return Promise.resolve(categories);
    }
    if (typeof url === "string" && url.includes("/api/services")) {
      return Promise.resolve(services);
    }
    return Promise.resolve(undefined);
  });
}

describe("ServicesPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePostJson.mockReset();
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

  it("calls activate endpoint when Reactivate is clicked in the list", async () => {
    mockLoad([sampleCategory], [inactiveService]);
    femmePostJson.mockResolvedValue({ ...inactiveService, active: true });

    renderPage();
    await screen.findByText("Basic cut");

    const reactivateButtons = screen.getAllByRole("button", { name: /^Reactivate$/i });
    await userEvent.click(reactivateButtons[0]);

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

  it("inactive service row shows Reactivate and Edit for inline editing", async () => {
    mockLoad([sampleCategory], [inactiveService]);
    renderPage();
    await screen.findByText("Basic cut");

    expect(screen.getByRole("button", { name: /^Reactivate$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Edit$/i })).toBeTruthy();
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
    mockLoad([sampleCategory], [inactiveService, activeSvc]);
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

    await userEvent.click(screen.getByRole("button", { name: /inactive only/i }));

    expect(screen.queryByText("Other active")).toBeNull();
    expect(screen.getByText("Basic cut")).toBeTruthy();
  });
});
