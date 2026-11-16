import { expect, test } from "@playwright/test";
import {
  applyChanges,
  assignToGroup,
  createGroup,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  liquidarRow,
  liquidarTab,
  loginAdminUi,
  openCommissions,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-28 · Liquidar más simple: una pestaña por etapa
 * (requirements/user_stories/HU-COM-28-liquidar-pestanas.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-28");
  await applyChanges(request, w.adminToken, [{ scope: "DEFAULT_SERVICE", value: "40" }]);
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id, w.service2.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "GROUP_RULE", groupId: g.id, professionalId: w.ana.id, value: "40" },
    { scope: "GROUP_RULE", groupId: g.id, professionalId: w.bea.id, value: "40" },
  ]);
});

type Req = Parameters<typeof issueInvoice>[0];

async function accrue(request: Req, professionalId: number) {
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, professionalId }]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
}

/** Ana has a draft settlement and Bea has not been generated yet. */
async function anaDraftBeaPending(request: Req) {
  await accrue(request, w.ana.id);
  await generateSettlements(request, w.adminToken, [w.ana.id]);
  await accrue(request, w.bea.id);
}

async function openLiquidar(page: Parameters<typeof loginAdminUi>[0]) {
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");
  await expect(page.getByTestId("liquidar-tabs")).toBeVisible();
}

// ── AC1 · AC2 · AC5 · AC6 · pestañas, botón principal y filas ─────────────────────────────────────

test("AC1 · AC2 · hay una pestaña por etapa con su cantidad, abre en la que toca hacer y muestra solo esas filas", async ({ page, request }) => {
  await anaDraftBeaPending(request);
  await openLiquidar(page);

  await expect(page.getByTestId("liquidar-tab-UNSETTLED")).toContainText("To generate");
  await expect(page.getByTestId("liquidar-tab-DRAFT")).toContainText("To approve");
  await expect(page.getByTestId("liquidar-tab-APPROVED")).toContainText("To pay");
  await expect(page.getByTestId("liquidar-tab-PAID")).toContainText("Paid");
  await expect(page.getByTestId("liquidar-tab-UNSETTLED-count")).toHaveText("1");
  await expect(page.getByTestId("liquidar-tab-DRAFT-count")).toHaveText("1");
  await expect(page.getByTestId("liquidar-tab-APPROVED-count")).toHaveText("0");
  await expect(page.getByTestId("liquidar-tab-PAID-count")).toHaveText("0");

  // «To generate» is the stage that is next to do: it is open, with only Bea.
  await expect(page.getByTestId("liquidar-tab-UNSETTLED")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(1);
  await expect(page.getByTestId("liquidar-row")).toContainText(w.bea.name, { ignoreCase: true });
  await expect(page.getByTestId("liquidar-summary")).toContainText("1 professional");
  await expect(page.getByTestId("liquidar-main-action")).toHaveText("Generate 1");

  await liquidarTab(page, "DRAFT");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(1);
  await expect(page.getByTestId("liquidar-row")).toContainText(w.ana.name, { ignoreCase: true });
  await expect(page.getByTestId("liquidar-main-action")).toHaveText("Approve 1");

  // «Paid» has nothing to do: no main button.
  await liquidarTab(page, "PAID");
  await expect(page.getByTestId("liquidar-main-action")).toHaveCount(0);
  await expect(page.getByTestId("liquidar-total")).toBeVisible();
  await expect(page.getByTestId("liquidar-paid-total")).toBeVisible();
});

test("AC1 · si no queda nada pendiente abre en «Pagadas»; ?state= abre esa pestaña", async ({ page, request }) => {
  await accrue(request, w.ana.id);
  await generateSettlements(request, w.adminToken, [w.ana.id]);
  await loginAdminUi(page, w);
  await page.goto("/app/commissions/liquidar");
  // The only thing left is a draft, so «To approve» is the open tab.
  await expect(page.getByTestId("liquidar-tab-DRAFT")).toHaveAttribute("aria-selected", "true");
  await page.goto("/app/commissions/liquidar?state=PAID");
  await expect(page.getByTestId("liquidar-tab-PAID")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("liquidar-empty")).toBeVisible();
});

test("AC6 · la fila trae nombre, nota, comisión, retenido y un solo botón; el borrador suma «⋯» con «Anular»; sin etiqueta de estado ni «Detalle» aparte", async ({
  page,
  request,
}) => {
  await anaDraftBeaPending(request);
  await openLiquidar(page);

  const bea = liquidarRow(page, w.bea.name);
  await expect(bea.getByTestId("liquidar-row-note")).toHaveText("1 movement");
  await expect(bea.getByTestId("liquidar-row-amount")).toContainText("Gs.");
  await expect(bea.getByTestId("liquidar-row-retention")).toBeVisible();
  await expect(bea.getByTestId("liquidar-row-generate")).toBeVisible();
  await expect(bea.getByTestId("liquidar-row-more")).toHaveCount(0);
  await expect(bea.getByRole("link", { name: w.bea.name, exact: false }).first()).toHaveAttribute("href", /\/app\/commissions\/equipo\/\d+$/);

  await liquidarTab(page, "DRAFT");
  const ana = liquidarRow(page, w.ana.name);
  await expect(ana.getByTestId("liquidar-row-approve")).toBeVisible();
  await expect(ana.getByTestId("liquidar-row-more")).toBeVisible();
  // The line under the name is the link to the settlement's detail.
  await expect(ana.getByTestId("liquidar-row-detail")).toContainText("Settlement #");
  // There is no status label on the row: the tab already says it.
  await expect(ana).not.toContainText("Draft");
});

// ── AC3 · la pestaña sigue sola a la etapa que toca ────────────────────────────────────────────────

test("AC3 · después de una acción, si la pestaña se queda sin filas pasa a la etapa que toca", async ({ page, request }) => {
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await openLiquidar(page);

  await page.getByTestId("liquidar-main-action").click();
  await page.getByTestId("liquidar-confirm").click();
  await expect(page.getByTestId("liquidar-notice")).toContainText("2 settlements were generated.");
  await expect(page.getByTestId("liquidar-tab-DRAFT")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(2);

  await page.getByTestId("liquidar-main-action").click();
  await page.getByTestId("liquidar-confirm").click();
  await expect(page.getByTestId("liquidar-tab-APPROVED")).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("liquidar-main-action").click();
  await page.getByTestId("liquidar-confirm").click();
  await expect(page.getByTestId("liquidar-tab-PAID")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("liquidar-main-action")).toHaveCount(0);
});

test("AC3 · si en la pestaña aún quedan filas, se queda donde está", async ({ page, request }) => {
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await openLiquidar(page);

  await liquidarRow(page, w.ana.name).getByTestId("liquidar-row-generate").click();
  await page.getByTestId("liquidar-confirm").click();
  await expect(page.getByTestId("liquidar-notice")).toContainText("1 settlement was generated.");
  await expect(page.getByTestId("liquidar-tab-UNSETTLED")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(1);
  await expect(page.getByTestId("liquidar-tab-DRAFT-count")).toHaveText("1");
});

// ── AC4 · sin carteles de más ─────────────────────────────────────────────────────────────────────

test("AC4 · no hay aviso de alcance, tarjetas de paso ni título; la periodicidad se abre con el ⓘ", async ({ page, request }) => {
  await anaDraftBeaPending(request);
  await openLiquidar(page);

  await expect(page.getByTestId("liquidar-scope")).toHaveCount(0);
  await expect(page.getByTestId("liquidar-steps")).toHaveCount(0);
  await expect(page.getByTestId("liquidar")).not.toContainText("active professionals are shown");
  await expect(page.getByTestId("liquidar")).not.toContainText("Professionals of the period");
  await expect(page.getByTestId("liquidar-period-note")).toHaveCount(0);
  await page.getByTestId("liquidar-period-info").click();
  await expect(page.getByTestId("liquidar-period-note")).toContainText("Periods follow your salon's periodicity");
  await page.getByTestId("liquidar-period-info").click();
  await expect(page.getByTestId("liquidar-period-note")).toHaveCount(0);
});

// ── AC7 · «Sin movimientos» al pie ────────────────────────────────────────────────────────────────

test("AC7 · quienes no tienen movimientos no son filas: una línea al pie abre sus nombres", async ({ page, request }) => {
  await accrue(request, w.ana.id);
  await openLiquidar(page);

  await expect(page.getByTestId("liquidar-row")).toHaveCount(1);
  await expect(page.getByTestId("liquidar-row").filter({ hasText: w.bea.name })).toHaveCount(0);
  await expect(page.getByTestId("liquidar-none-toggle")).toContainText("with no movements");
  await expect(page.getByTestId("liquidar-none-list")).toHaveCount(0);
  await page.getByTestId("liquidar-none-toggle").click();
  await expect(page.getByTestId("liquidar-none-list")).toContainText(w.bea.name, { ignoreCase: true });
  await expect(page.getByTestId("liquidar-none-toggle")).toHaveAttribute("aria-expanded", "true");
  await page.getByTestId("liquidar-none-toggle").click();
  await expect(page.getByTestId("liquidar-none-list")).toHaveCount(0);
});

// ── AC8 · selección y CSV ─────────────────────────────────────────────────────────────────────────

test("AC8 · la casilla del encabezado marca a todas las de la pestaña y el botón principal actúa sobre las marcadas", async ({ page, request }) => {
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await openLiquidar(page);

  await expect(page.getByTestId("liquidar-main-action")).toHaveText("Generate 2");
  await liquidarRow(page, w.ana.name).getByTestId("liquidar-row-check").check();
  await expect(page.getByTestId("liquidar-selection-count")).toHaveText("1 selected");
  await expect(page.getByTestId("liquidar-main-action")).toHaveText("Generate 1");
  await page.getByTestId("liquidar-selection-clear").click();
  await expect(page.getByTestId("liquidar-main-action")).toHaveText("Generate 2");

  await page.getByTestId("liquidar-group-check-UNSETTLED").check();
  await expect(page.getByTestId("liquidar-selection-count")).toHaveText("2 selected");
  await expect(page.getByTestId("liquidar-csv")).toBeVisible();
});

// ── AC9 · pestaña vacía ───────────────────────────────────────────────────────────────────────────

test("AC9 · una pestaña sin filas dice que no hay nada por hacer y su botón queda deshabilitado", async ({ page, request }) => {
  await accrue(request, w.ana.id);
  await openLiquidar(page);

  await liquidarTab(page, "DRAFT");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(0);
  await expect(page.getByTestId("liquidar-empty")).toHaveText("Nothing to approve in this period ✓");
  await expect(page.getByTestId("liquidar-main-action")).toBeDisabled();
  await liquidarTab(page, "PAID");
  await expect(page.getByTestId("liquidar-empty")).toHaveText("There are no paid settlements in this period yet.");
});

// ── AC10 · celular ────────────────────────────────────────────────────────────────────────────────

test("AC10 · en el celular las pestañas y el botón principal se ven y la página no se desborda", async ({ page, request }) => {
  await anaDraftBeaPending(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");
  await expect(page.getByTestId("liquidar-tabs")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("liquidar-main-action")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  const box = await page.getByTestId("liquidar-main-action").boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
