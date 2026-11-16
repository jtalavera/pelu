import { expect, test, type Page } from "@playwright/test";
import {
  applyChanges,
  assignToGroup,
  createCatalogItem,
  createGroup,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  loginAdminUi,
  openCommissions,
  openSetupStep,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-21 · «Para revisar» en tarjetas claras y «Sin grupo» que se entienda
 * (requirements/user_stories/HU-COM-21-inicio-para-revisar-y-sin-grupo.md).
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

type Req = Parameters<typeof issueInvoice>[0];

/** The design-system primary button (filled); the outline one is bg-transparent. */
const FILLED = /(^|\s)bg-primary(\s|$)/;

/** A sale of `service` by `professionalId` (null: nobody, so it shows in «lines without a professional»). */
async function sale(request: Req, professionalId: number | null) {
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, professionalId }]);
  if (professionalId !== null) await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  return inv;
}

/** «Peluquería» with its %, plus `withoutPercent` more groups that have none (each with a service of its own). */
async function groups(request: Req, withoutPercent: number) {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id]);
  await applyChanges(request, w.adminToken, [{ scope: "GROUP_RULE", groupId: g.id, value: "40" }]);
  for (let i = 1; i <= withoutPercent; i++) {
    const extra = await createGroup(request, w.adminToken, `Sin porcentaje ${i}`);
    await assignToGroup(request, w.adminToken, extra.id, [(await createCatalogItem(request, w.adminToken, w, `Servicio extra ${i}`)).id]);
  }
}

const card = (page: Page, key: "lines" | "noPercent" | "drafts") => page.getByTestId(`home-review-${key}`);

// ── AC1 · AC2 · AC3 · AC4 · tarjetas de «Para revisar» ────────────────────────────────────────────

test("AC1 · AC2 · AC3 · AC4 · «Para revisar»: tarjetas con etiqueta, el número una vez, el % general real y solo la primera con botón relleno", async ({
  page,
  request,
}) => {
  await groups(request, 1);
  await sale(request, null); // a sale without professional
  await sale(request, w.ana.id);
  await generateSettlements(request, w.adminToken, [w.ana.id]); // one draft
  await loginAdminUi(page, w);
  await openCommissions(page);

  // Three cards, from what affects the money the most to the least, each with its kind of color.
  const cards = page.getByTestId("home-review").locator("article");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute("data-testid", "home-review-lines");
  await expect(cards.nth(1)).toHaveAttribute("data-testid", "home-review-noPercent");
  await expect(cards.nth(2)).toHaveAttribute("data-testid", "home-review-drafts");
  await expect(cards.nth(0)).toHaveAttribute("data-tone", "money");
  await expect(cards.nth(1)).toHaveAttribute("data-tone", "setup");
  await expect(cards.nth(2)).toHaveAttribute("data-tone", "paperwork");
  await expect(page.getByTestId("home-review")).toContainText("3 things, from what affects the money most to least");

  // Lines without professional: the consequence in the tag, the number said once, a verb + object button.
  await expect(card(page, "lines").getByTestId("home-review-tag")).toHaveText("They earn no commission");
  await expect(card(page, "lines").getByTestId("home-review-count")).toHaveText("1");
  await expect(card(page, "lines").getByTestId("home-review-title")).toHaveText("1 sale line without a professional");
  await expect(card(page, "lines").getByTestId("home-review-help")).toHaveText("Assign them a professional so they count in the settlement.");
  await expect(page.getByTestId("home-review-lines-action")).toHaveText("Assign professional");

  // Groups without their own %: it says what they are paid today, with the real general % (12 %).
  await expect(card(page, "noPercent").getByTestId("home-review-tag")).toHaveText("They pay the general %");
  await expect(card(page, "noPercent").getByTestId("home-review-title")).toHaveText("1 group without its own %");
  await expect(card(page, "noPercent").getByTestId("home-review-help")).toHaveText(
    /Today they are paid the general % for services: 12\s?%\./,
  );
  await expect(page.getByTestId("home-review-noPercent-action")).toHaveText("Set the %");

  // Settlements in draft: singular copy.
  await expect(card(page, "drafts").getByTestId("home-review-tag")).toHaveText("Not paid yet");
  await expect(card(page, "drafts").getByTestId("home-review-title")).toHaveText("1 settlement in draft");
  await expect(card(page, "drafts").getByTestId("home-review-help")).toHaveText("It must be approved before it can be paid.");
  await expect(page.getByTestId("home-review-drafts-action")).toHaveText("Review drafts");

  // Only the first card carries the filled button (the one to do first); the others are outlined.
  await expect(page.getByTestId("home-review-lines-action")).toHaveClass(FILLED);
  await expect(page.getByTestId("home-review-noPercent-action")).not.toHaveClass(FILLED);
  await expect(page.getByTestId("home-review-drafts-action")).not.toHaveClass(FILLED);

  // Every button still leads where it did.
  await page.getByTestId("home-review-noPercent-action").click();
  await expect(page).toHaveURL(/\/configurar\/comisiones$/);
  await expect(page.getByTestId("commission-rates")).toBeVisible();
  await page.goBack();
  await page.getByTestId("home-review-drafts-action").click();
  await expect(page).toHaveURL(/\/liquidar\?state=DRAFT$/);
});

test("AC5 · «Para revisar»: los plurales («2 sale lines…», «2 groups…», «2 settlements in draft») y la primera tarjeta es la que tiene el botón relleno", async ({
  page,
  request,
}) => {
  await groups(request, 2);
  await sale(request, w.ana.id);
  await sale(request, w.bea.id);
  await generateSettlements(request, w.adminToken, [w.ana.id, w.bea.id]);
  await loginAdminUi(page, w);
  await openCommissions(page);

  // No line without professional: the first card is now the groups without a %, and it is the filled one.
  await expect(card(page, "lines")).toHaveCount(0);
  await expect(page.getByTestId("home-review").locator("article")).toHaveCount(2);
  await expect(card(page, "noPercent").getByTestId("home-review-title")).toHaveText("2 groups without their own %");
  await expect(card(page, "drafts").getByTestId("home-review-title")).toHaveText("2 settlements in draft");
  await expect(card(page, "drafts").getByTestId("home-review-help")).toHaveText("They must be approved before they can be paid.");
  await expect(page.getByTestId("home-review-noPercent-action")).toHaveClass(FILLED);
  await expect(page.getByTestId("home-review-drafts-action")).not.toHaveClass(FILLED);
  await expect(page.getByTestId("home-review")).toContainText("2 things, from what affects the money most to least");
});

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
