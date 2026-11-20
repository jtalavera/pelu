import { expect, test } from "@playwright/test";
import {
  applyChanges,
  enableCommissionsGlobally,
  entriesOfInvoice,
  issueInvoice,
  loginAdminUi,
  openCommissions,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/** Actividad › Movimientos: la cantidad de filas por página coincide con lo que dice el selector. */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "MOV-PAGE");
  await applyChanges(request, w.adminToken, [{ scope: "DEFAULT_SERVICE", value: "40" }]);
});

test("Movimientos muestra 10 filas por página cuando el selector dice 10, y el rango cuenta lo mismo", async ({ page, request }) => {
  for (let i = 0; i < 12; i++) {
    const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id }]);
    await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  }
  await loginAdminUi(page, w);
  await openCommissions(page, "activity");
  await page.getByTestId("activity-tab-movements").click();

  const rows = page.getByTestId("movement-row");
  await expect(page.getByLabel("Rows per page:")).toHaveValue("10");
  await expect(rows).toHaveCount(10);
  await expect(page.getByText("1–10 of 12")).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByText("11–12 of 12")).toBeVisible();

  // Another size from the selector is respected as well.
  await page.getByLabel("Rows per page:").selectOption("25");
  await expect(rows).toHaveCount(12);
  await expect(page.getByText("1–12 of 12")).toBeVisible();
});
