import { expect, test } from "@playwright/test";
import { apiGetJson, apiPostJsonStatus } from "../../fixtures/api";
import {
  applyChanges,
  approveSettlementApi,
  assignToGroup,
  createGroup,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  liquidarRow,
  liquidarTab,
  liquidarVoidRow,
  loginAdminUi,
  openCommissions,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-19 · Anular borradores rápido desde Liquidar
 * (requirements/user_stories/HU-COM-19-anular-borradores-rapido.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-19");
  await applyChanges(request, w.adminToken, [{ scope: "DEFAULT_SERVICE", value: "40" }]);
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id, w.service2.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "GROUP_RULE", groupId: g.id, professionalId: w.ana.id, value: "40" },
    { scope: "GROUP_RULE", groupId: g.id, professionalId: w.bea.id, value: "40" },
  ]);
});

async function accrue(request: Parameters<typeof issueInvoice>[0], professionalId: number) {
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, professionalId }]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
}

/** Ana and Bea each with a draft settlement. */
async function twoDrafts(request: Parameters<typeof issueInvoice>[0]) {
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  const drafts = await generateSettlements(request, w.adminToken, [w.ana.id, w.bea.id]);
  expect(drafts).toHaveLength(2);
  return drafts;
}

type Detail = { settlement: { status: string; voidReason: string | null } };
const detailOf = (request: Parameters<typeof apiGetJson>[0], id: number) =>
  apiGetJson<Detail>(request, w.adminToken, `/api/commissions/settlements/${id}`);

// ── AC1 · «Anular» solo en los borradores ──────────────────────────────────────────────────────

test("AC1 · cada fila en Borrador tiene «Anular» junto a «Aprobar»; las otras no", async ({ page, request }) => {
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  const [anaDraft] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  expect(anaDraft.id).toBeGreaterThan(0);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");

  await liquidarTab(page, "DRAFT");
  const ana = liquidarRow(page, w.ana.name);
  await expect(ana.getByTestId("liquidar-row-approve")).toBeVisible();
  await ana.getByTestId("liquidar-row-more").click(); // «Void» lives in the row's «⋯» menu
  await expect(page.getByTestId("liquidar-row-void")).toBeVisible();
  await expect(page.getByTestId("liquidar-row-void")).toContainText("Void");
  await page.keyboard.press("Escape");
  // Bea is not settled yet: she can only be generated.
  await liquidarTab(page, "UNSETTLED");
  const bea = liquidarRow(page, w.bea.name);
  await expect(bea.getByTestId("liquidar-row-generate")).toBeVisible();
  await expect(bea.getByTestId("liquidar-row-more")).toHaveCount(0);
  // An approved one is corrected from its detail page, not from here.
  await approveSettlementApi(request, w.adminToken, anaDraft.id);
  await page.reload();
  await liquidarTab(page, "APPROVED");
  await expect(liquidarRow(page, w.ana.name).getByTestId("liquidar-row-more")).toHaveCount(0);
});

// ── AC2 · AC3 · anular una fila ────────────────────────────────────────────────────────────────

test("AC2 · anular un borrador pide confirmar, el motivo es opcional, vuelve a «Sin liquidar» y se puede generar de nuevo", async ({
  page,
  request,
}) => {
  const [anaDraft] = await twoDrafts(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");
  await expect(page.getByTestId("liquidar-tab-DRAFT")).toHaveAttribute("aria-selected", "true");

  await liquidarVoidRow(page, w.ana.name);
  await expect(page.getByTestId("liquidar-dialog-summary")).toContainText(w.ana.name);
  await expect(page.getByTestId("liquidar-confirm")).toHaveText("Void draft");
  await page.getByTestId("liquidar-confirm").click(); // without a reason

  await expect(page.getByTestId("liquidar-notice")).toContainText("The draft was voided");
  // She moves to «Not settled» and the other draft stays.
  await expect(page.getByTestId("liquidar-tab-UNSETTLED-count")).toHaveText("1");
  await liquidarTab(page, "UNSETTLED");
  await expect(liquidarRow(page, w.ana.name)).toHaveAttribute("data-status", "UNSETTLED");
  await liquidarTab(page, "DRAFT");
  await expect(liquidarRow(page, w.bea.name)).toHaveAttribute("data-status", "DRAFT");
  expect((await detailOf(request, anaDraft.id)).settlement).toMatchObject({ status: "VOIDED", voidReason: null });

  // «Generate again» opens the usual confirmation for her and creates a new draft.
  await page.getByTestId("liquidar-regenerate").click();
  await expect(page.getByTestId("liquidar-dialog-summary")).toContainText(w.ana.name);
  await page.getByTestId("liquidar-confirm").click();
  await liquidarTab(page, "DRAFT");
  await expect(liquidarRow(page, w.ana.name)).toHaveAttribute("data-status", "DRAFT");
});

test("AC3 · el motivo se escribe o se elige de tres frecuentes y queda guardado", async ({ page, request }) => {
  const [anaDraft, beaDraft] = await twoDrafts(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");

  await liquidarVoidRow(page, w.ana.name);
  await page.getByTestId("liquidar-void-reason-rule").click();
  await expect(page.getByTestId("liquidar-void-reason")).toHaveValue("A rule changed");
  await page.getByTestId("liquidar-confirm").click();
  await liquidarTab(page, "UNSETTLED");
  await expect(liquidarRow(page, w.ana.name)).toHaveAttribute("data-status", "UNSETTLED");
  expect((await detailOf(request, anaDraft.id)).settlement.voidReason).toBe("A rule changed");

  await liquidarTab(page, "DRAFT");
  await liquidarVoidRow(page, w.bea.name);
  await page.getByTestId("liquidar-void-reason").fill("Falta una factura");
  await page.getByTestId("liquidar-confirm").click();
  await liquidarTab(page, "UNSETTLED");
  await expect(liquidarRow(page, w.bea.name)).toHaveAttribute("data-status", "UNSETTLED");
  expect((await detailOf(request, beaDraft.id)).settlement.voidReason).toBe("Falta una factura");
});

// ── AC4 · en lote ──────────────────────────────────────────────────────────────────────────────

test("AC4 · en lote: la casilla del tramo marca los borradores, la barra de selección anula solo los borradores y se recalculan los tramos", async ({
  page,
  request,
}) => {
  const [anaDraft, beaDraft] = await twoDrafts(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");
  await expect(page.getByTestId("liquidar-selection")).toHaveCount(0);

  await page.getByTestId("liquidar-group-check-DRAFT").check();
  await expect(page.getByTestId("liquidar-selection-count")).toHaveText("2 selected");
  await page.getByTestId("liquidar-selection-clear").click();
  await expect(page.getByTestId("liquidar-selection")).toHaveCount(0);

  await page.getByTestId("liquidar-group-check-DRAFT").check();
  await page.getByTestId("liquidar-bulk-void").click();
  await expect(page.getByTestId("liquidar-confirm")).toHaveText("Void 2 drafts");
  await expect(page.getByTestId("liquidar-dialog-summary")).toContainText(w.ana.name);
  await expect(page.getByTestId("liquidar-dialog-summary")).toContainText(w.bea.name);
  await page.getByTestId("liquidar-void-reason").fill("Cambió una regla");
  await page.getByTestId("liquidar-confirm").click();

  await expect(page.getByTestId("liquidar-notice")).toContainText("2 drafts were voided");
  await expect(page.getByTestId("liquidar-tab-DRAFT-count")).toHaveText("0");
  await expect(page.getByTestId("liquidar-tab-UNSETTLED-count")).toHaveText("2");
  await liquidarTab(page, "UNSETTLED");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(2);
  await expect(page.getByTestId("liquidar-selection")).toHaveCount(0);
  for (const id of [anaDraft.id, beaDraft.id]) {
    expect((await detailOf(request, id)).settlement).toMatchObject({ status: "VOIDED", voidReason: "Cambió una regla" });
  }
});

test("AC4b · si en la selección hay filas que no son borradores, solo se anulan los borradores y se avisa", async ({ page, request }) => {
  await accrue(request, w.ana.id);
  const [anaDraft] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await accrue(request, w.bea.id); // Bea stays «Not settled»
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");

  await liquidarTab(page, "DRAFT");
  await liquidarRow(page, w.ana.name).getByTestId("liquidar-row-check").check();
  await liquidarTab(page, "UNSETTLED");
  await liquidarRow(page, w.bea.name).getByTestId("liquidar-row-check").check();
  await page.getByTestId("liquidar-bulk-void").click();
  await expect(page.getByTestId("liquidar-confirm")).toHaveText("Void draft");
  await expect(page.getByTestId("liquidar-void-skipped")).toContainText("the other selected one stays as it is");
  await page.getByTestId("liquidar-confirm").click();
  await liquidarTab(page, "UNSETTLED");
  await expect(liquidarRow(page, w.ana.name)).toHaveAttribute("data-status", "UNSETTLED");
  await expect(liquidarRow(page, w.bea.name)).toHaveAttribute("data-status", "UNSETTLED");
  expect((await detailOf(request, anaDraft.id)).settlement.status).toBe("VOIDED");

  // With only non-drafts selected there is nothing to void: the button does not even show.
  await liquidarRow(page, w.bea.name).getByTestId("liquidar-row-check").check();
  await expect(page.getByTestId("liquidar-selection")).toBeVisible();
  await expect(page.getByTestId("liquidar-bulk-void")).toHaveCount(0);
});

// ── AC5 · el motivo solo es obligatorio si ya estaba aprobada ───────────────────────────────────

test("AC5 · el motivo es opcional en un borrador y obligatorio en una liquidación aprobada (API y detalle)", async ({ page, request }) => {
  const [anaDraft, beaDraft] = await twoDrafts(request);

  // API: a draft is voided without a reason; an approved one is refused until it has one.
  const ok = await apiPostJsonStatus(request, w.adminToken, `/api/commissions/settlements/${anaDraft.id}/void`, { reason: "" });
  expect(ok.status).toBe(200);
  await approveSettlementApi(request, w.adminToken, beaDraft.id);
  const refused = await apiPostJsonStatus(request, w.adminToken, `/api/commissions/settlements/${beaDraft.id}/void`, { reason: "  " });
  expect(refused.status).toBe(400);
  expect(refused.text).toContain("SETTLEMENT_VOID_REASON_REQUIRED");

  // Detail page of the approved one: the reason is flagged as required.
  await loginAdminUi(page, w);
  await page.goto(`/app/commissions/settlements/${beaDraft.id}`);
  await page.getByTestId("settlement-more-trigger").click();
  await page.getByTestId("settlement-more-item-void").click();
  await page.getByTestId("settlement-void-confirm").click();
  await expect(page.locator("#void-error")).toContainText("required");
  await page.locator("#void-reason").fill("Pago mal calculado");
  await page.getByTestId("settlement-void-confirm").click();
  await expect(page.getByTestId("settlement-status")).toHaveText("Voided");
});
