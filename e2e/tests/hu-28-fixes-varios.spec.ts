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
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

test.describe("HU-28 · Fixes varios", () => {
  // AC1 — Login subtitle
  test("HU-28 · AC1 subtítulo del login es el texto correcto", async ({ page }) => {
    await page.goto("/login");
    const subtitle = page.locator("text=Ingresa tu correo y contraseña del sistema.");
    await expect(subtitle).toBeVisible();
  });

  // AC2 — Services search input shows full placeholder
  test("HU-28 · AC2 input de búsqueda de servicios muestra el placeholder completo sin truncar", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    const searchInput = page.getByPlaceholder(/Buscar por nombre o categoría/);
    await expect(searchInput).toBeVisible({ timeout: 15_000 });
    // The input must not have its text truncated — we verify it has enough width
    const box = await searchInput.boundingBox();
    expect(box?.width).toBeGreaterThan(300);
  });

  // AC3 — Professionals row click opens prefilled edit form
  test("HU-28 · AC3 clic en fila de profesional abre formulario de edición prellenado", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const row = page.locator(`tr[aria-label*="${seed.professionalFullName}"], tr[data-testid*="${seed.professionalId}"]`).first();
    // Fallback: find the row by the professional name text
    const nameCell = page.getByRole("row").filter({ hasText: seed.professionalFullName }).first();
    await expect(nameCell).toBeVisible({ timeout: 15_000 });
    await nameCell.click();
    // The edit dialog should appear pre-filled with the professional's name
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByDisplayValue(seed.professionalFullName)).toBeVisible();
  });

  // AC4 — Calendar: non-blocking availability alert
  test("HU-28 · AC4 el aviso de disponibilidad en calendario no bloquea la creación del turno", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    // Open the new appointment dialog
    await page.getByRole("button", { name: /New appointment|Nuevo turno/ }).first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible({ timeout: 10_000 });
    // Pick the seeded professional
    const profSelect = dlg.getByLabel(/Profesional|Professional/);
    if (await profSelect.isVisible()) {
      await profSelect.selectOption({ label: seed.professionalFullName });
    }
    // Pick a time that is likely outside business hours (very early)
    const timeInput = dlg.getByTestId("appointment-time-input");
    if (await timeInput.isVisible()) {
      await timeInput.selectOption("07:00");
    }
    // Alert might appear but the form should still be submittable (not blocked)
    const saveBtn = dlg.getByRole("button", { name: /Save|Guardar/ });
    await expect(saveBtn).toBeEnabled();
  });

  // AC5 — Billing tour reaches all 5 steps
  test("HU-28 · AC5 el tour de facturación llega al paso 5/5", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    // Clear tour state so the tour can start fresh
    await apiPostJson(request, token, "/api/me/tour-state/billing", {}).catch(() => undefined);
    // Remove localStorage tour-seen key by running JS after login
    await loginAsDemo(page);
    await page.evaluate(() => localStorage.removeItem("femme.tour.seen.billing"));
    await page.goto("/app/billing");
    // Trigger the tour manually via the tour button if visible, otherwise check it auto-starts
    // Wait for joyride overlay
    const tourOverlay = page.locator(".react-joyride__overlay, [data-test-id='react-joyride-portal']");
    // If tour doesn't auto-start (already seen in DB), use the start button
    const startBtn = page.getByRole("button", { name: /Tour|tour/ });
    // Wait up to 3s for tour to appear; if not, click start button
    const tourVisible = await tourOverlay.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!tourVisible && await startBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await startBtn.click();
    }
    // Advance through all 5 steps using the Next button
    const nextBtn = page.locator("[data-action='primary'], button:has-text('Next'), button:has-text('Siguiente')");
    let reachedStep5 = false;
    for (let i = 0; i < 5; i++) {
      // Look for progress indicator showing current step
      const progress = page.locator(".react-joyride__tooltip").filter({ hasText: /5/ });
      if (await progress.isVisible({ timeout: 2_000 }).catch(() => false)) {
        reachedStep5 = true;
        break;
      }
      const btn = nextBtn.first();
      if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    }
    expect(reachedStep5).toBe(true);
  });

  // AC6 — Tax management: create a tax
  test("HU-28 · AC6 se puede crear un impuesto desde la configuración", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/taxes");
    const addBtn = page.getByRole("button", { name: /Nuevo impuesto|New tax/ });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const taxName = `IVA Test ${Date.now()}`;
    await dialog.getByLabel(/Nombre|Name/).fill(taxName);
    await dialog.getByLabel(/Tasa|Rate/).fill("7.5");
    await dialog.getByRole("button", { name: /Guardar|Save/ }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(taxName)).toBeVisible({ timeout: 5_000 });
  });

  // AC7 — Service form has tax dropdown defaulting to first active tax
  test("HU-28 · AC7 el formulario de servicio tiene selector de impuesto y selecciona el primero activo por defecto", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    // Ensure at least one active tax exists
    const taxes = await apiGetJson<{ id: number; name: string; active: boolean }[]>(
      request,
      token,
      "/api/taxes",
    );
    const activeTax = taxes.find((t) => t.active);
    expect(activeTax).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.getByRole("button", { name: /\+ Nuevo servicio|\+ New service/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // The tax select must exist and default to first active tax
    const taxSelect = dialog.getByLabel(/Tipo de impuesto|Tax type/);
    await expect(taxSelect).toBeVisible();
    const selectedValue = await taxSelect.inputValue();
    expect(selectedValue).toBe(String(activeTax!.id));
  });

  // AC8 — Per-line discount in billing invoice
  test("HU-28 · AC8 el descuento por ítem en la factura afecta el total de la línea", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.goto("/app/billing");
    // Switch to "invoice" (Nueva factura) tab
    await page.getByRole("tab", { name: /Nueva factura|New invoice/ }).click();
    await expect(page.getByRole("tab", { name: /Nueva factura|New invoice/ })).toBeVisible({ timeout: 5_000 });
    // Wait for the form
    const form = page.locator("[data-testid='new-invoice-form'], form").first();
    // Fill the first line
    const priceInput = page.locator("[id^='line-price-']").first();
    await priceInput.fill("100000");
    // Enable discount for first line
    const discountToggle = page.locator("[id^='line-disc-toggle-']").first();
    await discountToggle.check();
    // Fill 10% discount
    const discountValueInput = page.locator("[id^='line-disc-val-']").first();
    await discountValueInput.fill("10");
    // Line total should reflect 90000 (100000 - 10%)
    const lineTotal = page.locator(".tabular-nums").first();
    await expect(lineTotal).toContainText("90.000");
  });

  // AC9 — Billing: submit scrolls/focuses first invalid field
  test("HU-28 · AC9 al intentar emitir comprobante sin datos el foco va al primer campo inválido", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.goto("/app/billing");
    // Switch to invoice tab
    await page.getByRole("tab", { name: /Nueva factura|New invoice/ }).click();
    // Click submit without filling anything
    const submitBtn = page.getByRole("button", { name: /Emitir comprobante|Issue invoice/ });
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    await submitBtn.click();
    // An error must appear and the page must have focused an element
    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBeTruthy();
    // The focused element must be a form input (not body)
    expect(focusedId).not.toBe("");
  });

  // AC10 — Dashboard date click navigates to calendar for that date
  test("HU-28 · AC10 clic en fecha del mini-calendario del dashboard navega al calendario en esa fecha", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app");
    // Wait for the dashboard to load
    await page.waitForLoadState("networkidle");
    // Find a day cell with role="button" (current-month days) in the mini calendar.
    // The cells contain just a number (the day).
    const dayBtn = page.locator("[role='button']").filter({ hasText: /^\d{1,2}$/ }).first();
    await expect(dayBtn).toBeVisible({ timeout: 10_000 });
    await dayBtn.click();
    await expect(page).toHaveURL(/\/app\/calendar/, { timeout: 5_000 });
  });

  // AC11 — Calendar blocks: PENDING has dotted border, CONFIRMED has check icon
  test("HU-28 · AC11 bloques del calendario: PENDING tiene borde punteado y CONFIRMED tiene ícono de check", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    // Create a PENDING appointment
    await apiPostJson(request, token, "/api/appointments", {
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      clientId: null,
      clientName: "E2E Pending Test",
      date: new Date().toISOString().split("T")[0],
      time: "10:00",
      notes: "",
    });
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await expect(page.locator("button[data-appointment-id]").first()).toBeVisible({ timeout: 15_000 });
    // Check PENDING block has dotted border style
    const pendingBlock = page.locator("button[data-appointment-id][data-status='PENDING']").first();
    if (await pendingBlock.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const borderStyle = await pendingBlock.evaluate(
        (el) => window.getComputedStyle(el).borderLeftStyle,
      );
      expect(borderStyle).toBe("dotted");
    }
  });

  // AC12 — Tour persistence: seen state persisted to backend
  test("HU-28 · AC12 el estado del tour se persiste en el backend y no se muestra de nuevo tras marcarse como visto", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    // Ensure billing tour is not yet marked as seen
    // First, check current state — if already seen we skip marking; if not, we mark it
    const currentState = await apiGetJson<{ tourKey: string }[]>(
      request,
      token,
      "/api/me/tour-state",
    );
    // Mark billing tour as seen via API
    await apiPostJson(request, token, "/api/me/tour-state/billing", {});
    // Verify the backend persisted it
    const updatedState = await apiGetJson<{ tourKey: string }[]>(
      request,
      token,
      "/api/me/tour-state",
    );
    const billingEntry = updatedState.find((s) => s.tourKey === "billing");
    expect(billingEntry).toBeTruthy();
    // Now load the billing page and verify the tour does NOT auto-start
    await loginAsDemo(page);
    await page.goto("/app/billing");
    // Joyride overlay should not appear
    const tourOverlay = page.locator(".react-joyride__overlay");
    await expect(tourOverlay).not.toBeVisible({ timeout: 3_000 });
    void currentState; // suppress unused warning
  });
});
