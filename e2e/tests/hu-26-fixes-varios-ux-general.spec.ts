import { expect, test } from "@playwright/test";
import {
  API_BASE,
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
import { bookingAppointmentDialog, professionalFormDialog } from "../fixtures/ui";

test.describe("HU-26 · Fixes varios UX general", () => {
  // Req 1: Calendar time picker shows 06:00–20:00
  test("HU-26 · 1 combobox de hora en nuevo turno muestra rango 06:00–20:00", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: /New appointment/ }).first().click();
    const dlg = bookingAppointmentDialog(page);
    await expect(dlg).toBeVisible();
    const timeInput = dlg.getByTestId("appointment-time-input");
    await timeInput.focus();
    // The time listbox renders in a body-level portal (FloatingDropdown), so its
    // options are not descendants of the appointment dialog — assert at page level.
    // First option must be 06:00
    await expect(page.getByTestId("form-time-option-06:00")).toBeVisible();
    // Last option must be 20:00
    await expect(page.getByTestId("form-time-option-20:00")).toBeVisible();
    // Options outside the range must not exist
    await expect(page.getByTestId("form-time-option-05:45")).not.toBeVisible();
    await expect(page.getByTestId("form-time-option-20:15")).not.toBeVisible();
  });

  // Req 3: Professionals schedule defaults to 09:00–19:00
  test("HU-26 · 3 al activar día en horario de profesional los valores por defecto son 09:00 y 19:00", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const name = `E2E HU26 Sched ${Date.now()}`;
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = professionalFormDialog(page);
    await dlg.getByLabel("Full name").fill(name);
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await dlg.getByTestId("prof-day-mon-active").check();
    await expect(dlg.locator("#prof-1-start")).toHaveValue("09:00");
    await expect(dlg.locator("#prof-1-end")).toHaveValue("19:00");
  });

  // Req 4–5: Services 3-dot menu replaces inline deactivate button
  test("HU-26 · 4–5 fila de servicio tiene menú de 3 puntos con Editar detalle y Desactivar", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/services");

    // Search by service name so it lands on page 1 regardless of total count (server-side pagination)
    await page.getByPlaceholder(/search by name/i).fill(seed.serviceFullName);
    await page.waitForTimeout(600);

    const row = page.getByTestId(`svc-row-${seed.serviceId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    // Service price in list must use dot separator with Gs. prefix, no decimals (seeded price = 50.000)
    await expect(row.getByText("Gs. 50.000", { exact: true })).toBeVisible();

    // No standalone deactivate/activate button directly visible in the row actions area
    await expect(
      page.getByTestId(`svc-deactivate-${seed.serviceId}`),
    ).not.toBeAttached();

    // KebabMenu trigger must be present
    const trigger = page.getByTestId(`services-row-${seed.serviceId}-trigger`);
    await expect(trigger).toBeVisible();
    await trigger.click();

    // Menu items
    await expect(page.getByRole("menuitem", { name: /^(Edit details|Editar detalle)$/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /^(Deactivate|Desactivar)$/ })).toBeVisible();
  });

  // Req 8: Force refresh button in invoice history tab
  test("HU-26 · 8 botón de actualización forzada visible en historial de comprobantes", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: /^(History|Historial)$/ }).click();
    await expect(page.getByRole("button", { name: /^(Refresh|Actualizar)$/ })).toBeVisible();
  });

  // Req 9: Page scrolls to top after saving an invoice
  test("HU-26 · 9 al guardar un comprobante la página se posiciona al inicio", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
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
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Scroll ${Date.now()}`);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("5000");
    await expect(page.locator("#line-price-0")).toHaveValue("5.000");
    await page.locator("#pay-amount-0").fill("5000");
    await expect(page.locator("#pay-amount-0")).toHaveValue("5.000");

    // Scroll down so the page is not at top before issuing the invoice
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: "instant" }));
    await clickIssueInvoiceAndExpectSuccess(page);

    // After save, page should scroll back to top
    await page.waitForFunction(() => window.scrollY === 0, { timeout: 8_000 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  // Req 11: PDF does not contain invoice number ("Nº ")
  test("HU-26 · 11 el PDF generado no contiene el número de comprobante", async ({ request }) => {
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
    const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: `E2E PDF HU26 ${Date.now()}`,
      clientRucOverride: null,
      discountType: null,
      discountValue: null,
      lines: [{ serviceId: null, description: "E2E HU-26 line", quantity: 1, unitPrice: 9000 }],
      payments: [{ method: "CASH", amount: 9000 }],
    });
    const pdfRes = await request.get(`${API_BASE}/api/invoices/${inv.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pdfRes.status()).toBe(200);
    const raw = (await pdfRes.body()).toString("latin1");
    expect(raw).not.toContain("N\xba ");
  });
});
