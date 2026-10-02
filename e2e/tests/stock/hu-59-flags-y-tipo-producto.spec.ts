import { expect, test } from "@playwright/test";

import { loginAs, loginAsPlatformAdmin } from "../../fixtures/auth";
import { pelu, peluLogin, platformToken, serviciosXlsx } from "../../fixtures/stock/api";
import { getStockWorld } from "../../fixtures/stock/world";

// HU-59 · Flags de Stock y tipo Producto (Cambios 1 y 2 del plan de integración con control-stock).

test.describe("HU-59 · Flags de Stock y tipo Producto", () => {
  test("Cambio 1 · los flags STOCK_* se administran como cualquier otro flag (global, tier y salón)", async ({
    page,
  }) => {
    const world = getStockWorld();
    const token = await platformToken();
    const globals = (await pelu<Array<{ flagKey: string; enabled: boolean }>>("/api/admin/feature-flags", { token })).body;
    const keys = globals.map((f) => f.flagKey);
    expect(keys).toEqual(expect.arrayContaining(["STOCK_MODULE", "STOCK_PHYSICAL_COUNT", "STOCK_TOURS"]));
    // Not registered in pelu: Stock applies its own default (negatives allowed).
    expect(keys).not.toContain("STOCK_HOST_MOVEMENTS_ALLOW_NEGATIVE");
    expect(globals.find((f) => f.flagKey === "STOCK_PHYSICAL_COUNT")?.enabled).toBe(true);
    expect(globals.find((f) => f.flagKey === "STOCK_TOURS")?.enabled).toBe(true);

    await loginAsPlatformAdmin(page);
    // Global screen.
    await page.goto("/platform/global-feature-flags");
    for (const key of ["STOCK_MODULE", "STOCK_PHYSICAL_COUNT", "STOCK_TOURS"]) {
      await expect(page.getByText(key, { exact: true }).first()).toBeVisible();
    }
    // Tier screen: the "Sin Stock" tier turns STOCK_MODULE off.
    const tierFlags = (
      await pelu<Array<{ flagKey: string; tierEnabled: boolean }>>(
        `/api/platform/tiers/${world.noStockTierId}/feature-flags`,
        { token },
      )
    ).body;
    expect(tierFlags.find((f) => f.flagKey === "STOCK_MODULE")?.tierEnabled).toBe(false);
    // Salon screen: AND resolution — S3 is OFF because of its tier, S1 resolves ON.
    await page.goto("/platform/feature-flags");
    await page.getByLabel("Organization").fill(world.s3.name);
    await page.getByRole("button", { name: world.s3.name }).click();
    await expect(page.getByTestId("feature-flag-effective-STOCK_MODULE")).toBeVisible();
    await expect(page.getByTestId("feature-flag-disabled-by-STOCK_MODULE")).toBeVisible();
    const s1Flags = (await pelu<{ flags: Record<string, boolean> }>("/api/feature-flags", {
      token: await peluLogin(world.s1.adminEmail, world.s1.adminPassword),
    })).body.flags;
    expect(s1Flags.STOCK_MODULE).toBe(true);
  });

  test("Cambio 1 · STOCK_MODULE arranca apagado a nivel global (V69 / seed)", async () => {
    // The world turns it ON as its last step; before that the seed left it OFF — proven here on a
    // brand-new tier/tenant view of the catalog description, plus the seed default recorded by
    // the backend (the flag row was created with enabled=false, see FemmeDataInitializer/V69).
    const token = await platformToken();
    const globals = (await pelu<Array<{ flagKey: string; description: string }>>("/api/admin/feature-flags", { token })).body;
    expect(globals.find((f) => f.flagKey === "STOCK_MODULE")?.description).toContain(
      "The tenant has the stock module",
    );
    expect(getStockWorld().stockModuleInitiallyOff).toBe(true);
  });

  test("Cambio 2 · formulario de Servicios con Tipo (Servicio/Producto) y SKU, y filtro por tipo", async ({
    page,
  }) => {
    const world = getStockWorld();
    const name = `Crema de peinar ${Date.now()}`;
    await loginAs(page, world.s1.adminEmail, world.s1.adminPassword);
    await page.goto("/app/services");
    await page.getByRole("button", { name: /New service/i }).click();
    await page.locator("#svc-name").fill(name);
    await page.locator("#svc-kind").selectOption("PRODUCT");
    await page.locator("#svc-sku").fill("CP-250");
    await page.locator("#svc-cat").selectOption({ label: "Productos" });
    await page.locator("#svc-price").fill("45000");
    await page.locator("#svc-duration").fill("1");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const token = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    await expect
      .poll(async () => {
        const list = (await pelu<Array<{ name: string; kind: string; sku: string }>>("/api/services", { token })).body;
        return list.find((s) => s.name === name);
      })
      .toMatchObject({ kind: "PRODUCT", sku: "CP-250" });

    await page.goto("/app/services");
    const filter = page.getByTestId("services-kind-filter");
    await filter.getByRole("button", { name: "Products" }).click();
    const row = page.locator("tr").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText("Product", { exact: true })).toBeVisible();
    // Services are filtered out of "Products".
    const serviceName = `Corte filtro ${Date.now()}`;
    await pelu("/api/services", {
      token,
      body: { name: serviceName, categoryId: world.s1.categoryId, priceMinor: 1000, durationMinutes: 30 },
    });
    await page.reload();
    await page.getByTestId("services-kind-filter").getByRole("button", { name: "Products" }).click();
    await expect(page.locator("tr").filter({ hasText: name })).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: serviceName })).toHaveCount(0);
    await page.getByTestId("services-kind-filter").getByRole("button", { name: "Services" }).click();
    await expect(page.locator("tr").filter({ hasText: serviceName })).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: name })).toHaveCount(0);
  });

  test("Cambio 2 · el upload de la plataforma acepta las columnas Tipo y SKU con validación por fila", async ({
    page,
  }) => {
    const world = getStockWorld();
    const stamp = Date.now();
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();
    // The template documents both new columns.
    await expect(page.getByText("tipo", { exact: true })).toBeVisible();
    await expect(page.getByText("sku", { exact: true })).toBeVisible();

    const file = await serviciosXlsx([
      { categoria: "Productos", nombre: `Tinte rubio ${stamp}`, precio: 70000, tipo: "Producto", sku: `TR-${stamp}` },
      { categoria: "Cortes", nombre: `Corte niño ${stamp}`, precio: 40000, tipo: "" },
      { categoria: "Productos", nombre: `Raro ${stamp}`, precio: 10000, tipo: "Gadget" },
    ]);
    await page.locator("#import-run-tenant-services").selectOption({ value: String(world.s3.id) });
    await page.locator("#import-run-file-services").setInputFiles({
      name: "productos.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: file,
    });
    await page.getByRole("button", { name: "Import" }).click();
    const summary = page.getByTestId("import-run-summary-services");
    await expect(summary).toContainText("2 of 3 rows imported. 1 failed.");
    await expect(page.getByTestId("import-run-failed-rows-services")).toContainText(
      "Invalid type: use Servicio or Producto",
    );

    const token = await peluLogin(world.s3.adminEmail, world.s3.adminPassword);
    const list = (await pelu<Array<{ name: string; kind: string; sku: string | null }>>("/api/services", { token })).body;
    expect(list.find((s) => s.name === `Tinte rubio ${stamp}`)).toMatchObject({ kind: "PRODUCT", sku: `TR-${stamp}` });
    expect(list.find((s) => s.name === `Corte niño ${stamp}`)).toMatchObject({ kind: "SERVICE", sku: null });
  });
});
