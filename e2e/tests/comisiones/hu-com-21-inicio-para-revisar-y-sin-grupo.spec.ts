import { expect, test, type Page } from "@playwright/test";
import {
  applyChanges,
  assignToGroup,
  createCatalogItem,
  createGroup,
  enableCommissionsGlobally,
  loginAdminUi,
  openCommissions,
  openSetupStep,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-21 · «Sin grupo» que se entienda
 * (requirements/user_stories/HU-COM-21-inicio-para-revisar-y-sin-grupo.md).
 * El panel «Para revisar» de Inicio (criterios 1 a 5 de esa historia) se rehízo en HU-COM-22
 * (hu-com-22-para-revisar-panel-de-filas.spec.ts).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-21");
  await applyChanges(request, w.adminToken, [
    { scope: "BASE", value: "TAX_INCLUDED" },
    { scope: "DEFAULT_SERVICE", value: "12" },
    { scope: "DEFAULT_PRODUCT", value: "7" },
  ]);
});

type Req = Parameters<typeof createGroup>[0];

// ── «Sin grupo» ───────────────────────────────────────────────────────────────────────────────────

/** 3 services of the world's catalog + 2 more left without a group, and a group with one service. */
async function noGroupSalon(request: Req) {
  const g = await createGroup(request, w.adminToken, "Color");
  const colored = await createCatalogItem(request, w.adminToken, w, "Color raíz");
  await assignToGroup(request, w.adminToken, g.id, [colored.id]);
  await createCatalogItem(request, w.adminToken, w, "Pestañas");
  await createCatalogItem(request, w.adminToken, w, "Cejas");
  return g;
}

async function openNoGroup(page: Page) {
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  await openSetupStep(page, 2);
  await page.getByTestId("config-step-2-order-link").click();
  await expect(page.getByTestId("group-none")).toHaveAttribute("aria-current", "true");
}

test("AC6 · AC7 · «Sin grupo» no es una alarma: dice que pagan el % general, cuántos ítems hay de cada tipo y cuánto pagan", async ({
  page,
  request,
}) => {
  await noGroupSalon(request);
  await openNoGroup(page);

  // The list: neutral look (no amber), what they pay, and the count.
  await expect(page.getByTestId("group-none")).toContainText("They pay the general %");
  await expect(page.getByTestId("group-none")).not.toHaveClass(/warning/);
  await expect(page.getByTestId("group-none-count")).toHaveText("5"); // 4 services + the world's product

  // The detail: what there is without a group and what it pays.
  await expect(page.getByTestId("none-counts")).toHaveText("5 items · 4 services · 1 product");
  await expect(page.getByTestId("none-hint")).toHaveText(/They pay the general %: services 12\s?%, products 7\s?%\./);
  await expect(page.getByTestId("none-hint")).toContainText("You can leave them like that or build groups to give them another %.");
});

test("AC6 · el contador de «Sin grupo» es una píldora con separador de miles (1.247) que no se corta", async ({ page, request }) => {
  await noGroupSalon(request);
  // The catalog of a big salon: the products come from the server, the rest is the real data.
  await page.route("**/api/commissions/groups/services?kind=PRODUCT", async (route) => {
    const products = Array.from({ length: 1243 }, (_, i) => ({
      serviceId: 100000 + i,
      name: `PRODUCTO ${String(i).padStart(4, "0")}`,
      categoryName: "Cosméticos",
      price: 0,
      groupId: null,
      groupName: null,
      suggestion: null,
    }));
    await route.fulfill({ json: products });
  });
  await openNoGroup(page);

  const pill = page.getByTestId("group-none-count");
  await expect(pill).toHaveText("1.247");
  const fits = await pill.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.scrollWidth <= el.clientWidth + 1 && r.width >= r.height;
  });
  expect(fits).toBe(true);
  await expect(page.getByTestId("none-counts")).toHaveText("1.247 items · 4 services · 1.243 products");
  await expect(page.getByTestId("none-filter-ALL")).toHaveText("All 1.247");
  await expect(page.getByTestId("none-filter-PRODUCT")).toHaveText("Products 1.243");
});

// ── AC8 · filtro por tipo ─────────────────────────────────────────────────────────────────────────

test("AC8 · el filtro «Todos / Servicios / Productos» de «Sin grupo» cambia la lista sin cambiar los contadores, y se reinicia al cambiar de grupo", async ({
  page,
  request,
}) => {
  const g = await noGroupSalon(request);
  await openNoGroup(page);

  await expect(page.getByTestId("none-filter-ALL")).toHaveText("All 5");
  await expect(page.getByTestId("none-filter-SERVICE")).toHaveText("Services 4");
  await expect(page.getByTestId("none-filter-PRODUCT")).toHaveText("Products 1");
  await expect(page.getByTestId("none-filter-ALL")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("groups-row")).toHaveCount(5);

  await page.getByTestId("none-filter-PRODUCT").click();
  await expect(page.getByTestId("none-filter-PRODUCT")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("none-filter-ALL")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("groups-row")).toHaveCount(1);
  await expect(page.getByTestId("groups-row")).toHaveAttribute("data-name", w.product.name);

  await page.getByTestId("none-filter-SERVICE").click();
  await expect(page.getByTestId("groups-row")).toHaveCount(4);
  await expect(page.locator(`[data-testid="groups-row"][data-name="${w.product.name}"]`)).toHaveCount(0);

  // The counters keep talking about everything without a group.
  await expect(page.getByTestId("group-none-count")).toHaveText("5");
  await expect(page.getByTestId("none-counts")).toHaveText("5 items · 4 services · 1 product");

  // Touch targets of at least 44 px.
  const box = await page.getByTestId("none-filter-SERVICE").boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // Opening another group and coming back starts again from «All».
  await page.locator(`[data-testid="group-row"][data-group-name="${g.name}"]`).click();
  await page.getByTestId("group-none").click();
  await expect(page.getByTestId("none-filter-ALL")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("groups-row")).toHaveCount(5);
});

// ── AC9 · AC10 · filas y asignación ──────────────────────────────────────────────────────────────

test("AC9 · en «Sin grupo» las filas no repiten «Sin grupo»; al elegir grupo la fila se marca con ✓ y el nombre del grupo; en una búsqueda sí dicen su grupo", async ({
  page,
  request,
}) => {
  const g = await noGroupSalon(request);
  await openNoGroup(page);

  await expect(page.getByTestId("groups-row-chip")).toHaveCount(0);
  const row = page.locator('[data-testid="groups-row"][data-name="Pestañas"]');
  await expect(row.getByTestId("groups-row-select")).toBeVisible();

  await row.getByTestId("groups-row-select").selectOption({ label: g.name });
  await expect(row.getByTestId("groups-row-chip")).toContainText(g.name);
  await expect(row.getByTestId("groups-row-chip")).toContainText("✓");
  // Once it has settled it leaves «Sin grupo» and the counters follow.
  await expect(page.locator('[data-testid="groups-row"][data-name="Pestañas"]')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("group-none-count")).toHaveText("4");
  await expect(page.getByTestId("none-counts")).toHaveText("4 items · 3 services · 1 product");

  // In a search every row says where it is.
  await page.getByTestId("groups-search").fill("Cejas");
  const found = page.locator('[data-testid="groups-row"][data-name="Cejas"]');
  await expect(found.getByTestId("groups-row-chip")).toHaveText("No group");
  await page.getByTestId("groups-search").fill("Pestañas");
  await expect(page.locator('[data-testid="groups-row"][data-name="Pestañas"]').getByTestId("groups-row-chip")).toContainText(g.name);
});

test("AC10 · se mantiene la barra para marcar varias filas y moverlas de una vez a un grupo", async ({ page, request }) => {
  const g = await noGroupSalon(request);
  await openNoGroup(page);

  await expect(page.getByTestId("groups-bulk-bar")).toHaveCount(0);
  await page.locator('[data-testid="groups-row"][data-name="Pestañas"]').getByTestId("groups-row-check").check();
  await page.locator('[data-testid="groups-row"][data-name="Cejas"]').getByTestId("groups-row-check").check();
  await expect(page.getByTestId("groups-bulk-bar")).toBeVisible();
  await expect(page.getByTestId("groups-selected")).toHaveText("2 selected");
  await page.getByTestId("groups-bulk-select").selectOption({ label: g.name });
  await page.getByTestId("groups-bulk-assign").click();
  await expect(page.getByTestId("group-none-count")).toHaveText("3", { timeout: 15_000 });
  await expect(page.locator(`[data-testid="group-row"][data-group-name="${g.name}"]`).getByTestId("group-row-count")).toHaveText("3");
});
