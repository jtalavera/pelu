import { expect, test } from "@playwright/test";
import { API_BASE, apiGetJson } from "../../fixtures/api";
import {
  enableCommissionsGlobally,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  setTenantFlag,
  type CommissionWorld,
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
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByTestId("commission-settings")).toBeVisible();
}

async function openGeneralRules(page: import("@playwright/test").Page) {
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Rules", exact: true }).click();
  await page.getByRole("tab", { name: "General rules" }).click();
  await expect(page.getByTestId("rules-general")).toBeVisible();
}

async function saveAllImmediately(page: import("@playwright/test").Page) {
  await page.getByTestId("rules-save").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/never modify accrued commissions/).first()).toBeVisible();
  await dialog.getByTestId("commission-apply-mode-IMMEDIATE").check();
  await dialog.getByTestId("commission-apply-confirm").click();
  await expect(page.getByRole("status").filter({ hasText: "Change applied." })).toBeVisible();
}

test("la base por defecto es «Sin IVA», con ayuda y ejemplo, en Reglas generales; cambiarla pide cómo aplicarla y queda auditada", async ({
  page,
}) => {
  await loginAdminUi(page, w);
  await openGeneralRules(page);
  await expect(page.getByTestId("commission-base-NET_OF_TAX")).toBeChecked();
  await expect(page.getByText("Line total after discounts, minus the line's VAT.")).toBeVisible();
  await expect(page.getByText(/excluding VAT 40,000 Gs; including VAT 44,000 Gs/).first()).toBeVisible();

  await page.getByTestId("commission-base-TAX_INCLUDED").check();
  await expect(page.getByTestId("rules-pending-count")).toHaveText("1 unsaved change");
  await saveAllImmediately(page);
  await expect(page.getByTestId("rules-pending-count")).toHaveCount(0);

  await page.getByRole("tab", { name: "Settings" }).click();
  const history = page.getByTestId("commission-settings-history");
  await expect(history.getByText("Calculation base").first()).toBeVisible();
  await expect(history.getByText("Including VAT").first()).toBeVisible();
  await expect(history.getByText(w.adminEmail).first()).toBeVisible();
});

test("comisión general de servicios y de productos: valida el rango con ejemplo y se guardan juntas con «Guardar cambios»", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await openGeneralRules(page);
  await page.locator("#commission-DEFAULT_SERVICE").fill("120");
  await page.locator("#commission-DEFAULT_SERVICE").blur();
  const err = page.locator("#commission-DEFAULT_SERVICE-error");
  await expect(err).toHaveText(/between 0 and 100.*e\.g\. 40\.5/);
  await expect(page.locator("#commission-DEFAULT_SERVICE")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("rules-save")).toBeDisabled();

  await page.locator("#commission-DEFAULT_SERVICE").fill("35,5");
  await page.locator("#commission-DEFAULT_SERVICE").blur();
  await page.locator("#commission-DEFAULT_PRODUCT").fill("8");
  await page.locator("#commission-DEFAULT_PRODUCT").blur();
  await expect(page.getByTestId("rules-pending-count")).toHaveText("2 unsaved changes");
  await saveAllImmediately(page);

  const s = await apiGetJson<{ defaultPercentService: number; defaultPercentProduct: number }>(
    request,
    w.adminToken,
    "/api/commissions/settings",
  );
  expect(Number(s.defaultPercentService)).toBe(35.5);
  expect(Number(s.defaultPercentProduct)).toBe(8);
  await expect(page.locator("#commission-DEFAULT_SERVICE")).toHaveValue("35,5");
});

test("la periodicidad se elige entre semanal, quincenal, mensual y manual sin preguntar cómo aplicarla", async ({
  page,
}) => {
  await loginAdminUi(page, w);
  await openSettings(page);
  const select = page.locator("#commission-periodicity");
  await expect(select.locator("option")).toHaveText([
    "Weekly (Monday to Sunday)",
    "Biweekly (1–15 and 16–end of month)",
    "Monthly (calendar month)",
    "Manual (free range)",
  ]);
  await select.selectOption("WEEKLY");
  await page.getByTestId("commission-save-periodicity").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Periodicity updated." })).toBeVisible();
  await select.selectOption("MONTHLY");
  await page.getByTestId("commission-save-periodicity").click();
  await expect(page.getByRole("status").filter({ hasText: "Periodicity updated." })).toBeVisible();
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
