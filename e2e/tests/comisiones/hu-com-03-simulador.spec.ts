import { expect, test } from "@playwright/test";
import { apiGetJson } from "../../fixtures/api";
import {
  applyChanges,
  enableCommissionsGlobally,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/** HU-COM-03 · Simulador de comisión. */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
  w = await provisionCommissionWorld(request, "HU-COM-03");
  await applyChanges(request, w.adminToken, [
    { scope: "RULE", serviceId: w.service.id, value: "40" },
    { scope: "RULE", serviceId: w.service.id, professionalId: w.bea.id, value: "50" },
  ]);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test("muestra base configurada con fórmula, % y su origen, comisión, y la comparación con la otra base; no persiste", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Simulator" }).click();
  await page.locator("#sim-item").selectOption({ label: `${w.service.name} (Services)` });
  await page.locator("#sim-professional").selectOption({ label: w.ana.name });
  await page.locator("#sim-amount").fill("110000");
  await page.getByTestId("commission-simulate").click();
  const result = page.getByTestId("commission-simulation-result");
  await expect(result).toContainText("40 %");
  await expect(result).toContainText("Item general %");
  await expect(page.getByTestId("commission-simulation-configured")).toContainText("Excluding VAT");
  await expect(page.getByTestId("commission-simulation-configured")).toContainText("100.000");
  await expect(page.getByTestId("commission-simulation-configured")).toContainText("40.000");
  await expect(page.getByTestId("commission-simulation-alternative")).toContainText("Including VAT");
  await expect(page.getByTestId("commission-simulation-alternative")).toContainText("44.000");

  // Exception origin for Bea, and a discount.
  await page.locator("#sim-professional").selectOption({ label: w.bea.name });
  await page.locator("#sim-discount").fill("10000");
  await page.getByTestId("commission-simulate").click();
  await expect(result).toContainText("Professional exception");
  await expect(page.getByTestId("commission-simulation-alternative")).toContainText("50.000");

  // Nothing persisted.
  const es = await apiGetJson<unknown[]>(request, w.adminToken, "/api/commissions/entries");
  expect(es).toHaveLength(0);
});

test("valida ítem y monto con un ejemplo", async ({ page }) => {
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Simulator" }).click();
  await page.getByTestId("commission-simulate").click();
  await expect(page.locator("#sim-amount-error")).toContainText("e.g. 110,000");
});

test("la fecha de simulación usa lo vigente a esa fecha, incluidos cambios programados", async ({ request }) => {
  const scheduled = await applyChanges(
    request,
    w.adminToken,
    [{ scope: "RULE", serviceId: w.service.id, value: "45" }],
    "NEXT_PERIOD",
  );
  const later = new Date(scheduled.effectiveFrom);
  later.setDate(later.getDate() + 3);
  const res = await request.post(`${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/commissions/simulate`, {
    headers: { Authorization: `Bearer ${w.adminToken}`, "Content-Type": "application/json" },
    data: { serviceId: w.service.id, professionalId: w.ana.id, lineAmount: 110000, date: later.toISOString().slice(0, 10) },
  });
  expect(res.ok()).toBeTruthy();
  expect(Number((await res.json()).percent)).toBe(45);
});
