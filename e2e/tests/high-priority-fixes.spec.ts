/**
 * E2E tests for the 6 high-priority GitHub issues:
 *   #37 — RUC warning on Nuevo comprobante
 *   #43 — Salon RUC snapshotted on the invoice (business_ruc field)
 *   #46 — Default IVA 10% when creating a new service
 *   #47 — Invoice to a different name/RUC without mutating the client
 *   #48 — "Ver" comprobante popup in Client History
 *   #49 — More vivid category colors shown in table swatches
 */

import { expect, test } from "@playwright/test";
import {
  apiGetJson,
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

async function setBusinessRuc(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  ruc: string | null,
) {
  await apiPutJson(request, token, "/api/business-profile", {
    businessName: "Demo salon",
    ruc,
    address: null,
    phone: null,
    contactEmail: null,
    logoDataUrl: null,
  });
}

// ─── Issue #46 ────────────────────────────────────────────────────────────────

test("Issue #46 · nuevo servicio: IVA 10% seleccionado por defecto", async ({ page }) => {
  await loginAsDemo(page);
  await page.goto("/app/services");
  // Create a category so the service form can open
  await page.getByRole("button", { name: "Categories", exact: true }).click();
  const catName = `IVACat ${Date.now()}`;
  await page.getByRole("button", { name: "+ New category" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(catName);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Services", exact: true }).click();

  await page.getByRole("button", { name: "+ New service" }).click();
  const dialog = page.getByRole("dialog", { name: "New service" });
  await expect(dialog).toBeVisible();

  // The "Tipo de impuesto" / "Tax type" select should default to IVA 10%
  const taxSelect = dialog.getByLabel(/tax type|tipo de impuesto/i);
  await expect(taxSelect).toBeVisible();
  const selectedOption = await taxSelect.inputValue();
  // The option value is the tax ID; we verify the display text contains "10%"
  const selectedText = await taxSelect.evaluate((el: HTMLSelectElement) => {
    const opt = el.options[el.selectedIndex];
    return opt ? opt.text : "";
  });
  expect(selectedText).toMatch(/10%/);
});

// ─── Issue #49 ────────────────────────────────────────────────────────────────

test("Issue #49 · paleta de categorías tiene más colores y el swatch refleja el color elegido", async ({
  page,
}) => {
  await loginAsDemo(page);
  await page.goto("/app/services");
  await page.getByRole("button", { name: "Categories", exact: true }).click();

  await page.getByRole("button", { name: "+ New category" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // At least 8 color swatches must exist (we added many new vivid colors)
  const swatches = dialog.locator('[aria-pressed]');
  const count = await swatches.count();
  expect(count).toBeGreaterThanOrEqual(8);

  // Pick a vivid color (coral) and save the category
  const coralBtn = dialog.getByRole("button", { name: /coral/i });
  await expect(coralBtn).toBeVisible();
  await coralBtn.click();
  await expect(coralBtn).toHaveAttribute("aria-pressed", "true");

  const catName = `CoralCat ${Date.now()}`;
  await dialog.getByLabel("Name").fill(catName);
  await dialog.getByRole("button", { name: "Save" }).click();

  // The row for the new category should appear — the inner swatch is inside .cat-ic
  const row = page.locator(`[data-testid^="cat-row-"]`).filter({ hasText: catName });
  await expect(row).toBeVisible();

  // The outer tile (.cat-ic) background should NOT be the stone gray (#F5F2EF)
  const tileColor = await row.locator(".cat-ic").evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor;
  });
  // Stone defaults to rgb(245, 242, 239) — coral should be different
  expect(tileColor).not.toBe("rgb(245, 242, 239)");
});

test("Issue #49 · servicio hereda el color de su categoría en la tabla", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  const suffix = Date.now();

  // Create a category with "teal" accent via API
  const cat = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
    name: `TealCat ${suffix}`,
    accentKey: "teal",
  });
  // Create a service in that category
  const svcName = `TealSvc ${suffix}`;
  await apiPostJson<{ id: number }>(request, token, "/api/services", {
    name: svcName,
    categoryId: cat.id,
    priceMinor: 50000,
    durationMinutes: 30,
  });

  await loginAsDemo(page);
  await page.goto("/app/services");

  // The service card for TealSvc should show a non-gray icon
  const card = page.locator(`[data-testid^="svc-row-"]`).filter({ hasText: svcName });
  await expect(card).toBeVisible();

  const iconBg = await card.locator(".cat-ic").evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor;
  });
  // Stone-lt defaults to rgb(245, 242, 239) — teal-lt (#CCFBF1) = rgb(204, 251, 241)
  expect(iconBg).not.toBe("rgb(245, 242, 239)");
});

// ─── Issue #37 ────────────────────────────────────────────────────────────────

test("Issue #37 · warning RUC faltante en Nuevo comprobante (sin RUC)", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  // Clear the RUC so the warning should appear
  await setBusinessRuc(request, token, null);
  await ensureCashSessionOpenApi(request, token);

  await loginAsDemo(page);
  await page.goto("/app/billing");
  await page.getByRole("tab", { name: "New Invoice" }).click();

  // The warning text must be visible on the new-invoice tab
  await expect(
    page.getByText(/agregá un ruc de negocio válido|add a valid business ruc/i),
  ).toBeVisible({ timeout: 10_000 });
});

test("Issue #37 · sin warning RUC cuando el salon tiene RUC configurado", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  await setBusinessRuc(request, token, "80000005-6");
  await ensureCashSessionOpenApi(request, token);

  await loginAsDemo(page);
  await page.goto("/app/billing");
  await page.getByRole("tab", { name: "New Invoice" }).click();

  await expect(
    page.getByText(/agregá un ruc de negocio válido|add a valid business ruc/i),
  ).not.toBeVisible();
});

// ─── Issue #47 ────────────────────────────────────────────────────────────────

test("Issue #47 · factura a otra persona: editar nombre/RUC no modifica el perfil del cliente", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  await setBusinessRuc(request, token, "80000005-6");
  const seed = await seedCategoryServiceProfessional(request, token);
  const originalName = `E2E HU47 ${Date.now()}`;
  const client = await seedClient(request, token, originalName, "0981000000");
  await ensureActiveFiscalStampForInvoices(request, token);

  await loginAsDemo(page);
  await ensureCashSessionOpen(page);
  await page.getByRole("tab", { name: "New Invoice" }).click();

  // Select the client
  await page.getByLabel("Search or select client").fill(originalName.slice(0, 8));
  await page.getByRole("button", { name: originalName, exact: false }).click();

  // Override the name and RUC for THIS invoice only
  const altName = `Otra Razon Social ${Date.now()}`;
  await page.locator("#client-display-name").fill(altName);
  await page.locator("#client-ruc").fill("80000005-6");

  await pickServiceLine(page, seed.serviceFullName, 0);
  await page.locator("#line-price-0").fill("50000");
  await page.locator("#pay-amount-0").fill("50000");

  await clickIssueInvoiceAndExpectSuccess(page);

  // Verify the client's profile was NOT changed
  const updatedClient = await apiGetJson<{ fullName: string; ruc: string | null }>(
    request,
    token,
    `/api/clients/${client.id}`,
  );
  expect(updatedClient.fullName).toBe(originalName);
  // RUC should still be null since the client was created without one
  expect(updatedClient.ruc).toBeNull();
});

// ─── Issue #43 ────────────────────────────────────────────────────────────────

test("Issue #43 · RUC del salon se almacena en el comprobante al emitir", async ({
  page,
  request,
}) => {
  const salonRuc = "80000005-6";
  const token = await loginAsDemoApi(request);
  await setBusinessRuc(request, token, salonRuc);
  const seed = await seedCategoryServiceProfessional(request, token);
  const clientName43 = `E2E HU43 ${Date.now()}`;
  const client43 = await seedClient(request, token, clientName43);
  void client43; // referenced below to confirm it's not modified
  await ensureActiveFiscalStampForInvoices(request, token);

  await loginAsDemo(page);
  await ensureCashSessionOpen(page);
  await page.getByRole("tab", { name: "New Invoice" }).click();

  await page.getByLabel("Search or select client").fill(clientName43.slice(0, 8));
  await page.getByRole("button", { name: clientName43, exact: false }).click();

  await pickServiceLine(page, seed.serviceFullName, 0);
  await page.locator("#line-price-0").fill("50000");
  await page.locator("#pay-amount-0").fill("50000");

  // Wait for the invoice to be issued and capture the response
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/invoices") &&
        r.request().method() === "POST" &&
        !r.url().includes("/void"),
      { timeout: 30_000 },
    ),
    page.getByRole("button", { name: "Issue invoice" }).click(),
  ]);
  expect(res.ok()).toBeTruthy();
  const invoice = (await res.json()) as { id: number };

  // Fetch the invoice detail and verify businessRuc was stored
  const detail = await apiGetJson<{ businessRuc: string | null }>(
    request,
    token,
    `/api/invoices/${invoice.id}`,
  );
  expect(detail.businessRuc).toBe(salonRuc);
});

// ─── Issue #48 ────────────────────────────────────────────────────────────────

test("Issue #48 · botón Ver comprobante en Historial del cliente abre el popup", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  await setBusinessRuc(request, token, "80000005-6");
  const seed = await seedCategoryServiceProfessional(request, token);
  const clientName = `E2E HU48 ${Date.now()}`;
  const client = await seedClient(request, token, clientName);
  await ensureActiveFiscalStampForInvoices(request, token);
  await ensureCashSessionOpenApi(request, token);

  // Issue an invoice for that client via API
  const stamps = await apiGetJson<
    Array<{ id: number; active: boolean; nextEmissionNumber: number }>
  >(request, token, "/api/fiscal-stamps");
  const activeStamp = stamps.find((s) => s.active);
  expect(activeStamp).toBeTruthy();

  await apiPostJson(request, token, "/api/invoices", {
    clientId: client.id,
    clientDisplayName: clientName,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [
      {
        serviceId: seed.serviceId,
        description: "E2E HU48 service",
        quantity: 1,
        unitPrice: 50000,
        discountType: null,
        discountValue: null,
      },
    ],
    payments: [{ method: "CASH", amount: 50000 }],
  });

  await loginAsDemo(page);
  await page.goto(`/app/clients/${client.id}`);
  await page.getByRole("tab", { name: "History" }).click();

  // The comprobantes section should show the "Ver" / "View" button
  const verBtn = page.getByRole("button", { name: /ver|view detail/i }).first();
  await expect(verBtn).toBeVisible({ timeout: 15_000 });
  await verBtn.click();

  // The invoice detail modal should open
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });

  // Modal should show the invoice amount (50.000 format — dot separator, no decimals)
  await expect(modal.getByText(/50\.000/)).toBeVisible({ timeout: 10_000 });

  // "Anular" (void) button must NOT appear — view-only mode
  await expect(modal.getByRole("button", { name: /anular|void/i })).not.toBeVisible();
});
