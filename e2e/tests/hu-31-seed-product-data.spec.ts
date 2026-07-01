import { expect, test } from "@playwright/test";
import { API_BASE, loginAsDemoApi } from "../fixtures/api";

const KNOWN_CSV_PRODUCTS = [
  "CREMA JABONOSA 100ML EXEL",
  "ACEITE CORPORAL DE COCO 300ML NATURAL HONEY",
];

test.describe("HU-31 · Seed de productos desde CSV", () => {
  test.describe.configure({ mode: "serial" });

  test("HU-31 · AC3 categoría Productos existe para tenant #1 tras el reset", async ({
    request,
  }) => {
    await request.post(`${API_BASE}/api/admin/seed/reset`);
    const token = await loginAsDemoApi(request);

    const res = await request.get(`${API_BASE}/api/service-categories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const categories = (await res.json()) as Array<{ id: number; name: string }>;
    const productos = categories.find((c) => c.name === "Productos");
    expect(productos, "Productos category not found").toBeTruthy();
  });

  test("HU-31 · AC1/AC2 productos del CSV están en la categoría Productos", async ({
    request,
  }) => {
    await request.post(`${API_BASE}/api/admin/seed/reset`);
    const token = await loginAsDemoApi(request);

    const categoriesRes = await request.get(`${API_BASE}/api/service-categories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const categories = (await categoriesRes.json()) as Array<{ id: number; name: string }>;
    const productosCategory = categories.find((c) => c.name === "Productos");
    expect(productosCategory).toBeTruthy();

    const servicesRes = await request.get(`${API_BASE}/api/services`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(servicesRes.ok()).toBeTruthy();
    const services = (await servicesRes.json()) as Array<{
      id: number;
      name: string;
      categoryName: string;
    }>;

    const productServices = services.filter((s) => s.categoryName === "Productos");
    // CSV has 1288 unique products (some may collide with pre-seeded catalog names)
    expect(productServices.length).toBeGreaterThan(100);

    for (const productName of KNOWN_CSV_PRODUCTS) {
      const found = productServices.some((s) => s.name === productName);
      expect(found, `Product '${productName}' not found in Productos category`).toBeTruthy();
    }
  });

  test("HU-31 · AC4 idempotencia — segundo reset no genera duplicados", async ({ request }) => {
    await request.post(`${API_BASE}/api/admin/seed/reset`);
    await request.post(`${API_BASE}/api/admin/seed/reset`);
    const token = await loginAsDemoApi(request);

    const servicesRes = await request.get(`${API_BASE}/api/services`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(servicesRes.ok()).toBeTruthy();
    const services = (await servicesRes.json()) as Array<{
      id: number;
      name: string;
      categoryName: string;
    }>;

    const productNames = services
      .filter((s) => s.categoryName === "Productos")
      .map((s) => s.name);

    const uniqueNames = new Set(productNames);
    expect(productNames.length).toBe(uniqueNames.size);
  });

  test("HU-31 · AC5 seed integrado en FemmeDataInitializer — startup seeds productos", async ({
    request,
  }) => {
    // After a reset, the products should be present (integration via SeedResetService → FemmeDataInitializer)
    await request.post(`${API_BASE}/api/admin/seed/reset`);
    const token = await loginAsDemoApi(request);

    const res = await request.get(`${API_BASE}/api/services`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const services = (await res.json()) as Array<{
      id: number;
      name: string;
      categoryName: string;
    }>;
    const csvProducts = services.filter((s) => s.categoryName === "Productos");
    expect(csvProducts.length).toBeGreaterThan(100);
  });
});
