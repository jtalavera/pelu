import { expect, test } from "@playwright/test";
import {
  applyChanges,
  assignToGroup,
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
 * HU-COM-18 · Configurar con pasos plegados: una línea por paso, el círculo dice cómo está
 * (✓ al día · número ámbar pendiente · número gris opcional) y se abre solo el primero que falta
 * (requirements/user_stories/HU-COM-18-configurar-pasos-plegados.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-18");
  await applyChanges(request, w.adminToken, [{ scope: "DEFAULT_SERVICE", value: "40" }]);
});

/** Two groups, only one with its %: step 2 is pending («1 group without a %»). */
async function halfSetUp(request: Parameters<typeof createGroup>[0]) {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id]);
  const manos = await createGroup(request, w.adminToken, "Manos");
  await assignToGroup(request, w.adminToken, manos.id, [w.service2.id]);
  await applyChanges(request, w.adminToken, [{ scope: "GROUP_RULE", groupId: g.id, value: "40" }]);
  return g;
}

/** Every service in a group that has its %: nothing is pending. */
async function fullySetUp(request: Parameters<typeof createGroup>[0]) {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id, w.service2.id]);
  await applyChanges(request, w.adminToken, [{ scope: "GROUP_RULE", groupId: g.id, value: "40" }]);
  return g;
}

/** The design-system primary button (filled); the secondary one is bg-primary-lt. */
const FILLED = /(^|\s)bg-primary(\s|$)/;
const step = (page: import("@playwright/test").Page, n: number) => page.getByTestId(`config-step-${n}`);
const expanded = (page: import("@playwright/test").Page, n: number) => page.getByTestId(`config-step-${n}-toggle`);

// ── AC1 · cada paso con su círculo, su resumen y su etiqueta ────────────────────────────────────

test("AC1 · cada paso tiene el mismo círculo: ✓ verde si está al día, número ámbar si falta algo y número gris si es opcional", async ({
  page,
  request,
}) => {
  await halfSetUp(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");

  await expect(step(page, 1)).toHaveAttribute("data-tone", "done");
  await expect(page.getByTestId("config-step-1-badge")).toHaveText("✓");
  await expect(page.getByTestId("config-step-1-pill")).toHaveText("Up to date");
  await expect(page.getByTestId("config-step-1-summary")).toContainText(/Excluding VAT · .*settlement/);

  // HU-COM-20: a group without its % is what is pending in step 2.
  await expect(step(page, 2)).toHaveAttribute("data-tone", "pending");
  await expect(page.getByTestId("config-step-2-badge")).toHaveText("2");
  await expect(page.getByTestId("config-step-2-pill")).toHaveText("1 group without a %");
  await expect(page.getByTestId("config-step-2-summary")).toHaveText("2 groups · 1 with their %");

  // Step 3 is aguinaldo (there is no step «rules per professional» any more).
  await expect(step(page, 3)).toHaveAttribute("data-tone", "optional");
  await expect(page.getByTestId("config-step-3-badge")).toHaveText("3");
  await expect(page.getByTestId("config-step-3-pill")).toHaveText("Optional");
  await expect(page.getByTestId("config-step-3-summary")).toHaveText("Aguinaldo off · the product cost goes to the professional");
  await expect(step(page, 4)).toHaveCount(0);
});

// ── AC2 · abre solo el primero que falta, con el único botón principal ──────────────────────────

test("AC2 · se abre solo el primer paso pendiente y solo ese tiene el botón principal; los demás quedan en una línea", async ({
  page,
  request,
}) => {
  await halfSetUp(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");

  await expect(expanded(page, 2)).toHaveAttribute("aria-expanded", "true");
  for (const n of [1, 3]) await expect(expanded(page, n)).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("config-step-1-body")).toHaveCount(0);
  await expect(page.getByTestId("config-step-3-body")).toHaveCount(0);

  const primary = page.getByTestId("config-step-2-link").getByRole("button");
  await expect(primary).toHaveText("Organize groups and services");
  await expect(primary).toHaveClass(FILLED);

  // Opening another step does not give it a filled button: its «Change» buttons are secondary.
  await openSetupStep(page, 3);
  await expect(page.getByTestId("commission-setting-change-AGUINALDO_ENABLED")).not.toHaveClass(FILLED);
});

// ── AC3 · abrir y cerrar a mano ────────────────────────────────────────────────────────────────

test("AC3 · cada paso se abre y se cierra tocándolo o con el teclado, y el cambio de un valor se hace dentro del paso", async ({
  page,
  request,
}) => {
  await halfSetUp(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");

  await expect(page.getByTestId("commission-setting-BASE")).toHaveCount(0);
  await expanded(page, 1).click();
  await expect(expanded(page, 1)).toHaveAttribute("aria-expanded", "true");
  // HU-COM-20: step 1 is only the base and how often it is settled (the % live in «Comisiones»).
  for (const scope of ["BASE", "PERIODICITY"]) {
    await expect(step(page, 1).getByTestId(`commission-setting-${scope}`)).toBeVisible();
  }
  await expect(step(page, 1).getByTestId("commission-setting-DEFAULT_SERVICE")).toHaveCount(0);
  await expanded(page, 1).click();
  await expect(page.getByTestId("commission-setting-BASE")).toHaveCount(0);

  await expanded(page, 3).focus();
  await page.keyboard.press("Enter");
  await expect(expanded(page, 3)).toHaveAttribute("aria-expanded", "true");
  await expect(step(page, 3).getByTestId("commission-setting-AGUINALDO_ENABLED")).toContainText("Off");
  await page.keyboard.press("Space");
  await expect(expanded(page, 3)).toHaveAttribute("aria-expanded", "false");

  // Changing a value keeps the step open and updates its summary line.
  await openSetupStep(page, 1);
  await page.getByTestId("commission-setting-change-BASE").click();
  await page.getByTestId("commission-base-TAX_INCLUDED").check();
  await page.getByTestId("commission-setting-save").click();
  await page.getByTestId("commission-apply-mode-IMMEDIATE").check();
  await page.getByTestId("commission-apply-confirm").click();
  await expect(expanded(page, 1)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("config-step-1-summary")).toContainText("Including VAT");
});

// ── AC4 · todo al día ──────────────────────────────────────────────────────────────────────────

test("AC4 · con todo configurado los pasos quedan plegados, en verde («Al día»), sin número en el menú", async ({ page, request }) => {
  await fullySetUp(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");

  for (const n of [1, 2]) {
    await expect(step(page, n)).toHaveAttribute("data-tone", "done");
    await expect(page.getByTestId(`config-step-${n}-badge`)).toHaveText("✓");
    await expect(page.getByTestId(`config-step-${n}-pill`)).toHaveText("Up to date");
  }
  await expect(step(page, 3)).toHaveAttribute("data-tone", "optional");
  for (const n of [1, 2, 3]) await expect(expanded(page, n)).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("commissions-nav-badge-setup")).toHaveCount(0);
});

// ── AC5 · el paso 3 según el aguinaldo ─────────────────────────────────────────────────────────

test("AC5 · paso 3: gris si el aguinaldo está apagado, ámbar (y cuenta en el menú) si está activo y nadie retiene, verde cuando alguien retiene", async ({
  page,
  request,
}) => {
  await fullySetUp(request);
  await applyChanges(request, w.adminToken, [{ scope: "AGUINALDO_ENABLED", value: "true" }]);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");

  // On, nobody retains yet: amber, counted in the menu, and it is the only pending step so it opens by itself.
  await expect(step(page, 3)).toHaveAttribute("data-tone", "pending");
  await expect(page.getByTestId("config-step-3-badge")).toHaveText("3");
  await expect(page.getByTestId("config-step-3-pill")).toHaveText("Nobody retains yet");
  await expect(page.getByTestId("config-step-3-summary")).toHaveText("Aguinaldo on · no professional has a retention set");
  await expect(page.getByTestId("commissions-nav-badge-setup")).toHaveText("1");
  await expect(expanded(page, 3)).toHaveAttribute("aria-expanded", "true");

  // Someone retaining (not everybody: some professionals legitimately do not) makes it green.
  const row = page.getByTestId("commission-retention-row").filter({ hasText: w.ana.name });
  await row.getByTestId("commission-retention-change").click();
  await page.getByTestId("commission-retention-percent").fill("5");
  await page.getByTestId("commission-retention-save").click();
  await expect(step(page, 3)).toHaveAttribute("data-tone", "done");
  await expect(page.getByTestId("config-step-3-badge")).toHaveText("✓");
  await expect(page.getByTestId("config-step-3-pill")).toHaveText("Up to date");
  await expect(page.getByTestId("config-step-3-summary")).toContainText(/Retains .* by default · 1 of \d+ professionals retains/);
  await expect(page.getByTestId("commissions-nav-badge-setup")).toHaveCount(0);

  // Turning it off again leaves the step gray («Optional») and nothing pending.
  await page.getByTestId("commission-setting-change-AGUINALDO_ENABLED").click();
  await page.getByTestId("commission-aguinaldo-false").check();
  await page.getByTestId("commission-setting-save").click();
  await page.getByTestId("commission-apply-mode-IMMEDIATE").check();
  await page.getByTestId("commission-apply-confirm").click();
  await expect(step(page, 3)).toHaveAttribute("data-tone", "optional");
  await expect(page.getByTestId("config-step-3-pill")).toHaveText("Optional");
  await expect(page.getByTestId("commissions-nav-badge-setup")).toHaveCount(0);
});

// ── AC6 · excepciones y cambios programados siempre a mano ─────────────────────────────────────

test("AC6 · al final siempre están las excepciones y los cambios programados, con cuántos cambios hay programados", async ({
  page,
  request,
}) => {
  const g = await fullySetUp(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  await expect(page.getByTestId("config-exceptions")).toBeVisible();
  await expect(page.getByTestId("config-exceptions-link")).toBeVisible();
  await expect(page.getByTestId("config-advanced-link")).toBeVisible();
  await expect(page.getByTestId("config-exceptions-summary")).toContainText("different");

  await applyChanges(
    request,
    w.adminToken,
    [{ scope: "GROUP_RULE", groupId: g.id, value: "50" }],
    "NEXT_PERIOD",
  );
  await page.reload();
  await expect(page.getByTestId("config-exceptions-summary")).toHaveText("1 scheduled change");
  await page.getByTestId("config-advanced-link").click();
  await expect(page.getByTestId("commissions-advanced")).toBeVisible();
});
