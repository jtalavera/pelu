import { expect, test, type Page } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  apiPostJsonStatus,
  authHeaders,
  loginAsDemoApi,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// Catálogo separado: menú "Productos" (debajo de "Servicios"), cada pantalla con SOLO los ítems de
// su tipo, filtros acotados al tipo y solapa de Categorías exclusiva para servicios / productos.

type Cat = { id: number; name: string; kind: string };
type Item = { id: number; name: string; kind: string; sku: string | null };

async function seedCatalog(request: Parameters<typeof loginAsDemoApi>[0]) {
  const token = await loginAsDemoApi(request);
  const s = Date.now();
  const serviceCategory = await apiPostJson<Cat>(request, token, "/api/service-categories", {
    name: `E2E Cat Serv ${s}`,
    accentKey: "stone",
    kind: "SERVICE",
  });
  const productCategory = await apiPostJson<Cat>(request, token, "/api/service-categories", {
    name: `E2E Cat Prod ${s}`,
    accentKey: "stone",
    kind: "PRODUCT",
  });
  const service = await apiPostJson<Item>(request, token, "/api/services", {
    name: `E2E Sep ${s} Corte`,
    categoryId: serviceCategory.id,
    priceMinor: 50000,
    durationMinutes: 30,
  });
  const product = await apiPostJson<Item>(request, token, "/api/services", {
    name: `E2E Sep ${s} Shampoo`,
    categoryId: productCategory.id,
    priceMinor: 95000,
    durationMinutes: 1,
    kind: "PRODUCT",
    sku: `SEP-${s}`,
  });
  return { token, stamp: s, serviceCategory, productCategory, service, product };
}

async function searchItems(page: Page, text: string) {
  await page.locator("#services-list-filter").fill(text);
  await page.waitForTimeout(600); // list search is debounced (350 ms)
}

test.describe("Menú Productos separado de Servicios", () => {
  test("el menú Productos aparece justo debajo de Servicios y abre /app/products", async ({ page }) => {
    await loginAsDemo(page);
    const services = page.locator('[data-tour="nav-services"]');
    const products = page.locator('[data-tour="nav-products"]');
    await expect(services).toBeVisible();
    await expect(products).toBeVisible();
    await expect(products).toContainText("Products");

    // Same sidebar, products link immediately after the services one.
    const immediatelyAfter = await services.evaluate(
      (el) => el.nextElementSibling === document.querySelector('[data-tour="nav-products"]'),
    );
    expect(immediatelyAfter).toBe(true);

    await products.click();
    await expect(page).toHaveURL(/\/app\/products$/);
    await expect(page.locator('[data-tour="services-header"]')).toContainText("Products");
    await expect(page.getByRole("button", { name: "+ New product" })).toBeVisible();
  });

  test("Servicios lista SOLO servicios y Productos lista SOLO productos", async ({ page, request }) => {
    const { stamp, service, product } = await seedCatalog(request);
    await loginAsDemo(page);

    await page.goto("/app/services");
    await searchItems(page, `E2E Sep ${stamp}`);
    await expect(page.getByTestId(`svc-row-${service.id}`)).toBeVisible();
    await expect(page.getByTestId(`svc-row-${product.id}`)).toHaveCount(0);

    await page.goto("/app/products");
    await searchItems(page, `E2E Sep ${stamp}`);
    await expect(page.getByTestId(`svc-row-${product.id}`)).toBeVisible();
    await expect(page.getByTestId(`svc-row-${service.id}`)).toHaveCount(0);
  });

  test("filtros: sin filtro por tipo, y las píldoras de categoría solo muestran categorías del tipo", async ({
    page,
    request,
  }) => {
    const { serviceCategory, productCategory } = await seedCatalog(request);
    await loginAsDemo(page);

    await page.goto("/app/services");
    const serviceFilters = page.locator('[data-tour="services-filters"]');
    await expect(serviceFilters.getByRole("button", { name: serviceCategory.name, exact: true })).toBeVisible();
    await expect(serviceFilters.getByRole("button", { name: productCategory.name, exact: true })).toHaveCount(0);
    await expect(serviceFilters.getByRole("button", { name: "All categories", exact: true })).toBeVisible();
    await expect(serviceFilters.getByRole("button", { name: "All statuses", exact: true })).toBeVisible();
    await expect(page.getByTestId("services-kind-filter")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "All types" })).toHaveCount(0);

    await page.goto("/app/products");
    const productFilters = page.locator('[data-tour="services-filters"]');
    await expect(productFilters.getByRole("button", { name: productCategory.name, exact: true })).toBeVisible();
    await expect(productFilters.getByRole("button", { name: serviceCategory.name, exact: true })).toHaveCount(0);
    await expect(productFilters.getByRole("button", { name: "All categories", exact: true })).toBeVisible();
    await expect(productFilters.getByRole("button", { name: "All statuses", exact: true })).toBeVisible();
    await expect(page.getByTestId("services-kind-filter")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "All types" })).toHaveCount(0);
  });

  test("filtros de Productos: categoría, estado y búsqueda se aplican solo sobre productos", async ({
    page,
    request,
  }) => {
    const { token, stamp, productCategory, product } = await seedCatalog(request);
    const second = await apiPostJson<Item>(request, token, "/api/services", {
      name: `E2E Sep ${stamp} Acondicionador`,
      categoryId: productCategory.id,
      priceMinor: 70000,
      durationMinutes: 1,
      kind: "PRODUCT",
    });
    await apiPostJson(request, token, `/api/services/${second.id}/deactivate`, {});
    await loginAsDemo(page);
    await page.goto("/app/products");

    // Category pill.
    await page.locator('[data-tour="services-filters"]').getByRole("button", { name: productCategory.name, exact: true }).click();
    await expect(page.getByTestId(`svc-row-${product.id}`)).toBeVisible();
    await expect(page.getByTestId(`svc-row-${second.id}`)).toBeVisible();

    // Status filter (Inactive only) keeps only the deactivated product.
    await page.locator('[data-tour="services-filters"]').getByRole("button", { name: "Inactive only" }).click();
    await expect(page.getByTestId(`svc-row-${second.id}`)).toBeVisible();
    await expect(page.getByTestId(`svc-row-${product.id}`)).toHaveCount(0);
    await page.locator('[data-tour="services-filters"]').getByRole("button", { name: "All statuses" }).click();

    // Text search + no-match message.
    await searchItems(page, `E2E Sep ${stamp} Shampoo`);
    await expect(page.getByTestId(`svc-row-${product.id}`)).toBeVisible();
    await expect(page.getByTestId(`svc-row-${second.id}`)).toHaveCount(0);
    await searchItems(page, "zzzznonexistent");
    await expect(page.getByText("No rows match your filter.")).toBeVisible();
  });

  test("cada pantalla tiene su solapa de Categorías exclusiva", async ({ page, request }) => {
    const { serviceCategory, productCategory } = await seedCatalog(request);
    await loginAsDemo(page);

    await page.goto("/app/services");
    await page.getByRole("button", { name: "Categories", exact: true }).click();
    await expect(page.getByTestId(`cat-row-${serviceCategory.id}`)).toBeVisible();
    await expect(page.getByTestId(`cat-row-${productCategory.id}`)).toHaveCount(0);

    await page.goto("/app/products");
    await page.getByRole("button", { name: "Categories", exact: true }).click();
    await expect(page.getByTestId(`cat-row-${productCategory.id}`)).toBeVisible();
    await expect(page.getByTestId(`cat-row-${serviceCategory.id}`)).toHaveCount(0);
    // Product categories count products, not services.
    await expect(page.getByTestId(`cat-row-${productCategory.id}`)).toContainText("1 products");
  });

  test("una categoría creada en Productos solo existe para productos", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const name = `E2E Cat Nueva Prod ${Date.now()}`;
    await loginAsDemo(page);
    await page.goto("/app/products");
    await page.getByRole("button", { name: "Categories", exact: true }).click();
    await page.getByRole("button", { name: "+ New category" }).click();
    const categoryDialog = page.getByRole("dialog", { name: "New category" });
    await categoryDialog.getByLabel("Name").fill(name);
    await categoryDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(categoryDialog).not.toBeVisible();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

    const productCats = await request.get(`${API_BASE}/api/service-categories?kind=PRODUCT`, { headers: authHeaders(token) });
    const serviceCats = await request.get(`${API_BASE}/api/service-categories?kind=SERVICE`, { headers: authHeaders(token) });
    expect(((await productCats.json()) as Cat[]).map((c) => c.name)).toContain(name);
    expect(((await serviceCats.json()) as Cat[]).map((c) => c.name)).not.toContain(name);

    // The product form offers it; the service form does not.
    await page.getByRole("button", { name: "Products", exact: true }).click();
    await page.getByRole("button", { name: "+ New product" }).click();
    await expect(page.locator("#svc-cat").locator("option", { hasText: name })).toHaveCount(1);
    await page.goto("/app/services");
    await page.getByRole("button", { name: "+ New service" }).click();
    await expect(page.locator("#svc-cat").locator("option", { hasText: name })).toHaveCount(0);
  });

  test("formulario de Productos: sin Tipo ni Duración, con SKU; crea un ítem tipo Producto", async ({
    page,
    request,
  }) => {
    const { token, productCategory } = await seedCatalog(request);
    const name = `E2E Producto UI ${Date.now()}`;
    await loginAsDemo(page);
    await page.goto("/app/products");
    await page.getByRole("button", { name: "+ New product" }).click();
    const dialog = page.getByRole("dialog", { name: "New product" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#svc-duration")).toHaveCount(0);
    await expect(dialog.locator("#svc-kind")).toHaveCount(0);
    await expect(dialog.locator("#svc-sku")).toBeVisible();

    await dialog.getByLabel("Name").fill(name);
    await dialog.locator("#svc-sku").fill("UI-300");
    await dialog.locator("#svc-cat").selectOption({ label: productCategory.name });
    await dialog.getByLabel("Price").fill("45000");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Product saved successfully.", { exact: true })).toBeVisible();

    await searchItems(page, name);
    const row = page.locator('[data-testid^="svc-row-"]').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("UI-300");
    await expect(row).not.toContainText("min");
    await expect(page.getByRole("columnheader", { name: "Duration" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Code (SKU)" })).toBeVisible();

    const res = await request.get(`${API_BASE}/api/services?kind=PRODUCT&q=${encodeURIComponent(name)}`, {
      headers: authHeaders(token),
    });
    const created = ((await res.json()) as Item[]).find((i) => i.name === name);
    expect(created).toMatchObject({ kind: "PRODUCT", sku: "UI-300" });
  });

  test("formulario de Servicios: con Duración, sin Tipo ni SKU", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.getByRole("button", { name: "+ New service" }).click();
    const dialog = page.getByRole("dialog", { name: "New service" });
    await expect(dialog.locator("#svc-duration")).toBeVisible();
    await expect(dialog.locator("#svc-kind")).toHaveCount(0);
    await expect(dialog.locator("#svc-sku")).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Duration" })).toBeVisible();
  });

  test("la API rechaza mezclar tipos: producto en categoría de servicios y viceversa", async ({ request }) => {
    const { token, serviceCategory, productCategory } = await seedCatalog(request);

    const productInServiceCat = await apiPostJsonStatus(request, token, "/api/services", {
      name: `E2E Mezcla ${Date.now()} A`,
      categoryId: serviceCategory.id,
      priceMinor: 1000,
      durationMinutes: 1,
      kind: "PRODUCT",
    });
    expect(productInServiceCat.status).toBe(400);
    expect(productInServiceCat.text).toContain("CATEGORY_KIND_MISMATCH");

    const serviceInProductCat = await apiPostJsonStatus(request, token, "/api/services", {
      name: `E2E Mezcla ${Date.now()} B`,
      categoryId: productCategory.id,
      priceMinor: 1000,
      durationMinutes: 30,
      kind: "SERVICE",
    });
    expect(serviceInProductCat.status).toBe(400);
    expect(serviceInProductCat.text).toContain("CATEGORY_KIND_MISMATCH");

    // Without an explicit kind the item inherits the category's.
    const inherited = await apiPostJson<Item>(request, token, "/api/services", {
      name: `E2E Hereda ${Date.now()}`,
      categoryId: productCategory.id,
      priceMinor: 1000,
      durationMinutes: 1,
    });
    expect(inherited.kind).toBe("PRODUCT");

    // A category cannot switch between Servicios and Productos.
    const switched = await request.put(`${API_BASE}/api/service-categories/${serviceCategory.id}`, {
      headers: authHeaders(token),
      data: { name: serviceCategory.name, accentKey: "stone", kind: "PRODUCT" },
    });
    expect(switched.status()).toBe(400);
    expect(await switched.text()).toContain("CATEGORY_KIND_IMMUTABLE");
  });

  test("el catálogo por tipo de la API (?kind=) separa servicios y productos", async ({ request }) => {
    const { token, serviceCategory, productCategory, service, product } = await seedCatalog(request);
    const get = async <T>(path: string) =>
      (await (await request.get(`${API_BASE}${path}`, { headers: authHeaders(token) })).json()) as T;

    const serviceIds = (await get<Item[]>("/api/services?kind=SERVICE")).map((i) => i.id);
    const productIds = (await get<Item[]>("/api/services?kind=PRODUCT")).map((i) => i.id);
    expect(serviceIds).toContain(service.id);
    expect(serviceIds).not.toContain(product.id);
    expect(productIds).toContain(product.id);
    expect(productIds).not.toContain(service.id);

    const serviceCatIds = (await get<Cat[]>("/api/service-categories?kind=SERVICE")).map((c) => c.id);
    const productCatIds = (await get<Cat[]>("/api/service-categories?kind=PRODUCT")).map((c) => c.id);
    expect(serviceCatIds).toContain(serviceCategory.id);
    expect(serviceCatIds).not.toContain(productCategory.id);
    expect(productCatIds).toContain(productCategory.id);
    expect(productCatIds).not.toContain(serviceCategory.id);
  });

  test("el calendario ofrece solo servicios al agendar (no productos)", async ({ page }) => {
    await loginAsDemo(page);
    const request = page.waitForRequest((r) => r.url().includes("/api/services?kind=SERVICE"));
    await page.goto("/app/calendar");
    await request;
  });
});
