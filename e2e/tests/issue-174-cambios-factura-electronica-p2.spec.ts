import { createRequire } from "node:module";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const nodeRequire = createRequire(import.meta.url);
const pdfParse = nodeRequire("pdf-parse/lib/pdf-parse.js") as (
  data: Buffer,
) => Promise<{ text: string }>;

import {
  apiBaseUrl,
  apiGetJson,
  apiPostJson,
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

// Issue #174 "Cambios en factura electrónica (Parte 2)":
//  1. Tipo de documento = Tarjeta Diplomática de exoneración fiscal → ítems y totales sin IVA
//     incluido, tanto en el KuDE como en el detalle del sistema.
//  2. El primer "Monto" de Métodos de pago siempre sigue al "Total", cualquiera sea su método.
//  3. Se elimina el título redundante "Identificar cliente" dentro del acordeón homónimo.
//  4. Subsección previa a Clientes con fecha de emisión de solo lectura + checkbox para editarla,
//     validada por sistema dentro de la ventana -720h / +120h de la SIFEN.
//  5. Botón "Descargar reporte" (Excel y PDF) en el Historial, sólo datos de cabecera.
//  6. Filtro por defecto del Historial: un mes atrás (no seis) y componente Día/Mes/Año.

const DEMO_TENANT_ID = 1;
const FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";
const FIXTURE_CERT_RUC = "12345678-9";

async function enableSifen(request: APIRequestContext, token: string) {
  await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, true);
  await apiPutJson(request, token, "/api/business-profile", {
    businessName: "Peluqueria E2E 174",
    ruc: FIXTURE_CERT_RUC,
    address: "Avda. Mcal. Lopez 1234",
    phone: "0981123456",
    contactEmail: "contacto@e2e-174.test",
    logoDataUrl: null,
    taxpayerType: "INDIVIDUAL",
    economicActivityCode: "96020",
    economicActivityDescription: "Peluqueria y otros tratamientos de belleza",
    sifenDepartmentCode: "12",
    sifenDepartmentName: "CENTRAL",
    sifenCityCode: "5044",
    sifenCityName: "FERNANDO DE LA MORA",
    sifenFantasyName: null,
    kudeFooterMessage: null,
  });
  const certRes = await request.post(
    `${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`,
  );
  expect(certRes.ok(), await certRes.text()).toBeTruthy();
}

async function openNewInvoiceForm(page: Page) {
  await page.goto("/app/billing");
  await ensureCashSessionOpen(page);
  await page.getByRole("tab", { name: "Cash Register" }).click();
  await page.getByRole("button", { name: "New Invoice" }).click();
}

test.describe("Issue #174 · Cambios en factura electrónica (Parte 2)", () => {
  test.afterEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, false);
  });

  // ── AC-01 ──────────────────────────────────────────────────────────────────

  test("AC1 · a diplomatic-exoneration receiver strips the included 10% IVA from items and totals", async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await enableSifen(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    // 55.000 IVA-incluido → 55.000 / 1,10 = 50.000 net.
    const gross = 55000;
    const net = 50000;

    const diplomatic = await apiPostJson<{
      id: number;
      total: string;
      subtotal: string;
      lines: { unitPrice: string }[];
    }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: "MISION DIPLOMATICA",
      clientRucOverride: null,
      clientIdentityDocumentOverride: "DIP-0001",
      clientIdentityDocumentTypeOverride: "TARJETA_DIPLOMATICA",
      email: "diplo174@example.com",
      lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: gross }],
      payments: [{ method: "CASH", amount: net }],
    });
    expect(Number(diplomatic.total)).toBe(net);
    expect(Number(diplomatic.subtotal)).toBe(net);
    expect(Number(diplomatic.lines[0].unitPrice)).toBe(net);

    // Contrast: a normal receiver keeps the gross, IVA-incluido amount.
    const normal = await apiPostJson<{ total: string }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: "CLIENTE NORMAL",
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      email: "normal174@example.com",
      lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: gross }],
      payments: [{ method: "CASH", amount: gross }],
    });
    expect(Number(normal.total)).toBe(gross);

    // The KuDE shows the net amount, never the gross.
    await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${diplomatic.id}/prepare-as-approved`,
    );
    const kudeRes = await request.get(
      `${apiBaseUrl()}/api/invoices/${diplomatic.id}/sifen/kude`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(kudeRes.ok(), await kudeRes.text()).toBeTruthy();
    const { text } = await pdfParse(Buffer.from(await kudeRes.body()));
    expect(text).toContain("50.000");
    expect(text).not.toContain("55.000");
  });

  test("AC1 · the form shows the tax-exempt note and net totals when Tarjeta Diplomática is picked", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await openNewInvoiceForm(page);

    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("MISION DIPLOMATICA");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("55000");
    // Robust to a parallel sibling flipping SIFEN on (which makes the email mandatory).
    await page.locator("#billing-client-email").fill("e2e174-ac1@example.com");

    // No note while it's a normal receiver.
    await expect(page.getByTestId("billing-tax-exempt-note")).toBeHidden();

    await page
      .locator("#client-identity-document-type")
      .selectOption("TARJETA_DIPLOMATICA");
    await page.locator("#client-identity-document-number").fill("DIP-0001");

    await expect(page.getByTestId("billing-tax-exempt-note")).toBeVisible();
    // Total is now net of the 10% IVA: 55.000 / 1,10 = 50.000.
    await expect(page.locator("#pay-amount-0")).toHaveValue("50.000");
    await clickIssueInvoiceAndExpectSuccess(page);
  });

  // ── AC-02 ──────────────────────────────────────────────────────────────────

  test("AC2 · the first payment amount tracks Total for any payment method", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await openNewInvoiceForm(page);
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("PAGO");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#billing-client-email").fill("e2e174-ac2@example.com");

    await page.locator("#line-price-0").fill("40000");
    await expect(page.locator("#pay-amount-0")).toHaveValue("40.000");

    // Switch the first row away from CASH — it stays aligned with Total.
    await page.locator("#pay-method-0").selectOption("TRANSFER");
    await expect(page.locator("#pay-amount-0")).toHaveValue("40.000");

    // Change Total → the first "Monto" follows even though it's a TRANSFER row.
    await page.locator("#line-price-0").fill("75000");
    await expect(page.locator("#pay-amount-0")).toHaveValue("75.000");
    await clickIssueInvoiceAndExpectSuccess(page);
  });

  // ── AC-04 ──────────────────────────────────────────────────────────────────

  test("AC4 · emission date is read-only until unlocked, then validated against the SIFEN window", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await openNewInvoiceForm(page);

    const dateField = page.locator("#billing-issue-date");
    await expect(dateField).toBeDisabled();
    await expect(page.getByText(/720 hours \(30 days\)/)).toBeVisible();

    await page.getByLabel("Edit the issue date").check();
    await expect(dateField).toBeEnabled();

    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("FECHA");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("30000");
    await page.locator("#billing-client-email").fill("e2e174-ac4@example.com");

    // 40 days back is outside the window → blocked, no POST.
    const tooOld = new Date();
    tooOld.setDate(tooOld.getDate() - 40);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dmy = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    await dateField.fill(dmy(tooOld));

    let posted = false;
    page.on("request", (r) => {
      if (r.url().includes("/api/invoices") && r.method() === "POST") posted = true;
    });
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(page.locator("#billing-issue-date-err")).toBeVisible();
    expect(posted).toBe(false);

    // 3 days back is inside the window → issues, and the invoice keeps that emission date.
    const backdated = new Date();
    backdated.setDate(backdated.getDate() - 3);
    await dateField.fill(dmy(backdated));
    const { id } = await clickIssueInvoiceAndExpectSuccess(page);

    const view = await apiGetJson<{ issuedAt: string }>(request, token, `/api/invoices/${id}`);
    const issued = new Date(view.issuedAt);
    expect(issued.getFullYear()).toBe(backdated.getFullYear());
    expect(issued.getMonth()).toBe(backdated.getMonth());
    expect(issued.getDate()).toBe(backdated.getDate());
  });

  test("AC4 · the backend rejects an out-of-window emission date sent directly", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    const tooFuture = new Date();
    tooFuture.setDate(tooFuture.getDate() + 10);
    const res = await request.post(`${apiBaseUrl()}/api/invoices`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: {
        clientId: null,
        clientDisplayName: "FUTURO",
        email: null,
        issuedAt: tooFuture.toISOString(),
        lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 30000 }],
        payments: [{ method: "CASH", amount: 30000 }],
      },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain("INVOICE_ISSUE_DATE_OUT_OF_RANGE");
  });

  // ── AC-05 ──────────────────────────────────────────────────────────────────

  test("AC5 · the History tab downloads an Excel and a PDF report of the filtered invoices", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    await apiPostJson(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: `E2E 174 REPORTE ${Date.now()}`,
      email: null,
      lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 30000 }],
      payments: [{ method: "CASH", amount: 30000 }],
    });

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();

    for (const [testId, ext, sig] of [
      ["invoice-history-report-xlsx", "xlsx", "PK"],
      ["invoice-history-report-pdf", "pdf", "%PDF"],
    ] as const) {
      await page.getByTestId("invoice-history-report-button").click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId(testId).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(new RegExp(`^COMPROBANTES-.*\\.${ext}$`));
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      expect(body.subarray(0, sig.length).toString("latin1")).toBe(sig);
    }
  });

  // ── AC-06 ──────────────────────────────────────────────────────────────────

  test("AC6 · History default filter is one month back, shown as DD/MM/YYYY", async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();

    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
    const pad = (n: number) => String(n).padStart(2, "0");
    const dmy = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

    await expect(page.locator("#filter-from")).toHaveValue(dmy(from));
    await expect(page.locator("#filter-to")).toHaveValue(dmy(today));
  });

  // ── AC-03 ──────────────────────────────────────────────────────────────────

  test("AC3 · the redundant 'Identificar cliente' heading inside the accordion is gone", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    // SIFEN stays disabled at issue time (same pattern as sifen-hu-11): the invoice is then
    // fabricated straight into an APPROVED SIFEN state, with no client data → eligible for the
    // "Identify client" accordion.
    const clientName = `E2E 174 IDENT ${Date.now()}`;
    const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: clientName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      email: null,
      lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 30000 }],
      payments: [{ method: "CASH", amount: 30000 }],
    });
    const prep = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${inv.id}/prepare-as-approved`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(clientName);
    const row = page.locator('tbody tr[role="button"]').filter({ hasText: clientName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const modal = page.getByRole("dialog");
    await modal.getByTestId("sifen-tab-identify").click();
    // The client-identification form is now open, but there is no inner <h3> repeating the
    // accordion's own "Identify client" label.
    await expect(
      modal.getByTestId("sifen-identify-client-confirm-button"),
    ).toBeVisible();
    await expect(modal.getByRole("heading", { name: "Identify client" })).toHaveCount(0);
  });
});
