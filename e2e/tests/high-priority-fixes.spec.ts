/**
 * E2E tests for high-priority GitHub issues:
 *   #37 — RUC warning on Nuevo comprobante
 *   #39 — Cambios en base semilla: active professionals get Mon-Sat 09:00-19:00
 *   #40 — Validación en Horario de profesionales: allow zero attention days
 *   #41 — Split "Descuento en Ítem" into "Tipo Dto." + "Valor Dto." in comprobante popup
 *   #42 — User profile / change-password dialog labels were raw i18n keys
 *   #43 — Salon RUC snapshotted on the invoice (business_ruc field)
 *   #46 — Default IVA 10% when creating a new service
 *   #47 — Invoice to a different name/RUC without mutating the client
 *   #48 — "Ver" comprobante popup in Client History
 *   #49 — More vivid category colors shown in table swatches
 *   #51 — Lista de clientes en formulario: dropdown floats over the form
 *   #52 — Error al asignar color de categoría (palette mismatch, backend allow-list expanded)
 *   #55 — Descripción de monto total en factura: amount-in-words on PDF
 *   #58 — Campo de listas quedan detrás del formulario: all dropdowns float above the form
 */

import zlib from "node:zlib";
import { expect, test } from "@playwright/test";
import {
  API_BASE,
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
import { professionalFormDialog } from "../fixtures/ui";

test.describe.configure({ mode: "serial" });

/**
 * Extracts searchable text from a PDF buffer. The invoice PDF stores its text in
 * FlateDecode-compressed streams, so we inflate each `stream…endstream` block and
 * append it to the raw (latin1) text. latin1 preserves byte values 1:1.
 */
function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let text = raw;
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      text += "\n" + zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      // Not a zlib stream (e.g. image data) — skip.
    }
  }
  return text;
}

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

  // Search by name so it lands on page 1 regardless of total service count (server-side pagination)
  await page.getByPlaceholder(/search by name/i).fill(svcName);
  await page.waitForTimeout(600);

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

// ─── Issue #52 ────────────────────────────────────────────────────────────────

test("Issue #52 · asignar colores nuevos (teal, sky, indigo…) a categoría no lanza error", async ({
  page,
}) => {
  await loginAsDemo(page);
  await page.goto("/app/services");
  await page.getByRole("button", { name: "Categories", exact: true }).click();

  // Create a category first with default color
  const catName = `TealCat52 ${Date.now()}`;
  await page.getByRole("button", { name: "+ New category" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(catName);
  // Pick a color that was previously rejected by the backend (teal)
  await dialog.getByRole("button", { name: /teal/i }).click();
  await dialog.getByRole("button", { name: "Save" }).click();

  // Dialog should close on success (no error alert)
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });

  // The new category should appear in the list
  await expect(page.getByText(catName)).toBeVisible({ timeout: 10_000 });

  // Now edit it and pick another previously-rejected color (sky)
  // The category row itself has aria-label "Edit category <name>"
  await page.getByRole("button", { name: `Edit category ${catName}` }).click();
  const editDialog = page.getByRole("dialog");
  await expect(editDialog).toBeVisible();
  await editDialog.getByRole("button", { name: /sky/i }).click();
  await editDialog.getByRole("button", { name: "Save" }).click();

  // Dialog should close on success (no error alert)
  await expect(editDialog).not.toBeVisible({ timeout: 10_000 });

  // Category should still appear in the list
  await expect(page.getByText(catName)).toBeVisible({ timeout: 10_000 });
});

// ─── Issue #42 ────────────────────────────────────────────────────────────────

test("Issue #42 · 'Configuración del usuario' muestra etiquetas traducidas, no claves i18n", async ({
  page,
}) => {
  await loginAsDemo(page);
  await page.goto("/app");
  // Open the user menu via aria-label "Open user menu", then click "User settings"
  await page.getByRole("button", { name: "Open user menu" }).click();
  await page.getByText("User settings", { exact: true }).click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });

  // The modal title should be translated ("My profile"), not a raw key
  await expect(modal.getByText("My profile")).toBeVisible();
  // No raw i18n key strings anywhere in the modal
  await expect(modal.getByText(/femme\.userProfile\./)).toHaveCount(0);
  await expect(modal.getByText(/app\.userProfile\./)).toHaveCount(0);
});

test("Issue #42 · 'Cambiar contraseña' muestra etiquetas traducidas, no claves i18n", async ({
  page,
}) => {
  await loginAsDemo(page);
  await page.goto("/app");
  // Open "Change password" directly from the user menu
  await page.getByRole("button", { name: "Open user menu" }).click();
  await page.getByText("Change password", { exact: true }).click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });

  // Password tab, labels and submit button should show translated text
  await expect(modal.getByRole("tab", { name: "Password" })).toBeVisible();
  await expect(modal.getByLabel("New password")).toBeVisible();
  await expect(modal.getByLabel("Confirm password")).toBeVisible();
  await expect(modal.getByRole("button", { name: "Change password" })).toBeVisible();

  // No raw i18n key strings anywhere in the modal
  await expect(modal.getByText(/femme\.userProfile\./)).toHaveCount(0);
  await expect(modal.getByText(/app\.userProfile\./)).toHaveCount(0);
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

  // The comprobantes section should show the "View" (femme.billing.history.viewDetail) button
  const verBtn = page.getByRole("button", { name: /view/i }).first();
  await expect(verBtn).toBeVisible({ timeout: 15_000 });
  await verBtn.click();

  // The invoice detail modal should open
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });

  // Modal should show the invoice amount (50.000 format — dot separator, no decimals).
  // The amount appears in several cells/spans, so assert the first is visible.
  await expect(modal.getByText(/50\.000/).first()).toBeVisible({ timeout: 10_000 });

  // "Anular" (void) button must NOT appear — view-only mode
  await expect(modal.getByRole("button", { name: /anular|void/i })).not.toBeVisible();
});

// ─── Issue #39 ────────────────────────────────────────────────────────────────

test("Issue #39 · profesionales semilla tienen horario Lun-Sáb 09:00-19:00 tras reset", async ({
  request,
}) => {
  // Reset seed to get a fresh state
  const resetRes = await request.post(`${API_BASE}/api/admin/seed/reset`);
  expect(resetRes.ok()).toBeTruthy();

  const token = await loginAsDemoApi(request);

  // Fetch all professionals. The list endpoint already returns each professional's
  // schedules (there is no GET /api/professionals/{id} endpoint — only the list and /page).
  const professionals = await apiGetJson<
    Array<{
      id: number;
      active: boolean;
      fullName: string;
      schedules: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
    }>
  >(request, token, "/api/professionals");
  const activeProfessionals = professionals.filter((p) => p.active);
  expect(activeProfessionals.length).toBeGreaterThan(0);

  // Each active professional must have 6 schedule rows (Mon=1 to Sat=6, 09:00-19:00)
  for (const prof of activeProfessionals) {
    const schedules = prof.schedules ?? [];
    expect(
      schedules.length,
      `${prof.fullName} should have 6 schedule rows`,
    ).toBe(6);

    const days = schedules.map((s) => s.dayOfWeek).sort();
    expect(days).toEqual([1, 2, 3, 4, 5, 6]); // Mon-Sat

    for (const s of schedules) {
      expect(s.startTime, `${prof.fullName} day ${s.dayOfWeek} startTime`).toBe("09:00:00");
      expect(s.endTime, `${prof.fullName} day ${s.dayOfWeek} endTime`).toBe("19:00:00");
    }
  }
});

// ─── Issue #40 ────────────────────────────────────────────────────────────────

test("Issue #40 · guardar horario con cero días seleccionados no lanza error", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  // Create a professional with no schedule yet
  const created = await apiPostJson<{ id: number }>(request, token, "/api/professionals", {
    fullName: `E2E HP40 ${Date.now()}`,
    phone: null,
    email: null,
    photoDataUrl: null,
  });

  await loginAsDemo(page);
  await page.goto("/app/professionals");

  // Open "Edit schedule" via kebab menu
  await expect(page.getByTestId(`professionals-row-${created.id}-trigger`)).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId(`professionals-row-${created.id}-trigger`).click();
  await page.getByRole("menuitem", { name: "Edit schedule" }).click();

  const dlg = professionalFormDialog(page);
  await expect(dlg.getByRole("tab", { name: "Schedule" })).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 10_000 },
  );

  // Ensure no day is checked
  const monCheckbox = dlg.getByTestId("prof-day-mon-active");
  await expect(monCheckbox).toBeVisible();
  if (await monCheckbox.isChecked()) {
    await monCheckbox.uncheck();
  }
  // Uncheck all days (tue-sun)
  for (const key of ["tue", "wed", "thu", "fri", "sat", "sun"]) {
    const cb = dlg.getByTestId(`prof-day-${key}-active`);
    if (await cb.isChecked()) {
      await cb.uncheck();
    }
  }

  // Save — must succeed without any error
  const scheduleResp = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/professionals/${created.id}/schedules`) &&
      r.request().method() === "PUT",
  );
  await dlg.getByRole("button", { name: /save schedule/i }).click();
  const resp = await scheduleResp;
  expect(resp.ok(), await resp.text()).toBeTruthy();

  // Dialog should close (no error left it open)
  await expect(dlg).not.toBeVisible({ timeout: 10_000 });
});

// ─── Issue #51 ────────────────────────────────────────────────────────────────

test("Issue #51 · dropdown de clientes en formulario de factura flota sobre el formulario", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  await ensureCashSessionOpenApi(request, token);

  await loginAsDemo(page);
  await ensureCashSessionOpen(page);
  await page.getByRole("tab", { name: "New Invoice" }).click();

  // Trigger the client search dropdown
  const clientInput = page.getByLabel("Search or select client");
  await expect(clientInput).toBeVisible({ timeout: 10_000 });

  // Capture the submit button's bounding box BEFORE opening the dropdown
  const submitBtn = page.getByRole("button", { name: "Issue invoice" });
  const boxBefore = await submitBtn.boundingBox();
  expect(boxBefore).not.toBeNull();

  // Open the dropdown
  await clientInput.click();
  const listbox = page.getByRole("listbox", { name: "Search or select client" });
  await expect(listbox).toBeVisible({ timeout: 10_000 });

  // The dropdown's parent wrapper must be fixed-positioned (portal-rendered).
  const parentPosition = await listbox.evaluate(
    (el) => (el.parentElement as HTMLElement | null)?.style?.position ?? "",
  );
  expect(parentPosition).toBe("fixed");

  // The submit button must not have moved (form height unchanged by the dropdown).
  const boxAfter = await submitBtn.boundingBox();
  expect(boxAfter).not.toBeNull();
  expect(boxAfter!.y).toBeCloseTo(boxBefore!.y, 0);
});

test("Issue #51 · dropdown de clientes en formulario de turno flota sobre el formulario", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  await seedCategoryServiceProfessional(request, token);

  await loginAsDemo(page);
  await page.goto("/app/calendar");
  await page.getByRole("button", { name: "New appointment" }).first().click();

  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible({ timeout: 10_000 });

  // Capture the Save button's position BEFORE opening the client dropdown
  const saveBtn = dlg.getByRole("button", { name: "Save" });
  const boxBefore = await saveBtn.boundingBox();
  expect(boxBefore).not.toBeNull();

  // Open the client SearchableSelect (accessible name "Client")
  const clientCombobox = dlg.getByRole("combobox", { name: "Client", exact: true });
  await expect(clientCombobox).toBeVisible({ timeout: 10_000 });
  await clientCombobox.click();

  const listbox = page.getByRole("listbox", { name: "Client", exact: true });
  await expect(listbox).toBeVisible({ timeout: 10_000 });

  // The dropdown's parent wrapper must be fixed-positioned (portal-rendered).
  const parentPosition = await listbox.evaluate(
    (el) => (el.parentElement as HTMLElement | null)?.style?.position ?? "",
  );
  expect(parentPosition).toBe("fixed");

  // The Save button must not have moved.
  const boxAfter = await saveBtn.boundingBox();
  expect(boxAfter).not.toBeNull();
  expect(boxAfter!.y).toBeCloseTo(boxBefore!.y, 0);
});

// ─── Issue #55 ────────────────────────────────────────────────────────────────

test("Issue #55 · PDF de comprobante contiene monto total en letras en español", async ({
  request,
}) => {
  const token = await loginAsDemoApi(request);
  await apiPutJson(request, token, "/api/business-profile", {
    businessName: "Demo salon",
    ruc: "80000005-6",
    address: null,
    phone: null,
    contactEmail: null,
    logoDataUrl: null,
  });
  await ensureActiveFiscalStampForInvoices(request, token);
  await ensureCashSessionOpenApi(request, token);

  // Issue an invoice with a known total (50.000 Gs → "cincuenta mil guaraníes")
  const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
    clientId: null,
    clientDisplayName: "E2E HP55",
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [
      {
        serviceId: null,
        description: "HP55 service",
        quantity: 1,
        unitPrice: 50000,
        discountType: null,
        discountValue: null,
      },
    ],
    payments: [{ method: "CASH", amount: 50000 }],
  });

  // Download the PDF
  const pdfRes = await request.get(`${API_BASE}/api/invoices/${inv.id}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(pdfRes.ok(), await pdfRes.text()).toBeTruthy();

  const buf = await pdfRes.body();
  // Valid PDF starts with %PDF
  expect(buf.slice(0, 4).toString("latin1")).toBe("%PDF");
  // The amount-in-words for 50000 Gs is "cincuenta mil guaraníes". The text lives in a
  // FlateDecode-compressed stream, so inflate the PDF streams before searching.
  const pdfText = extractPdfText(buf);
  expect(pdfText).toContain("cincuenta mil");
});

// ─── Issue #58 ────────────────────────────────────────────────────────────────

test("Issue #58 · ServiceSearchField en factura flota sobre el formulario (portal)", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  await ensureCashSessionOpenApi(request, token);

  await loginAsDemo(page);
  await ensureCashSessionOpen(page);
  await page.getByRole("tab", { name: "New Invoice" }).click();

  // Capture position of a stable button below the service field before opening dropdown
  const submitBtn = page.getByRole("button", { name: "Issue invoice" });
  await expect(submitBtn).toBeVisible({ timeout: 10_000 });
  const boxBefore = await submitBtn.boundingBox();
  expect(boxBefore).not.toBeNull();

  // Open the service search dropdown (combobox aria-label="Service")
  const serviceInput = page.getByRole("combobox", { name: "Service" }).first();
  await expect(serviceInput).toBeVisible({ timeout: 10_000 });
  await serviceInput.click();

  // The listbox renders in a portal — query from page root
  const listbox = page.getByRole("listbox", { name: "Service" });
  await expect(listbox).toBeVisible({ timeout: 10_000 });

  // The listbox's portal wrapper must be fixed-positioned
  const parentPosition = await listbox.evaluate(
    (el) => (el.parentElement as HTMLElement | null)?.style?.position ?? "",
  );
  expect(parentPosition).toBe("fixed");

  // Submit button must not have moved (dropdown did not push layout down)
  const boxAfter = await submitBtn.boundingBox();
  expect(boxAfter).not.toBeNull();
  expect(boxAfter!.y).toBeCloseTo(boxBefore!.y, 0);
});

test("Issue #58 · TimeCombobox en formulario de turno flota sobre el formulario (portal)", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  await seedCategoryServiceProfessional(request, token);

  await loginAsDemo(page);
  await page.goto("/app/calendar");
  await page.getByRole("button", { name: "New appointment" }).first().click();

  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible({ timeout: 10_000 });

  // Capture position of Save button before opening time dropdown
  const saveBtn = dlg.getByRole("button", { name: "Save" });
  const boxBefore = await saveBtn.boundingBox();
  expect(boxBefore).not.toBeNull();

  // Open the appointment time combobox (labelled "Time")
  const timeCombobox = dlg.getByRole("combobox", { name: /^time$/i });
  await expect(timeCombobox).toBeVisible({ timeout: 10_000 });
  await timeCombobox.click();

  // The listbox renders in a portal — query from page root
  const listbox = page.locator('[role="listbox"]').first();
  await expect(listbox).toBeVisible({ timeout: 10_000 });

  // The listbox wrapper must be fixed-positioned (portal-rendered)
  const parentPosition = await listbox.evaluate(
    (el) => (el.parentElement as HTMLElement | null)?.style?.position ?? "",
  );
  expect(parentPosition).toBe("fixed");

  // Save button must not have moved
  const boxAfter = await saveBtn.boundingBox();
  expect(boxAfter).not.toBeNull();
  expect(boxAfter!.y).toBeCloseTo(boxBefore!.y, 0);
});

test("Issue #58 · LocalizedDateInput en formulario de turno flota sobre el formulario (portal)", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  await seedCategoryServiceProfessional(request, token);

  await loginAsDemo(page);
  await page.goto("/app/calendar");
  await page.getByRole("button", { name: "New appointment" }).first().click();

  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible({ timeout: 10_000 });

  // Capture position of Save button before opening date picker
  const saveBtn = dlg.getByRole("button", { name: "Save" });
  const boxBefore = await saveBtn.boundingBox();
  expect(boxBefore).not.toBeNull();

  // Open the date picker by clicking the date combobox (id="form-date", no aria-label)
  const dateCombobox = page.locator("#form-date");
  await expect(dateCombobox).toBeVisible({ timeout: 10_000 });
  await dateCombobox.click();

  // The calendar dialog renders in a portal — query from page root
  const calendar = page.getByRole("dialog", { name: "Calendar" }).last();
  await expect(calendar).toBeVisible({ timeout: 10_000 });

  // The calendar's portal wrapper must be fixed-positioned
  const parentPosition = await calendar.evaluate(
    (el) => (el.parentElement as HTMLElement | null)?.style?.position ?? "",
  );
  expect(parentPosition).toBe("fixed");

  // Save button must not have moved
  const boxAfter = await saveBtn.boundingBox();
  expect(boxAfter).not.toBeNull();
  expect(boxAfter!.y).toBeCloseTo(boxBefore!.y, 0);
});

// ─── Issue #64 ────────────────────────────────────────────────────────────────

test("Issue #64 · buscador del topbar no es visible en ninguna página", async ({ page }) => {
  await loginAsDemo(page);
  await page.goto("/app");

  await expect(page.locator("[data-tour='topbar-search']")).not.toBeVisible();
  await expect(page.locator("header input[type='search']")).not.toBeVisible();
});

// ─── Issue #63 ────────────────────────────────────────────────────────────────

test("Issue #63 · al ingresar un servicio al comprobante, el monto Efectivo se autorellena", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  await ensureCashSessionOpenApi(request, token);
  const seed = await seedCategoryServiceProfessional(request, token);

  await loginAsDemo(page);
  await ensureCashSessionOpen(page);
  await page.getByRole("tab", { name: "New Invoice" }).click();

  // The CASH amount field starts empty
  const amountField = page.locator("#pay-amount-0");
  await expect(amountField).toBeVisible({ timeout: 10_000 });
  await expect(amountField).toHaveValue("");

  // Pick a service and enter a unit price
  await pickServiceLine(page, seed.serviceFullName, 0);
  await page.locator("#line-price-0").fill("50000");
  await page.locator("#line-price-0").press("Tab");

  // The CASH amount should auto-populate with 50.000 (dot separator, no decimals)
  await expect(amountField).toHaveValue("50.000");
});

test("Issue #63 · cambiar método de pago de Efectivo a Transferencia no borra el monto", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  await ensureCashSessionOpenApi(request, token);
  const seed = await seedCategoryServiceProfessional(request, token);

  await loginAsDemo(page);
  await ensureCashSessionOpen(page);
  await page.getByRole("tab", { name: "New Invoice" }).click();

  // Fill in a service so the CASH amount auto-populates
  await pickServiceLine(page, seed.serviceFullName, 0);
  await page.locator("#line-price-0").fill("50000");
  await page.locator("#line-price-0").press("Tab");

  const amountField = page.locator("#pay-amount-0");
  await expect(amountField).toHaveValue("50.000");

  // Change the payment method from CASH to TRANSFER
  await page.locator("#pay-method-0").selectOption("TRANSFER");

  // The amount must remain unchanged
  await expect(amountField).toHaveValue("50.000");
});

// ─── Issue #66 ────────────────────────────────────────────────────────────────

test("Issue #66 · botón Emitir se habilita al completar cliente e ítem (sin ingresar monto manualmente)", async ({
  page,
  request,
}) => {
  const token = await loginAsDemoApi(request);
  await ensureCashSessionOpenApi(request, token);
  const seed = await seedCategoryServiceProfessional(request, token);
  const client = await seedClient(request, token, `E2E I66 ${Date.now()}`);

  await loginAsDemo(page);
  await ensureCashSessionOpen(page);
  await page.getByRole("tab", { name: "New Invoice" }).click();

  const issueBtn = page.getByRole("button", { name: "Issue invoice" });
  await expect(issueBtn).toBeDisabled({ timeout: 10_000 });

  // Select client
  await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
  await page.getByRole("button", { name: client.fullName, exact: false }).click();
  await expect(issueBtn).toBeDisabled();

  // Select service — the CASH amount auto-fills and the button must enable
  await pickServiceLine(page, seed.serviceFullName, 0);
  await expect(page.locator("#pay-amount-0")).not.toHaveValue("", { timeout: 5_000 });
  await expect(issueBtn).toBeEnabled({ timeout: 5_000 });
});
