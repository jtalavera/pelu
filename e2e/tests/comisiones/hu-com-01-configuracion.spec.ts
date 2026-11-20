import { expect, test } from "@playwright/test";
import { API_BASE, apiGetJson } from "../../fixtures/api";
import {
  enableCommissionsGlobally,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  setTenantFlag,
  type CommissionWorld,
  openCommissions,
  openSetupStep,
} from "../../fixtures/commissions";

/** HU-COM-01 · Configurar el módulo de comisiones del negocio (base y comisión general en Reglas → Reglas generales). */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
  w = await provisionCommissionWorld(request, "HU-COM-01");
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

async function openSettings(page: import("@playwright/test").Page) {
  await openCommissions(page, "setup");
  await expect(page.getByTestId("commission-settings")).toBeVisible();
  await openSetupStep(page, 1); // HU-COM-18: «Cómo se calcula» is folded until opened
}

async function applyImmediately(page: import("@playwright/test").Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/never modify accrued commissions/).first()).toBeVisible();
  await dialog.getByTestId("commission-apply-mode-IMMEDIATE").check();
  await dialog.getByTestId("commission-apply-confirm").click();
  await expect(page.getByRole("status").filter({ hasText: "Change applied." })).toBeVisible();
}

async function changeSetting(page: import("@playwright/test").Page, scope: string) {
  await page.getByTestId(`commission-setting-change-${scope}`).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("la base por defecto es «Sin IVA», con ayuda y ejemplo, en Configuración; cambiarla pide cómo aplicarla y queda auditada", async ({
  page,
}) => {
  await loginAdminUi(page, w);
  await openSettings(page);
  await expect(page.getByTestId("commission-setting-BASE")).toContainText("Excluding VAT");
  await changeSetting(page, "BASE");
  await expect(page.getByTestId("commission-base-NET_OF_TAX")).toBeChecked();
  await expect(page.getByText("Line total after discounts, minus the line's VAT.")).toBeVisible();
  await expect(page.getByText(/excluding VAT 40,000 Gs; including VAT 44,000 Gs/).first()).toBeVisible();

  await page.getByTestId("commission-base-TAX_INCLUDED").check();
  await page.getByTestId("commission-setting-save").click();
  await applyImmediately(page);
  await expect(page.getByTestId("commission-setting-BASE")).toContainText("Including VAT");

  // HU-COM-15: the change history lives in Setup › Advanced.
  await page.getByTestId("config-advanced-link").click();
  await page.getByTestId("commission-history-toggle").click();
  const history = page.getByTestId("commission-settings-history");
  await expect(history.getByText("Calculation base").first()).toBeVisible();
  await expect(history.getByText("Including VAT").first()).toBeVisible();
  await expect(history.getByText(w.adminEmail).first()).toBeVisible();
});

test("comisión general de servicios y de productos: valida el rango y se guarda con «Aplicar»", async ({ page, request }) => {
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  // HU-COM-20: the general % live in Setup › Commissions (not in step 1 any more).
  await page.goto("/app/commissions/configurar/comisiones");
  await expect(page.getByTestId("commission-rates")).toBeVisible();
  await page.getByTestId("rates-general-SERVICE-edit").click();
  await page.getByTestId("rates-percent").fill("120");
  await page.getByTestId("rates-save").click();
  await expect(page.locator("#rates-percent-error")).toHaveText(/between 0 and 100.*for example 40 or 37\.5/);
  await page.getByTestId("rates-percent").fill("35,5");
  await page.getByTestId("rates-save").click();
  await applyImmediately(page);
  await expect(page.getByTestId("rates-general-SERVICE-percent")).toHaveText("35,5 %");

  await page.getByTestId("rates-general-PRODUCT-edit").click();
  await page.getByTestId("rates-percent").fill("8");
  await page.getByTestId("rates-save").click();
  await applyImmediately(page);
  await expect(page.getByTestId("rates-general-PRODUCT-percent")).toHaveText("8 %");

  const s = await apiGetJson<{ defaultPercentService: number; defaultPercentProduct: number }>(
    request,
    w.adminToken,
    "/api/commissions/settings",
  );
  expect(Number(s.defaultPercentService)).toBe(35.5);
  expect(Number(s.defaultPercentProduct)).toBe(8);
});

test("la periodicidad se elige entre semanal, quincenal, mensual y manual sin preguntar cómo aplicarla", async ({
  page,
}) => {
  await loginAdminUi(page, w);
  await openSettings(page);
  await changeSetting(page, "PERIODICITY");
  const select = page.locator("#commission-periodicity");
  await expect(select.locator("option")).toHaveText([
    "Weekly (Monday to Sunday)",
    "Biweekly (1–15 and 16–end of month)",
    "Monthly (calendar month)",
    "Manual (free range)",
  ]);
  await select.selectOption("WEEKLY");
  await page.getByTestId("commission-setting-save").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Periodicity updated." })).toBeVisible();
  await changeSetting(page, "PERIODICITY");
  await select.selectOption("MONTHLY");
  await page.getByTestId("commission-setting-save").click();
  await expect(page.getByRole("status").filter({ hasText: "Periodicity updated." })).toBeVisible();
  await expect(page.getByTestId("commission-setting-PERIODICITY")).toContainText("Monthly");
});

test("con la flag apagada la sección no aparece y la API responde FEATURE_NOT_ENABLED", async ({ page, request }) => {
  await setTenantFlag(request, w.tenantId, "COMMISSIONS", false);
  try {
    await loginAdminUi(page, w);
    await expect(page.getByRole("link", { name: "Commissions" })).toHaveCount(0);
    const res = await request.get(`${API_BASE}/api/commissions/settings`, {
      headers: { Authorization: `Bearer ${w.adminToken}` },
    });
    expect(res.status()).toBe(403);
    expect(await res.text()).toContain("FEATURE_NOT_ENABLED");
  } finally {
    await setTenantFlag(request, w.tenantId, "COMMISSIONS", true);
  }
});
