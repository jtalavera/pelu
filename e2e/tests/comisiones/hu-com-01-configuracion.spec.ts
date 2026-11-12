import { expect, test } from "@playwright/test";
import { API_BASE, apiGetJson } from "../../fixtures/api";
import {
  enableCommissionsGlobally,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  setTenantFlag,
  type CommissionWorld,
  openCommissionsMore,
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
  await page.getByRole("link", { name: "Commissions" }).click();
  await openCommissionsMore(page, "Settings");
  await expect(page.getByTestId("commission-settings")).toBeVisible();
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

  await page.getByTestId("commission-history-toggle").click();
  const history = page.getByTestId("commission-settings-history");
  await expect(history.getByText("Calculation base").first()).toBeVisible();
  await expect(history.getByText("Including VAT").first()).toBeVisible();
  await expect(history.getByText(w.adminEmail).first()).toBeVisible();
});

test("comisión general de servicios y de productos: valida el rango con ejemplo y se guarda con «Aplicar»", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await openSettings(page);
  await changeSetting(page, "DEFAULT_SERVICE");
  await page.locator("#commission-setting-percent").fill("120");
  await page.getByTestId("commission-setting-save").click();
  const err = page.locator("#commission-setting-percent-error");
  await expect(err).toHaveText(/between 0 and 100.*e\.g\. 40\.5/);
  await expect(page.locator("#commission-setting-percent")).toHaveAttribute("aria-invalid", "true");

  await page.locator("#commission-setting-percent").fill("35,5");
  await page.getByTestId("commission-setting-save").click();
  await applyImmediately(page);

  await changeSetting(page, "DEFAULT_PRODUCT");
  await page.locator("#commission-setting-percent").fill("8");
  await page.getByTestId("commission-setting-save").click();
  await applyImmediately(page);

  const s = await apiGetJson<{ defaultPercentService: number; defaultPercentProduct: number }>(
    request,
    w.adminToken,
    "/api/commissions/settings",
  );
  expect(Number(s.defaultPercentService)).toBe(35.5);
  expect(Number(s.defaultPercentProduct)).toBe(8);
  await expect(page.getByTestId("commission-setting-DEFAULT_SERVICE")).toContainText("35,5");
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
