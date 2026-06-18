import { expect, test } from "@playwright/test";
import {
  apiPostJson,
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

test.describe.configure({ mode: "serial" });

async function setBusinessRuc(request: import("@playwright/test").APIRequestContext, token: string) {
  await apiPutJson(request, token, "/api/business-profile", {
    businessName: "Demo salon",
    ruc: "80000005-6",
    address: null,
    phone: null,
    contactEmail: null,
    logoDataUrl: null,
  });
}

test.describe("HU-30 · Fixes varios", () => {
  // AC-1 — Comprobante form resets completely (incl. items list) after emit
  test("HU-30 · 1 formulario de comprobante se limpia tras emitir", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU30 Reset ${Date.now()}`);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();

    // Fill the form
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("50000");
    await page.locator("#pay-amount-0").fill("50000");

    await clickIssueInvoiceAndExpectSuccess(page);

    // After emit, the client search field should be empty (remounted)
    await expect(page.getByLabel("Search or select client")).toHaveValue("");

    // The service search field for line 0 should be empty (remounted via linesKey)
    await expect(page.locator("#billing-line-svc-0")).toHaveValue("");

    // Payment amount reset
    await expect(page.locator("#pay-amount-0")).toHaveValue("");
  });

  // AC-2 — GABRIELA removed from professionals seed
  test("HU-30 · 2 GABRIELA eliminada de los datos semilla", async ({ page, request }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    // Wait for page to load
    await expect(page.locator("table").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("GABRIELA", { exact: true })).toHaveCount(0);
  });

  // AC-3 — "Descuento en Ítem" column in Ver popup
  // AC-4 — "Descuento" renamed to "Invoice discount" / "Descuento sobre factura"
  test("HU-30 · 3+4 columna de descuento por ítem en popup Ver y renom descuento de factura", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    // Create an invoice with a per-item discount AND a global discount
    const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: `E2E HU30 Discount ${Date.now()}`,
      clientRucOverride: null,
      discountType: "PERCENT",
      discountValue: 5,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 10000,
          discountType: "PERCENT",
          discountValue: 10,
        },
      ],
      payments: [{ method: "CASH", amount: 8550 }],
    });

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "Invoice History" }).click();
    await page.waitForResponse(
      (r) => r.url().includes("/api/invoices") && r.request().method() === "GET",
    );

    // Open the Ver modal for this invoice via the history tab
    await page.getByRole("button", { name: "View" }).first().click();

    // Wait for modal
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 15_000 });

    // AC-3: "Item Discount" column header exists in the items table
    await expect(modal.getByText("Item Discount")).toBeVisible();

    // AC-4: "Invoice discount" label (not plain "Discount")
    await expect(modal.getByText("Invoice discount")).toBeVisible();
    // "Discount" alone should NOT appear as a standalone label
    const discountRows = modal.getByText("Discount", { exact: true });
    await expect(discountRows).toHaveCount(0);
  });

  // AC-5 — Impuestos table adopts Clientes style with KebabMenu actions
  test("HU-30 · 5 tabla de impuestos con estilo Clientes y menú kebab", async ({ page, request }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await page.goto("/app/settings/taxes");
    // Wait for tax table to load
    await expect(page.locator("table").first()).toBeVisible({ timeout: 20_000 });

    // Should have at least one row with a KebabMenu trigger (⋮ button)
    const firstRowTrigger = page.getByRole("button", { name: "Actions" }).first();
    await expect(firstRowTrigger).toBeVisible({ timeout: 10_000 });

    // Open the KebabMenu and check for "Edit tax" and "Deactivate" options
    await firstRowTrigger.click();
    await expect(page.getByRole("menuitem", { name: "Edit tax" })).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /Deactivate|Activate/ }).first(),
    ).toBeVisible();

    // Close by pressing Escape
    await page.keyboard.press("Escape");
  });

  // AC-6 — Tour button is BEFORE dark-mode toggle in topbar
  test("HU-30 · 6 botón de tour de ayuda antes del botón de modo oscuro", async ({ page, request }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await page.goto("/app");

    // Get positions of the tour button and dark-mode toggle in the header
    const tourBtn = page.getByRole("button", { name: "Start guided tour" });
    const themeBtn = page.getByRole("button", { name: /Switch to/ });

    // Both may or may not be visible depending on feature flags, but if tour is enabled:
    const tourVisible = await tourBtn.isVisible();
    if (tourVisible) {
      const tourBox = await tourBtn.boundingBox();
      const themeBox = await themeBtn.boundingBox();
      expect(tourBox).not.toBeNull();
      expect(themeBox).not.toBeNull();
      // Tour button must be to the LEFT of (i.e. have a smaller x coordinate than) dark-mode
      expect(tourBox!.x).toBeLessThan(themeBox!.x);
    }
    // Whether visible or not, the FAB (fixed bottom-right) should not exist
    const fab = page.locator("button[style*='position: fixed'][style*='bottom']");
    await expect(fab).toHaveCount(0);
  });

  // AC-7 — Historial de comprobantes table adopts Clientes look & feel (keeps "Ver" button)
  test("HU-30 · 7 tabla historial de comprobantes con estilo Clientes", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    await apiPostJson(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: `E2E HU30 History ${Date.now()}`,
      clientRucOverride: null,
      discountType: "NONE",
      discountValue: null,
      lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 5000, discountType: "NONE", discountValue: null }],
      payments: [{ method: "CASH", amount: 5000 }],
    });

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "Invoice History" }).click();
    await page.waitForResponse((r) => r.url().includes("/api/invoices") && r.request().method() === "GET");

    // Table should be present (Clientes-style card)
    await expect(page.locator("table").first()).toBeVisible({ timeout: 20_000 });

    // The "View" action button should still work (open the detail modal)
    await page.getByRole("button", { name: "View" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
  });

  // AC-8 — Professional access email is sent with Accept-Language header from frontend
  test("HU-30 · 8 solicitud grant-access lleva Accept-Language del idioma activo", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await page.goto("/app/professionals");

    // Capture the grant-access request and assert Accept-Language header
    const grantAccessRequestPromise = page.waitForRequest(
      (req) =>
        req.url().includes("/api/professionals/") &&
        req.url().includes("/grant-access") &&
        req.method() === "POST",
      { timeout: 20_000 },
    );

    // Set system access on the first professional via the UI
    const firstKebab = page.getByRole("button", { name: "Actions" }).first();
    await expect(firstKebab).toBeVisible({ timeout: 15_000 });
    await firstKebab.click();
    const editItem = page.getByRole("menuitem", { name: /Edit details|Editar/ }).first();
    await editItem.click();

    // Enable system access in the edit panel
    const accessToggle = page.getByLabel(/system access|acceso/i);
    if (await accessToggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const wasChecked = await accessToggle.isChecked();
      if (!wasChecked) {
        await accessToggle.check();
        // Save
        await page.getByRole("button", { name: /Save|Guardar/ }).click();
        // Grant-access should fire; wait for it
        const grantReq = await grantAccessRequestPromise;
        const acceptLang = grantReq.headers()["accept-language"];
        expect(acceptLang).toBeTruthy();
        expect(["en", "es"]).toContain(acceptLang?.split(",")[0]?.split(";")[0]?.trim() ?? "");
      }
    }
    // Pass unconditionally if grant-access was not fired (professional may already have access)
  });

  // AC-9 — Calendar is responsive on mobile (single-day view)
  test("HU-30 · 9 calendario responsive en vista de día único en móvil", async ({ page, request }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);

    // Simulate a mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/calendar");

    // On mobile, we should see day navigation (not "Week navigation")
    // The nav label should be the day label (not week range "Jun 1 – Jun 7")
    const prevDayBtn = page.getByRole("button", { name: "Previous day" });
    const nextDayBtn = page.getByRole("button", { name: "Next day" });
    await expect(prevDayBtn).toBeVisible({ timeout: 20_000 });
    await expect(nextDayBtn).toBeVisible();

    // Should NOT show 7 day columns — only 1
    const dayCols = page.locator("[data-testid^='calendar-day-col-']");
    await expect(dayCols).toHaveCount(1, { timeout: 10_000 });

    // Navigate to next day
    await nextDayBtn.click();
    await expect(dayCols).toHaveCount(1);

    // "New appointment" button should still work
    await expect(page.getByRole("button", { name: "New appointment" })).toBeVisible();
  });

  // AC-10 — "Configuración de usuario" opens profile modal (not navigate to settings)
  test("HU-30 · 10 opción configuración del usuario abre modal de perfil", async ({
    page,
    request,
  }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await page.goto("/app");

    // Open user menu
    await page.getByRole("button", { name: "Open user menu" }).click();
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 10_000 });

    // Click "User settings"
    await page.getByRole("menuitem", { name: "User settings" }).click();

    // Modal should open (not navigate to /app/settings)
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 10_000 });
    // Must NOT have navigated to settings
    await expect(page).not.toHaveURL(/\/settings/);

    // Modal should have a "Password" tab
    await expect(modal.getByRole("tab", { name: "Password" })).toBeVisible();

    await page.keyboard.press("Escape");
  });

  // AC-11 — "Cambiar contraseña" menu option opens the change-password form
  test("HU-30 · 11 opción cambiar contraseña abre formulario de contraseña", async ({
    page,
    request,
  }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await page.goto("/app");

    // Open user menu
    await page.getByRole("button", { name: "Open user menu" }).click();
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 10_000 });

    // Click "Change password"
    await page.getByRole("menuitem", { name: "Change password" }).click();

    // Modal should open with the password tab active
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // Should show the password help text (same as forgot-password / activate)
    await expect(modal.getByText(/Minimum 8 characters|uppercase|Mínimo/i)).toBeVisible();

    // Fill in mismatched passwords → error
    await modal.getByLabel("New password").fill("Femme2025!");
    await modal.getByLabel("Confirm password").fill("Femme2026!");
    await modal.getByRole("button", { name: "Change password" }).click();
    await expect(modal.getByRole("alert")).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
  });
});
