import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../test/renderWithTour";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import ProductsPage from "./ProductsPage";

const femmeJson = vi.fn();
const femmePostJson = vi.fn();
const femmePutJson = vi.fn();
const listServicesPaged = vi.fn();
const downloadPriceListPdf = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: (...args: unknown[]) => femmePostJson(...args),
  femmePutJson: (...args: unknown[]) => femmePutJson(...args),
}));

vi.mock("../api/services", () => ({
  listServicesPaged: (...args: unknown[]) => listServicesPaged(...args),
}));

vi.mock("../api/downloadPriceListPdf", () => ({
  downloadPriceListPdf: (...args: unknown[]) => downloadPriceListPdf(...args),
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ProductsPage />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

const sampleCategory = {
  id: 1,
  name: "Shampoos",
  active: true,
  accentKey: "rose",
  kind: "PRODUCT",
};

const product = {
  id: 10,
  categoryId: 1,
  categoryName: "Shampoos",
  categoryAccentKey: "rose",
  name: "Shampoo 300 ml",
  priceMinor: 95000,
  durationMinutes: 1,
  active: true,
  kind: "PRODUCT",
  sku: "SH-300",
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

describe("ProductsPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJson.mockReset();
    femmePostJson.mockReset();
    femmePutJson.mockReset();
    listServicesPaged.mockReset();
    downloadPriceListPdf.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("only requests PRODUCT items and categories and has no item-type filter", async () => {
    mockLoad([sampleCategory], [product]);
    renderPage();
    await screen.findByText("Shampoo 300 ml");

    expect(femmeJson).toHaveBeenCalledWith("/api/service-categories?kind=PRODUCT");
    expect(femmeJson).toHaveBeenCalledWith("/api/services?kind=PRODUCT");
    expect(listServicesPaged).toHaveBeenCalledWith(expect.objectContaining({ kind: "PRODUCT" }));
    expect(screen.queryByTestId("services-kind-filter")).toBeNull();
  });

  it("uses product copy and shows the SKU instead of the duration", async () => {
    mockLoad([sampleCategory], [product]);
    renderPage();
    await screen.findByText("Shampoo 300 ml");

    expect(screen.getByText("Products", { selector: "div" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Product" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Code (SKU)" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Duration" })).toBeNull();
    const row = screen.getByTestId(`svc-row-${product.id}`);
    expect(row.textContent).toContain("SH-300");
    expect(row.textContent).not.toContain("min");
  });

  it("hides the duration field and creates the item as a PRODUCT", async () => {
    mockLoad([sampleCategory], []);
    femmePostJson.mockResolvedValue(product);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "+ New product" }));

    expect(await screen.findByLabelText("Code (SKU, optional)")).toBeTruthy();
    expect(screen.queryByLabelText("Duration (minutes)")).toBeNull();
    expect(screen.queryByLabelText("Type")).toBeNull();

    await userEvent.type(screen.getByLabelText("Name"), "Shampoo 300 ml");
    await userEvent.type(screen.getByLabelText("Price"), "95000");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(femmePostJson).toHaveBeenCalledWith(
        "/api/services",
        expect.objectContaining({
          name: "Shampoo 300 ml",
          categoryId: 1,
          kind: "PRODUCT",
          durationMinutes: 1,
        }),
      );
    });
  });

  it("creates new categories as PRODUCT categories", async () => {
    mockLoad([sampleCategory], []);
    femmePostJson.mockResolvedValue({ id: 5, name: "Styling", active: true, accentKey: "stone" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Categories" }));
    await userEvent.click(screen.getByRole("button", { name: "+ New category" }));
    await userEvent.type(await screen.findByLabelText("Name"), "Styling");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(femmePostJson).toHaveBeenCalledWith(
        "/api/service-categories",
        expect.objectContaining({ name: "Styling", kind: "PRODUCT" }),
      );
    });
  });

  it("shows the product count in the categories tab", async () => {
    mockLoad([sampleCategory], [product]);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Categories" }));
    expect(await screen.findByText("1 products")).toBeTruthy();
  });
});
