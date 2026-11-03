import { expect, test, type Page } from "@playwright/test";
import { apiGetJson, apiPostJson } from "../../fixtures/api";
import {
  enableCommissionsGlobally,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * Comisiones · Reglas: la lista de Servicios y Productos va paginada (20 por página por defecto;
 * 10, 20 o 50), con «Mostrando…», anterior / siguiente y filas por página.
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "PAGE-RULES");
  // The world has 2 services (Corte, Color); add 44 more → 46 in total.
  const taxes = await apiGetJson<{ id: number; rate: number }[]>(request, w.adminToken, "/api/taxes");
  const iva10 = taxes.find((t) => Number(t.rate) === 10) ?? taxes[0];
  const cat = await apiPostJson<{ id: number }>(request, w.adminToken, "/api/service-categories", {
    name: `Extra ${Date.now()}`,
    accentKey: "stone",
    kind: "SERVICE",
  });
  for (let i = 1; i <= 44; i++) {
    await apiPostJson(request, w.adminToken, "/api/services", {
      name: `Zeta ${String(i).padStart(2, "0")}`,
      categoryId: cat.id,
      taxId: iva10.id,
      priceMinor: 50_000,
      durationMinutes: 30,
      kind: "SERVICE",
      sku: null,
    });
  }
});

async function openRules(page: Page) {
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Rules", exact: true }).click();
  await expect(page.getByTestId("rules-table")).toBeVisible();
}

const rows = (page: Page) => page.getByTestId("rules-table").locator("ul > li");

test("20 filas por página: «Mostrando 1–20 de 46», siguiente / anterior y la última página con el resto", async ({ page }) => {
  await loginAdminUi(page, w);
  await openRules(page);
  await expect(rows(page)).toHaveCount(20);
  await expect(page.getByTestId("rules-showing")).toHaveText("1–20 of 46");

  const nav = page.getByTestId("rules-pager").getByRole("navigation");
  await expect(nav).toContainText("1 / 3");
  await nav.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("rules-showing")).toHaveText("21–40 of 46");
  await expect(rows(page)).toHaveCount(20);
  await nav.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("rules-showing")).toHaveText("41–46 of 46");
  await expect(rows(page)).toHaveCount(6);
  await expect(nav.getByRole("button", { name: "Next" })).toBeDisabled();
  await nav.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByTestId("rules-showing")).toHaveText("21–40 of 46");
});

test("filas por página (10 / 20 / 50) vuelve a la primera página; con 50 entra todo y no hay anterior / siguiente", async ({ page }) => {
  await loginAdminUi(page, w);
  await openRules(page);
  const nav = page.getByTestId("rules-pager").getByRole("navigation");
  await nav.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("rules-showing")).toHaveText("21–40 of 46");

  await page.getByTestId("rules-pager").getByRole("combobox").selectOption("10");
  await expect(page.getByTestId("rules-showing")).toHaveText("1–10 of 46");
  await expect(rows(page)).toHaveCount(10);
  await expect(nav).toContainText("1 / 5");

  await page.getByTestId("rules-pager").getByRole("combobox").selectOption("50");
  await expect(page.getByTestId("rules-showing")).toHaveText("1–46 of 46");
  await expect(rows(page)).toHaveCount(46);
  await expect(page.getByTestId("rules-pager").getByRole("navigation")).toHaveCount(0);
});

test("buscar vuelve a la página 1 y cuenta solo lo que coincide; Productos tiene su propia lista", async ({ page }) => {
  await loginAdminUi(page, w);
  await openRules(page);
  const nav = page.getByTestId("rules-pager").getByRole("navigation");
  await nav.getByRole("button", { name: "Next" }).click();
  await nav.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("rules-showing")).toHaveText("41–46 of 46");

  await page.getByTestId("rules-search").fill("Zeta 07");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("rules-showing")).toHaveText("1–1 of 1");
  // One page only: no previous / next.
  await expect(page.getByTestId("rules-pager").getByRole("navigation")).toHaveCount(0);

  await page.getByTestId("rules-search").fill("");
  await expect(page.getByTestId("rules-showing")).toHaveText("1–20 of 46");

  // Productos: its own list (one product in this world).
  await page.getByRole("button", { name: "Products", exact: true }).click();
  await expect(page.getByTestId("rules-showing")).toHaveText("1–1 of 1");
  await expect(rows(page)).toHaveCount(1);
});

test("tocar una fila abre su regla sin cambiar de página", async ({ page }) => {
  await loginAdminUi(page, w);
  await openRules(page);
  const nav = page.getByTestId("rules-pager").getByRole("navigation");
  await nav.getByRole("button", { name: "Next" }).click();
  await rows(page).first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("rules-showing")).toHaveText("21–40 of 46");
});
