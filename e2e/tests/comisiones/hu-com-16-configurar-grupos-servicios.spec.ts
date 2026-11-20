import { expect, test } from "@playwright/test";
import { apiGetJson } from "../../fixtures/api";
import {
  applyChanges,
  assignToGroup,
  createCatalogItem,
  createGroup,
  enableCommissionsGlobally,
  loginAdminUi,
  openCommissions,
  openExceptions,
  openSetupStep,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-16 · Configurar: «Grupos y servicios» fácil de encontrar y ordenar
 * (requirements/user_stories/HU-COM-16-configurar-grupos-y-servicios.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-16");
});

/** Two groups with items, plus the 3 catalog items of the world (and two more) left without a group. */
async function salon(request: Parameters<typeof createGroup>[0]) {
  const token = w.adminToken;
  const gColor = await createGroup(request, token, "Color");
  const gManos = await createGroup(request, token, "Manos y pies");
  const raiz = await createCatalogItem(request, token, w, "Color raíz");
  const global = await createCatalogItem(request, token, w, "Color global");
  const mani = await createCatalogItem(request, token, w, "Manicura");
  await assignToGroup(request, token, gColor.id, [raiz.id, global.id]);
  await assignToGroup(request, token, gManos.id, [mani.id]);
  const lashes = await createCatalogItem(request, token, w, "Pestañina semipermanente");
  const brows = await createCatalogItem(request, token, w, "Depilación de cejas");
  return { gColor, gManos, raiz, global, mani, lashes, brows };
}

// ── AC1 · AC2 · Configurar muestra el estado de cada paso ─────────────────────────────────────

test("AC1 · Configurar: el paso «Comisión de cada servicio» muestra cuántos grupos hay y cuántos ya tienen su %", async ({
  page,
  request,
}) => {
  await salon(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");

  // HU-COM-20: 2 groups, none with its % yet. Each step is one folded line; the first one with something
  // missing (step 2) opens by itself.
  await expect(page.getByTestId("config-step-2")).toContainText("Commission of each service");
  await expect(page.getByTestId("config-step-2-summary")).toHaveText("2 groups · 0 with their %");
  await expect(page.getByTestId("config-step-2-pill")).toHaveText("2 groups without a %");
  await expect(page.getByTestId("config-step-2-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("config-group-chip")).toHaveText(["Color No %", "Manos y pies No %"]);
  // The other steps still show their values once opened; there is no «rules per professional» step.
  await expect(page.getByTestId("config-step-3")).toContainText("Retention");
  await openSetupStep(page, 1);
  await expect(page.getByTestId("config-step-1").getByTestId("commission-setting-BASE")).toBeVisible();
  await expect(page.getByTestId("config-exceptions")).toBeVisible();
});

test("AC2 · los atajos de Configurar llevan a poner los %, a ordenar los grupos, a cada grupo, a las excepciones y a lo programado", async ({
  page,
  request,
}) => {
  await salon(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");

  await openSetupStep(page, 2);
  await page.getByTestId("config-group-chip").filter({ hasText: "Manos y pies" }).click();
  await expect(page).toHaveURL(/\/configurar\/comisiones\?q=Manos%20y%20pies$/);
  await expect(page.getByTestId("rates-group")).toHaveAttribute("data-group-name", "Manos y pies");
  // Searching a group by its name shows ALL its services (not «this group has no services»), and «Sin grupo» stays out
  // because nothing without a group matches.
  await expect(page.getByTestId("rates-group-items")).not.toContainText("has no services");
  await expect(page.getByTestId("rates-item")).toHaveCount(1);
  await expect(page.getByTestId("rates-item")).toHaveAttribute("data-item-name", "Manicura");
  await expect(page.getByTestId("rates-ungrouped")).toHaveCount(0);

  await page.getByTestId("rates-back").click();
  await openSetupStep(page, 2);
  await page.getByTestId("config-step-2-order-link").click();
  await expect(page).toHaveURL(/\/configurar\/grupos$/);
  await expect(page.getByTestId("group-none")).toHaveAttribute("aria-current", "true");

  await page.getByTestId("config-back").click();
  await page.getByTestId("config-exceptions-link").click();
  await expect(page).toHaveURL(/\/configurar\/grupos\?tab=exceptions$/);
  await expect(page.getByTestId("commissions-exceptions")).toBeVisible();

  await page.getByTestId("config-back").click();
  await page.getByTestId("config-advanced-link").click();
  await expect(page.getByTestId("commissions-advanced")).toBeVisible();
});

test("AC3 · el buscador de Configurar abre «Grupos y servicios» ya buscando", async ({ page, request }) => {
  await salon(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  await page.getByTestId("config-search").fill("COLOR");
  await page.getByTestId("config-search").press("Enter");
  await expect(page).toHaveURL(/\/configurar\/grupos\?q=COLOR$/);
  await expect(page.getByTestId("groups-search")).toHaveValue("COLOR");
  await expect(page.getByTestId("groups-results")).toBeVisible();
  await expect(page.getByTestId("groups-result-group")).toHaveCount(1); // the group «Color»
  await expect(page.getByTestId("groups-row").filter({ hasText: "Color raíz" })).toBeVisible();
});

// ── AC4 · AC5 · AC6 · Lista de grupos y detalle ───────────────────────────────────────────────

test("AC4 · AC5 · la lista de grupos con «Sin grupo» arriba y sus servicios a la derecha; cada servicio se mueve ahí mismo", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  await openSetupStep(page, 2);
  await page.getByTestId("config-step-2-order-link").click();

  // It opens on «No group» (what is left to do) with its counter; groups follow with their counts.
  await expect(page.getByTestId("group-none")).toHaveAttribute("aria-current", "true");
  // 4 services plus the world's product: «No group» counts services and products together.
  await expect(page.getByTestId("group-none-count")).toHaveText("5");
  await expect(page.getByTestId("group-row")).toHaveCount(2);
  await expect(page.locator('[data-testid="group-row"][data-group-name="Color"]').getByTestId("group-row-count")).toHaveText("2");

  // Tapping a group shows its services and its summary.
  const groupRow = (name: string) => page.locator(`[data-testid="group-row"][data-group-name="${name}"]`);
  await groupRow("Color").click();
  await expect(page.getByTestId("group-title")).toHaveText("Color");
  await expect(page.getByTestId("group-summary")).toContainText("2 services");
  await expect(page.getByTestId("groups-row")).toHaveCount(2);
  await expect(page.getByTestId("groups-rules-link")).toBeVisible();

  // Move one to the other group from its row: the lists change at once.
  const row = page.getByTestId("groups-row").filter({ hasText: "Color global" });
  await row.getByTestId("groups-row-select").selectOption({ label: "Manos y pies" });
  await expect(groupRow("Color").getByTestId("group-row-count")).toHaveText("1");
  await expect(groupRow("Manos y pies").getByTestId("group-row-count")).toHaveText("2");
  const rows = await apiGetJson<{ serviceId: number; groupId: number | null }[]>(request, w.adminToken, "/api/commissions/groups/services?kind=SERVICE");
  expect(rows.find((r) => r.serviceId === s.global.id)?.groupId).toBe(s.gManos.id);
});

test("AC6 · buscar un servicio muestra en qué grupo está y se puede mover desde el resultado", async ({ page, request }) => {
  const s = await salon(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  await openSetupStep(page, 2);
  await page.getByTestId("config-step-2-order-link").click();

  await page.getByTestId("groups-search").fill("mani");
  await expect(page.getByTestId("groups-results")).toContainText("Results for «mani»");
  const row = page.getByTestId("groups-row").filter({ hasText: "Manicura" });
  await expect(row.getByTestId("groups-row-chip")).toHaveText("Manos y pies");
  await row.getByTestId("groups-row-select").selectOption({ label: "Color" });
  await expect(page.getByTestId("groups-notice")).toHaveText("1 service assigned.");
  await expect(row.getByTestId("groups-row-chip")).toContainText("Color");
  const rows = await apiGetJson<{ serviceId: number; groupId: number | null }[]>(request, w.adminToken, "/api/commissions/groups/services?kind=SERVICE");
  expect(rows.find((r) => r.serviceId === s.mani.id)?.groupId).toBe(s.gColor.id);

  // A group that matches is opened from the results.
  await page.getByTestId("groups-search").fill("manos");
  await expect(page.getByTestId("groups-result-group")).toHaveCount(1);
  await page.getByTestId("groups-result-open").click();
  await expect(page.getByTestId("group-title")).toHaveText("Manos y pies");
  await expect(page.getByTestId("groups-results")).toHaveCount(0);
});

// ── AC7 · Agregar servicios a un grupo ───────────────────────────────────────────────────────

test("AC7 · «Agregar servicios»: primero los que no tienen grupo, marca los sugeridos por nombre y mueve los que ya tienen otro grupo", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  await openSetupStep(page, 2);
  await page.getByTestId("config-step-2-order-link").click();
  const pestanas = await createGroup(request, w.adminToken, "Pestañas");
  await page.reload();
  await page.getByTestId("group-row").filter({ hasText: "Pestañas" }).click();
  await expect(page.getByTestId("group-empty-items")).toBeVisible();

  await page.getByTestId("groups-add-open").click();
  const dialog = page.getByTestId("groups-add-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("groups-add-confirm")).toBeDisabled();
  // The ones without a group come first.
  await expect(dialog.getByTestId("groups-add-scope-UNGROUPED")).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByTestId("groups-add-row").filter({ hasText: "Pestañina semipermanente" })).toBeVisible();
  // «Pestañina…» does not contain «pestañas»: no suggestion; searching narrows the list.
  await dialog.getByTestId("groups-add-search").fill("cejas");
  await expect(dialog.getByTestId("groups-add-row")).toHaveCount(1);
  await dialog.getByTestId("groups-add-check").check();
  await dialog.getByTestId("groups-add-search").fill("");
  // One that already has a group is moved (and it says so).
  await dialog.getByTestId("groups-add-scope-GROUPED").click();
  await dialog.getByTestId("groups-add-row").filter({ hasText: "Manicura" }).getByTestId("groups-add-check").check();
  await expect(dialog.getByTestId("groups-add-summary")).toContainText("2 chosen");
  await expect(dialog.getByTestId("groups-add-summary")).toContainText("already has a group and moves");
  await expect(page.getByTestId("groups-add-confirm")).toHaveText("Add 2 to Pestañas");
  await page.getByTestId("groups-add-confirm").click();

  await expect(page.getByTestId("groups-notice")).toHaveText("2 services assigned.");
  await expect(page.getByTestId("groups-row")).toHaveCount(2);
  const rows = await apiGetJson<{ serviceId: number; groupId: number | null }[]>(request, w.adminToken, "/api/commissions/groups/services?kind=SERVICE");
  expect(rows.find((r) => r.serviceId === s.brows.id)?.groupId).toBe(pestanas.id);
  expect(rows.find((r) => r.serviceId === s.mani.id)?.groupId).toBe(pestanas.id);
});

test("AC7 · en «Agregar servicios» los productos también están y «Marcar los sugeridos» elige los que el nombre sugiere", async ({
  page,
  request,
}) => {
  await salon(request);
  const lashes = await createGroup(request, w.adminToken, "Pestañas");
  await createCatalogItem(request, w.adminToken, w, "Pestañas pelo a pelo");
  await createCatalogItem(request, w.adminToken, w, "Pestañas volumen");
  await createCatalogItem(request, w.adminToken, w, "Gel para pestañas", { kind: "PRODUCT" });
  await loginAdminUi(page, w);
  await page.goto(`/app/commissions/configurar/grupos?group=${lashes.id}`);
  await page.getByTestId("groups-add-open").click();
  const dialog = page.getByTestId("groups-add-dialog");
  await expect(dialog.getByTestId("groups-add-row").filter({ hasText: "Gel para pestañas" })).toContainText("Product");
  await dialog.getByTestId("groups-add-mark-suggested").click();
  await expect(dialog.getByTestId("groups-add-summary")).toContainText("chosen");
  const marked = await dialog.getByTestId("groups-add-check").evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).checked).length);
  expect(marked).toBeGreaterThanOrEqual(2);
  await page.getByTestId("groups-add-confirm").click();
  await expect(page.getByTestId("groups-notice")).toContainText("assigned");
  await expect(page.getByTestId("groups-row").filter({ hasText: "Pestañas volumen" })).toBeVisible();
});

// ── AC8 · Excepciones por servicio ───────────────────────────────────────────────────────────

test("AC8 · las excepciones por servicio son una solapa visible de «Grupos y servicios» y siguen funcionando", async ({ page, request }) => {
  await salon(request);
  await applyChanges(request, w.adminToken, [{ scope: "DEFAULT_SERVICE", value: "30" }]);
  await loginAdminUi(page, w);
  await openExceptions(page, "SERVICE");

  await expect(page.getByTestId("workspace-tab-exceptions")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("advanced-precedence").getByRole("listitem")).toHaveCount(4); // HU-COM-20: four layers
  await expect(page.getByTestId(`rules-row-${w.service.id}`)).toBeVisible();
  await expect(page.getByTestId(`rules-standard-${w.service.id}`)).toContainText("30 %");
  // Back to the groups tab and forward again.
  await page.getByTestId("workspace-tab-groups").click();
  await expect(page.getByTestId("commission-groups")).toBeVisible();
  await page.getByTestId("workspace-tab-exceptions").click();
  await expect(page.getByTestId("commissions-exceptions")).toBeVisible();
});

// ── AC9 · Celular ────────────────────────────────────────────────────────────────────────────

test("AC9 · en el celular se ve primero la lista de grupos; tocar uno abre sus servicios y se vuelve con «Todos los grupos»", async ({
  page,
  request,
}) => {
  await salon(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAdminUi(page, w);
  await page.goto("/app/commissions/configurar/grupos");
  await expect(page.getByTestId("commission-groups")).toBeVisible();
  // List first: no services are drawn until a group is chosen.
  await expect(page.getByTestId("group-none")).toBeVisible();
  await expect(page.getByTestId("groups-detail")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await page.getByTestId("group-row").filter({ hasText: "Color" }).click();
  await expect(page.getByTestId("groups-detail")).toBeVisible();
  await expect(page.getByTestId("group-title")).toHaveText("Color");
  await expect(page.getByTestId("group-none")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.getByTestId("groups-back-list").click();
  await expect(page.getByTestId("group-none")).toBeVisible();
  await expect(page.getByTestId("groups-detail")).toBeHidden();
});
