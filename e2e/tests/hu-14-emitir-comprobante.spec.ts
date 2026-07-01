import { expect, test } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  isoDateLocal,
  listFiscalStamps,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";
import { setControlledInputValue } from "../fixtures/ui";

test.describe.configure({ mode: "serial" });

test.describe("HU-14 · Emitir comprobante", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
  });

  test("HU-14 · 1 formulario de emisión de factura", async ({ page }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await expect(page.getByRole("heading", { name: "Issue Invoice" })).toBeVisible();
  });

  test("HU-14 · 2 varios ítems, número con 7 dígitos y HU-14 · 6 método de pago", async ({
    page,
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
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Inv ${Date.now()}`);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 6));
    await page.getByRole("button", { name: client.fullName }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("5000");
    await expect(page.locator("#line-price-0")).toHaveValue("5.000");
    await page.getByRole("button", { name: "Add item" }).click();
    await pickServiceLine(page, seed.serviceFullName, 1);
    await page.locator("#line-price-1").fill("3000");
    await expect(page.locator("#line-price-1")).toHaveValue("3.000");
    await page.locator("#pay-amount-0").fill("8000");
    await expect(page.locator("#pay-amount-0")).toHaveValue("8.000");
    await clickIssueInvoiceAndExpectSuccess(page);
    await expect(page.getByText(/Invoice \d{7} issued successfully/)).toBeVisible();
  });

  test("HU-14 · 3 cliente ocasional", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client display name").fill("Occ E2E");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("15000");
    await expect(page.locator("#line-price-0")).toHaveValue("15.000");
    await page.locator("#pay-amount-0").fill("15000");
    await expect(page.locator("#pay-amount-0")).toHaveValue("15.000");
    await clickIssueInvoiceAndExpectSuccess(page);
  });

  test("HU-14 · 5 descuento porcentaje", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Discount type").selectOption("PERCENT");
    await page.getByLabel(/Discount value/i).fill("10");
    await page.getByLabel("Client display name").fill("Disc E2E");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("10000");
    await expect(page.locator("#line-price-0")).toHaveValue("10.000");
    await page.locator("#pay-amount-0").fill("9000");
    await expect(page.locator("#pay-amount-0")).toHaveValue("9.000");
    // 10% discount on 10.000 = total of 9.000
    await expect(page.locator("span").filter({ hasText: /^9\.000$/ }).first()).toBeVisible();
    await clickIssueInvoiceAndExpectSuccess(page);
  });

  test("HU-14 · 7 sin timbrado activo vigente bloquea emisión (ninguno activo)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const stamps = await listFiscalStamps(request, token);
    for (const s of stamps) {
      await request.post(`${API_BASE}/api/fiscal-stamps/${s.id}/deactivate`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client display name").fill("No stamp");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("1000");
    await expect(page.locator("#line-price-0")).toHaveValue("1.000");
    await page.locator("#pay-amount-0").fill("1000");
    await expect(page.locator("#pay-amount-0")).toHaveValue("1.000");
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(
      page.getByText("No active fiscal stamp. Go to Settings → Timbrado to activate one.", {
        exact: true,
      }),
    ).toBeVisible();

    const today = new Date();
    const nextYear = new Date(today);
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const created = await apiPostJson<{ id: number }>(request, token, "/api/fiscal-stamps", {
      stampNumber: `7${Date.now().toString().slice(-7)}`,
      validFrom: isoDateLocal(today),
      validUntil: isoDateLocal(nextYear),
      rangeFrom: 1,
      rangeTo: 9_999_999,
      initialEmissionNumber: Math.max(100, stamps[0]?.nextEmissionNumber ?? 100),
    });
    await apiPostJson(request, token, `/api/fiscal-stamps/${created.id}/activate`, {});
  });

  test("HU-14 · 7 timbrado vencido: emisión rechazada", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const stamps = await listFiscalStamps(request, token);
    for (const s of stamps) {
      await request.post(`${API_BASE}/api/fiscal-stamps/${s.id}/deactivate`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    const until = new Date();
    until.setDate(until.getDate() - 2);
    const from = new Date(until);
    from.setFullYear(from.getFullYear() - 1);
    const expired = await apiPostJson<{ id: number }>(request, token, "/api/fiscal-stamps", {
      stampNumber: `7${Date.now().toString().slice(-7)}`,
      validFrom: isoDateLocal(from),
      validUntil: isoDateLocal(until),
      rangeFrom: 3_000_000,
      rangeTo: 3_000_100,
      initialEmissionNumber: 3_000_000,
    });
    await apiPostJson(request, token, `/api/fiscal-stamps/${expired.id}/activate`, {});

    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "Cash Register" }).click();
    const openBtn = page.getByRole("button", { name: "Open cash register" });
    if (await openBtn.isVisible()) {
      await page.getByLabel("Initial cash amount").fill("10000");
      await expect(page.getByLabel("Initial cash amount")).toHaveValue("10.000");
      await openBtn.click();
      await expect(page.getByText(/^Cash register is open$/)).toBeVisible({ timeout: 30_000 });
    }
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client display name").fill("Walk-in");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("10000");
    await expect(page.locator("#line-price-0")).toHaveValue("10.000");
    await page.locator("#pay-amount-0").fill("10000");
    await expect(page.locator("#pay-amount-0")).toHaveValue("10.000");
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(
      page.getByText("The active fiscal stamp is not valid for today's date.", { exact: true }),
    ).toBeVisible();
  });

  test("HU-14 · 8 sin sesión de caja abierta la API rechaza emisión", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const current = await request.get(`${API_BASE}/api/cash-sessions/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (current.status() === 200) {
      await request.post(`${API_BASE}/api/cash-sessions/close`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        data: { countedCashAmount: 50_000 },
      });
    }
    const res = await request.post(`${API_BASE}/api/invoices`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: {
        clientId: null,
        clientDisplayName: "E2E API",
        clientRucOverride: null,
        discountType: null,
        discountValue: null,
        lines: [{ serviceId: null, description: "Test", quantity: 1, unitPrice: 1000 }],
        payments: [{ method: "CASH", amount: 1000 }],
      },
    });
    expect([400, 409]).toContain(res.status());
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("CASH_SESSION_NOT_OPEN");
  });

  test("HU-14 · 9 sin RUC de negocio: aviso destacado en el dashboard", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await request.put(`${API_BASE}/api/business-profile`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: {
        businessName: "Demo salon",
        ruc: null,
        address: null,
        phone: null,
        contactEmail: null,
        logoDataUrl: null,
      },
    });
    await loginAsDemo(page);
    await page.goto("/app");
    await expect(
      page.getByText("Add a valid business RUC to issue invoices.", { exact: true }),
    ).toBeVisible();
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
  });

  test("HU-14 · 10 PDF devuelve application/pdf después de emitir", async ({ request }) => {
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
    await seedCategoryServiceProfessional(request, token);
    const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: "PDF API E2E",
      clientRucOverride: null,
      discountType: null,
      discountValue: null,
      lines: [{ serviceId: null, description: "E2E PDF line", quantity: 1, unitPrice: 9000 }],
      payments: [{ method: "CASH", amount: 9000 }],
    });

    const pdfRes = await request.get(`${API_BASE}/api/invoices/${inv.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pdfRes.status()).toBe(200);
    const ct = pdfRes.headers()["content-type"] ?? "";
    expect(ct).toContain("application/pdf");
    const buf = await pdfRes.body();
    expect(buf.slice(0, 4).toString("latin1")).toBe("%PDF");
  });

  test("HU-25 · lista de clientes en una fila (nombre, teléfono, RUC)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const suffix = Date.now();
    const fullName = `E2E Row ${suffix}`;
    const phone = "0981999888";
    const ruc = `8${String(suffix).slice(-5)}-6`;
    await apiPostJson(request, token, "/api/clients", {
      fullName,
      phone,
      email: null,
      ruc,
    });
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(fullName.slice(0, 10));
    const option = page.getByRole("button", { name: fullName, exact: false });
    await expect(option).toBeVisible();
    await expect(option).toContainText(phone);
    await expect(option).toContainText(ruc);
    const text = (await option.innerText()).replace(/\r\n/g, "\n");
    expect(text.includes("\n"), "dropdown row should be a single line of text").toBe(false);
  });

  // NOTE: The former HU-25 test "factura con edición de nombre/RUC actualiza el cliente
  // en el directorio" was removed. Its behaviour (syncing the edited invoice name/RUC back
  // to the client directory, HU-25 AC2) was deliberately reversed by issue #47 ("remove
  // client profile sync write-back; invoice name/RUC stays isolated"). The current
  // behaviour is covered by "Issue #47 · ... no modifica el perfil del cliente" in
  // high-priority-fixes.spec.ts.

  test("HU-14 · 11+12 máscara de miles en Precio Unitario y Monto", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
    await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    const priceField = page.locator("#line-price-0");
    await setControlledInputValue(priceField, "1234567");
    await expect(priceField).toHaveValue("1.234.567");
    const amountField = page.locator("#pay-amount-0");
    await setControlledInputValue(amountField, "9999999");
    await expect(amountField).toHaveValue("9.999.999");
  });

  test("HU-14 · 13 botón Emitir comprobante deshabilitado hasta cliente, ítem y pago", async ({
    page,
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
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Submit ${Date.now()}`);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();

    const issueBtn = page.getByRole("button", { name: "Issue invoice" });
    // No client / no item / no payment yet → disabled
    await expect(issueBtn).toBeDisabled();

    // Client selected, no item / payment → still disabled
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 6));
    await page.getByRole("button", { name: client.fullName }).click();
    await expect(issueBtn).toBeDisabled();

    // Add item with valid price → CASH payment auto-fills → button enabled
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("5000");
    await expect(page.locator("#line-price-0")).toHaveValue("5.000");
    await expect(page.locator("#pay-amount-0")).toHaveValue("5.000");
    await expect(issueBtn).toBeEnabled();
  });

  test("HU-14 · 14 issuedAt mostrado en hora de Paraguay (GMT-3) en historial", async ({
    page,
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
    await ensureCashSessionOpenApi(request, token);
    await seedCategoryServiceProfessional(request, token);
    const clientDisplayName = `E2E PY Time ${Date.now()}`;
    await apiPostJson(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName,
      clientRucOverride: null,
      discountType: null,
      discountValue: null,
      lines: [{ serviceId: null, description: "E2E PY Time", quantity: 1, unitPrice: 1000 }],
      payments: [{ method: "CASH", amount: 1000 }],
    });

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    const historyTable = page.locator('[data-tour="billing-invoice-list"]');
    await expect(historyTable).toBeVisible({ timeout: 15_000 });
    // Date column is the 2nd visible cell (invoice #, issued date, client, …)
    const row = historyTable.locator("tbody tr").filter({ hasText: clientDisplayName }).first();
    const cell = row.locator("td").nth(1);
    await expect(cell).toBeVisible();
    const text = await cell.innerText();
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/[+-]00:00|Z\b/);
  });

  test("HU-14 · 16 PDF no contiene timbrado, vigencia, encabezados, copia ni etiquetas de pago", async ({
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
    await seedCategoryServiceProfessional(request, token);
    const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: `E2E PDF Clean ${Date.now()}`,
      clientRucOverride: null,
      discountType: null,
      discountValue: null,
      lines: [{ serviceId: null, description: "E2E line", quantity: 1, unitPrice: 9000 }],
      payments: [{ method: "CASH", amount: 9000 }],
    });
    const pdfRes = await request.get(`${API_BASE}/api/invoices/${inv.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pdfRes.status()).toBe(200);
    const buf = await pdfRes.body();
    const raw = buf.toString("latin1");
    // The PDF body decompresses streams but the explicit forbidden text strings
    // are present in literal form when emitted; ensure they are absent.
    expect(raw).not.toContain("Timbrado");
    expect(raw).not.toContain("Vigencia");
    expect(raw).not.toContain("COPIA: ARCHIVO TRIBUTARIO");
    expect(raw).not.toContain("ORIGINAL: ADQUIRENTE");
  });

  test("HU-25 · lista de servicios en una fila (nombre, categoría, precio, duración)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.locator("#billing-line-svc-0").fill(seed.serviceFullName.slice(0, 10));
    const option = page.getByRole("button", { name: seed.serviceFullName, exact: false });
    await expect(option).toBeVisible();
    const text = (await option.innerText()).replace(/\r\n/g, "\n");
    expect(text.includes("\n"), "service dropdown row should be a single line of text").toBe(false);
  });
});
