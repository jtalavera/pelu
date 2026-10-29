import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  apiPutJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import {
  addPaymentMethodRow,
  goToBillingHome,
  goToCashHistory,
  goToInvoiceHistory,
  openCashPanel,
  openMoreOptions,
  searchInvoiceHistory,
} from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

/**
 * Billing redesign (minimalist web): the screen is a home with one primary action, a 3-step
 * "New invoice" flow with the extras folded under "More options", and a single History screen
 * with an Invoices / Cash sessions toggle. Covers the acceptance criteria of the redesign proposal.
 */
test.describe.configure({ mode: "serial" });

async function prepare(request: APIRequestContext) {
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
  return token;
}

async function seedInvoice(
  request: APIRequestContext,
  token: string,
  serviceId: number,
  serviceName: string,
  clientName: string,
  unitPrice = 12_000,
) {
  const client = await seedClient(request, token, clientName);
  return apiPostJson<{ id: number; invoiceNumberFormatted: string }>(request, token, "/api/invoices", {
    clientId: client.id,
    clientDisplayName: clientName,
    clientRucOverride: null,
    clientIdentityDocumentOverride: null,
    lines: [{ serviceId, description: serviceName, quantity: 1, unitPrice }],
    payments: [{ method: "CASH", amount: unitPrice }],
  });
}

test.describe("Facturación rediseñada · inicio", () => {
  test("RD-1 el inicio muestra título, chip de caja, total del día y un único botón principal", async ({
    page,
    request,
  }) => {
    await prepare(request);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);

    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await expect(page.getByTestId("billing-cash-chip")).toContainText("Cash register is open");
    await expect(page.getByText("Today", { exact: true })).toBeVisible();
    await expect(page.getByTestId("billing-day-total")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New invoice" })).toBeVisible();
    // The old tab bar is gone.
    await expect(page.getByRole("tab")).toHaveCount(0);
  });

  test("RD-2 'Facturas de hoy' y 'Ver historial' están plegados hasta que el usuario los despliega", async ({
    page,
    request,
  }) => {
    const token = await prepare(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const name = `E2E RD2 ${Date.now()}`;
    const inv = await seedInvoice(request, token, seed.serviceId, seed.serviceFullName, name);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);

    const toggle = page.getByTestId("billing-today-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "View full history" })).toHaveCount(0);
    await expect(page.getByTestId(`billing-today-row-${inv.id}`)).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId(`billing-today-row-${inv.id}`)).toContainText(name);
    await expect(page.getByTestId(`billing-today-row-${inv.id}`)).toContainText("Issued");
    await expect(page.getByRole("button", { name: "View full history" })).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId(`billing-today-row-${inv.id}`)).toHaveCount(0);
  });

  test("RD-3 el chip abre el panel de caja con los datos de la apertura, movimientos y cierre", async ({
    page,
    request,
  }) => {
    await prepare(request);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await openCashPanel(page);

    const panel = page.getByTestId("billing-cash-panel");
    await expect(panel.getByText("Opened at")).toBeVisible();
    await expect(panel.getByText("Opened by")).toBeVisible();
    await expect(panel.getByText("Opening amount")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Close cash register" })).toBeVisible();

    // Manual movement form lives inside the same panel.
    await page.getByTestId("billing-open-movement").click();
    await expect(page.locator("#movement-amount")).toBeVisible();
    await expect(page.locator("#movement-reason")).toBeVisible();
  });

  test("RD-4 con la caja cerrada se ofrece abrirla y 'Ver historial'", async ({ page, request }) => {
    const token = await prepare(request);
    await request.post(`${API_BASE}/api/cash-sessions/close`, {
      headers: authHeaders(token),
      data: { countedCashAmount: 50_000 },
    });
    try {
      await loginAsDemo(page);
      await page.goto("/app/billing");
      await goToBillingHome(page);

      await expect(page.getByTestId("billing-cash-chip")).toContainText("Cash register is closed");
      await expect(page.getByRole("button", { name: "+ New invoice" })).toHaveCount(0);
      await expect(page.getByLabel("Initial cash amount")).toBeVisible();
      await expect(page.getByRole("button", { name: "Open cash register" })).toBeVisible();

      await page.getByTestId("billing-view-history").click();
      await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
      await expect(page.getByTestId("billing-history-view-invoices")).toHaveAttribute("aria-pressed", "true");
    } finally {
      await ensureCashSessionOpenApi(request, token);
    }
  });
});

test.describe("Facturación rediseñada · nueva factura", () => {
  test("RD-5 la factura se arma en tres pasos y 'Sin nombre' es el cliente por defecto", async ({
    page,
    request,
  }) => {
    await prepare(request);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);
    await page.getByRole("button", { name: "+ New invoice" }).click();

    await expect(page.getByRole("heading", { name: "What did you do?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who is it for?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How does the client pay?" })).toBeVisible();
    await expect(page.getByTestId("billing-client-default")).toContainText("No name");
    // Anonymous invoice: no identity fields and no recipient email.
    await expect(page.locator("#client-display-name")).toHaveCount(0);
    await expect(page.locator("#billing-client-email")).toHaveCount(0);
    // The old per-section cards are gone.
    await expect(page.getByRole("heading", { name: "Discount", exact: true })).toBeHidden();
  });

  test("RD-6 emitir exige ítem y método de pago; ningún método viene preseleccionado", async ({
    page,
    request,
  }) => {
    const token = await prepare(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);
    await page.getByRole("button", { name: "+ New invoice" }).click();

    const submit = page.getByTestId("billing-invoice-submit");
    await expect(submit).toBeDisabled();
    await pickServiceLine(page, seed.serviceFullName, 0);
    // Item picked, total known, but the method is still undecided (issue #284).
    for (const m of ["CASH", "DEBIT_CARD", "CREDIT_CARD", "TRANSFER", "OTHER"]) {
      await expect(page.locator(`#pay-method-${m}`)).toHaveAttribute("aria-pressed", "false");
    }
    await expect(page.locator("#pay-method-err-0")).toHaveText("Select a payment method.");
    await expect(submit).toBeDisabled();

    await page.locator("#pay-method-CASH").click();
    await expect(page.locator("#pay-method-CASH")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#pay-method-err-0")).toHaveCount(0);
    await expect(submit).toBeEnabled();
    await expect(page.getByTestId("billing-total")).toHaveText("50.000");
  });

  test("RD-7 emitir una factura 'Sin nombre' muestra la pantalla de éxito con sus tres acciones", async ({
    page,
    request,
  }) => {
    const token = await prepare(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);
    await page.getByRole("button", { name: "+ New invoice" }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#pay-method-CASH").click();
    const invoice = await clickIssueInvoiceAndExpectSuccess(page);

    const success = page.getByTestId("billing-invoice-success");
    await expect(success).toContainText(`Invoice ${invoice.invoiceNumberFormatted} issued successfully.`);
    await expect(success.getByRole("button", { name: "Download PDF" })).toBeVisible();
    await expect(success.getByRole("button", { name: "+ New invoice" })).toBeVisible();
    await expect(success.getByRole("button", { name: "Back to start" })).toBeVisible();

    // "+ New invoice" starts again with an empty form (same default client, nothing chosen).
    await success.getByRole("button", { name: "+ New invoice" }).click();
    await expect(page.getByTestId("billing-invoice-submit")).toBeDisabled();
    await expect(page.getByTestId("billing-client-default")).toBeVisible();
    await expect(page.locator("#pay-method-CASH")).toHaveAttribute("aria-pressed", "false");

    // "Back to start" lands on the home, which now counts the invoice.
    await page.getByTestId("billing-invoice-back").click();
    await expect(page.getByTestId("billing-cash-chip")).toBeVisible();
  });

  test("RD-8 el pago por defecto es un solo método y 'Dividir pago' abre las filas con monto", async ({
    page,
    request,
  }) => {
    const token = await prepare(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);
    await page.getByRole("button", { name: "+ New invoice" }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);

    await expect(page.locator("#pay-amount-0")).toHaveCount(0);
    await page.getByTestId("billing-split-payment").click();
    await expect(page.locator("#pay-amount-0")).toHaveValue("50.000");
    await addPaymentMethodRow(page);
    await expect(page.locator("#pay-method-1")).toBeVisible();

    await page.getByTestId("billing-single-payment").click();
    await expect(page.locator("#pay-amount-0")).toHaveCount(0);
    await expect(page.locator("#pay-method-1")).toHaveCount(0);
    await expect(page.locator("#pay-method-CASH")).toBeVisible();
  });

  test("RD-9 al elegir tarjeta se pide la marca y solo entonces", async ({ page, request }) => {
    const token = await prepare(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);
    await page.getByRole("button", { name: "+ New invoice" }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);

    await expect(page.locator("#pay-card-brand-0")).toHaveCount(0);
    await page.locator("#pay-method-CREDIT_CARD").click();
    await expect(page.locator("#pay-card-brand-0")).toBeVisible();
    await page.locator("#pay-method-CASH").click();
    await expect(page.locator("#pay-card-brand-0")).toHaveCount(0);
  });

  test("RD-10 fecha, descuento, propinas y profesional viven en 'Más opciones', plegado por defecto", async ({
    page,
    request,
  }) => {
    const token = await prepare(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);
    await page.getByRole("button", { name: "+ New invoice" }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);

    const more = page.getByTestId("billing-more-options");
    await expect(more).not.toHaveAttribute("open", "");
    await expect(page.locator("#discount-type")).toBeHidden();
    await expect(page.locator("#billing-issue-date")).toBeHidden();
    await expect(page.getByTestId("billing-tips-section")).toBeHidden();

    await openMoreOptions(page);
    await expect(page.locator("#discount-type")).toBeVisible();
    await expect(page.locator("#billing-issue-date")).toBeVisible();
    await expect(page.locator("#billing-issue-date")).toBeDisabled();
    await expect(page.getByTestId("billing-tips-section")).toBeVisible();
    await expect(page.locator("#line-professional-0")).toBeVisible();
    await expect(page.locator("#line-disc-toggle-0")).toBeVisible();

    // A global discount typed there updates the total shown in the always-visible bar.
    await page.locator("#discount-type").selectOption("PERCENT");
    await page.locator("#discount-value").fill("10");
    await expect(page.getByTestId("billing-total")).toHaveText("45.000");
  });

  test("RD-11 con total de Gs. 7.000.000 o más, 'Sin nombre' avisa que hay que identificar al cliente", async ({
    page,
    request,
  }) => {
    const token = await prepare(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);
    await page.getByRole("button", { name: "+ New invoice" }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);

    await expect(page.getByTestId("billing-identification-required")).toHaveCount(0);
    await page.locator("#line-price-0").fill("7000000");
    await expect(page.getByTestId("billing-identification-required")).toBeVisible();

    // Identifying the client (occasional + RUC) removes the warning and shows the identity fields.
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.locator("#client-identity-document-number").fill("80000005-6");
    await page.locator("#client-display-name").fill("Cliente RD11");
    await expect(page.getByTestId("billing-identification-required")).toHaveCount(0);
  });

  test("RD-12 al identificar un cliente aparecen sus datos fiscales; al vaciar el buscador vuelve 'Sin nombre'", async ({
    page,
    request,
  }) => {
    await prepare(request);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);
    await page.getByRole("button", { name: "+ New invoice" }).click();

    const search = page.getByLabel("Search or select client");
    await search.click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await expect(page.locator("#client-display-name")).toBeVisible();
    await expect(page.locator("#client-identity-document-type")).toBeVisible();
    await expect(page.getByTestId("billing-client-default")).toHaveCount(0);

    await search.fill("");
    await expect(page.getByTestId("billing-client-default")).toBeVisible();
    await expect(page.locator("#client-display-name")).toHaveCount(0);
  });

  test("RD-13 'Volver' regresa al inicio sin perder el estado de la caja", async ({ page, request }) => {
    await prepare(request);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);
    await page.getByRole("button", { name: "+ New invoice" }).click();
    await page.getByTestId("billing-invoice-back").click();
    await expect(page.getByTestId("billing-cash-chip")).toContainText("Cash register is open");
    await expect(page.getByRole("button", { name: "+ New invoice" })).toBeVisible();
  });
});

test.describe("Facturación rediseñada · historial", () => {
  test("RD-14 el historial une facturas y cajas como dos vistas de una misma pantalla", async ({
    page,
    request,
  }) => {
    await prepare(request);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);

    await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
    await expect(page.getByTestId("billing-history-view-invoices")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#invoice-history-text-filter")).toBeVisible();

    await page.getByTestId("billing-history-view-cash").click();
    await expect(page.getByTestId("billing-history-view-cash")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#cash-history-text-filter")).toBeVisible();
    await expect(page.locator("#invoice-history-text-filter")).toHaveCount(0);
    await expect(page.getByTestId("cash-history-list")).toBeVisible();

    await page.getByTestId("billing-history-view-invoices").click();
    await expect(page.locator("#invoice-history-text-filter")).toBeVisible();
  });

  test("RD-15 la búsqueda se aplica con Enter o con el botón, y el filtro de estado con chips", async ({
    page,
    request,
  }) => {
    const token = await prepare(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const keep = `E2E RD15 KEEP ${Date.now()}`;
    const other = `E2E RD15 OTHER ${Date.now()}`;
    await seedInvoice(request, token, seed.serviceId, seed.serviceFullName, keep);
    await seedInvoice(request, token, seed.serviceId, seed.serviceFullName, other);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);

    const rows = page.locator('[data-testid^="invoice-history-row-"]');
    await searchInvoiceHistory(page, keep);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(keep);

    // Same result through the Search button.
    await searchInvoiceHistory(page, other);
    await page.getByTestId("invoice-history-text-filter-submit").click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(other);

    await page.getByTestId("invoice-history-status-VOIDED").click();
    await expect(page.getByTestId("invoice-history-status-VOIDED")).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(0);
    await page.getByTestId("invoice-history-status-all").click();
    await expect(rows).toHaveCount(1);
  });

  test("RD-16 fechas bajo 'Filtros' y reporte bajo el menú '⋯'", async ({ page, request }) => {
    await prepare(request);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);

    await expect(page.locator("#invoice-history-from")).toHaveCount(0);
    await page.getByTestId("invoice-history-filters-toggle").click();
    await expect(page.locator("#invoice-history-from")).toBeVisible();
    await expect(page.locator("#invoice-history-to")).toBeVisible();

    await page.getByTestId("invoice-history-report-button").click();
    await expect(page.getByTestId("invoice-history-report-xlsx")).toBeVisible();
    await expect(page.getByTestId("invoice-history-report-pdf")).toBeVisible();
  });

  test("RD-17 cada factura muestra un único estado en lenguaje simple", async ({ page, request }) => {
    const token = await prepare(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const name = `E2E RD17 ${Date.now()}`;
    const inv = await seedInvoice(request, token, seed.serviceId, seed.serviceFullName, name);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, name);

    const row = page.getByTestId(`invoice-history-row-${inv.id}`);
    await expect(row).toContainText("Issued");
    await expect(row.locator("[data-invoice-state]")).toHaveAttribute("data-invoice-state", "issued");
    // The technical SIFEN badge is no longer part of the list (it stays in the invoice detail).
    await expect(row).not.toContainText("Pending verification");
    await expect(page.getByRole("columnheader")).toHaveCount(0);
  });

  test("RD-18 el historial de cajas es accesible desde el panel de caja", async ({ page, request }) => {
    await prepare(request);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToCashHistory(page);

    await expect(page.getByTestId("billing-history-view-cash")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("cash-history-status-all")).toBeVisible();
    await expect(page.getByTestId("cash-history-status-OPEN")).toBeVisible();
    await expect(page.getByTestId("cash-history-status-CLOSED")).toBeVisible();

    await page.getByTestId("billing-history-back").click();
    await expect(page.getByTestId("billing-cash-chip")).toBeVisible();
  });
});
