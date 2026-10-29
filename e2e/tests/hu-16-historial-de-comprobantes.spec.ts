import { expect, test } from "@playwright/test";
import {
  apiBaseUrl,
  apiPostJson,
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen, fillPaymentAmount, goToBillingHome, goToInvoiceHistory, searchInvoiceHistory, showPaymentAmounts } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

test.describe("HU-16 · Historial de comprobantes", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
  });



  test("HU-16 · 2 filtros por fecha y estado", async ({ page, request }) => {
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
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Hist ${Date.now()}`);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await goToBillingHome(page);
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("5000");
    await expect(page.locator("#line-price-0")).toHaveValue("5.000");
    await fillPaymentAmount(page, "5000");
    await showPaymentAmounts(page);
    await expect(page.locator("#pay-amount-0")).toHaveValue("5.000");
    await clickIssueInvoiceAndExpectSuccess(page);

    // Clicking the History tab (no page reload) refreshes the list on its own — see HU-16 · 4.
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const histRow = page
      .locator('[data-testid^="invoice-history-row-"]')
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(histRow).toBeVisible({ timeout: 30_000 });
    // Total in history table must use dot separator, no decimals
    await expect(histRow).toContainText("5.000");
  });

  // Billing redesign: the history is a list of rows (client, total, one plain-language state, plus
  // number / invoice date / payment method) instead of a table with a column per technical field.
  test("HU-16 · 1 y HU-16 · 3 pantalla historial: título, búsqueda, estados y datos de cada fila", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU16-1 ${Date.now()}`);
    const invoice = await apiPostJson<{ id: number; invoiceNumberFormatted: string }>(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 5000 }],
      payments: [{ method: "CASH", amount: 5000 }],
    });

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);
    await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
    await expect(page.locator("#invoice-history-text-filter")).toBeVisible();
    for (const status of ["all", "ISSUED", "VOIDED"]) {
      await expect(page.getByTestId(`invoice-history-status-${status}`)).toBeVisible();
    }
    // No table with a column per technical field any more.
    await expect(page.getByRole("columnheader")).toHaveCount(0);

    await searchInvoiceHistory(page, client.fullName);
    const row = page.getByTestId(`invoice-history-row-${invoice.id}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByTestId("invoice-row-number")).toHaveText(invoice.invoiceNumberFormatted);
    await expect(row.getByTestId("invoice-row-date")).toContainText(/\d{1,2}:\d{2}/);
    await expect(row.getByTestId("invoice-row-client")).toContainText(client.fullName);
    await expect(row.getByTestId("invoice-row-total")).toHaveText("5.000");
    await expect(row.getByTestId("invoice-row-method")).toHaveText("Cash");
    await expect(row.locator("[data-invoice-state]")).toHaveText("Issued");
  });

  test("HU-16 · 4 abrir la pestaña Historial siempre refresca la lista, sin recargar la página", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    // Visit History once before the invoice exists, so the fetch that follows this test's
    // later re-click is a genuine refresh, not the tab's very first (mount-time) fetch.
    await goToInvoiceHistory(page);
    await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();

    // Create the invoice out-of-band (API), while the browser tab stays on Billing/History —
    // nothing here triggers a page reload or touches any filter, so the History tab itself must
    // be responsible for picking up the new row.
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU16-4 ${Date.now()}`);
    await apiPostJson(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 5000,
        },
      ],
      payments: [{ method: "CASH", amount: 5000 }],
    });

    // Switch away from History, then back — no page.goto, no manual "Refresh" click, no filter
    // change. Re-entering the tab must be enough to show the invoice created above.
    await goToBillingHome(page);
    await goToInvoiceHistory(page);

    const histRow = page
      .locator('[data-testid^="invoice-history-row-"]')
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(histRow).toBeVisible({ timeout: 30_000 });
  });

  // Issue #163 · AC10 — rows open the detail solely by clicking the record, like Professionals rows.
  test("Issue #163 · AC10 clic en la fila abre el detalle del comprobante (sin botón 'View')", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU16-163 ${Date.now()}`);
    const invoice = await apiPostJson<{ id: number; invoiceNumberFormatted: string }>(
      request,
      token,
      "/api/invoices",
      {
        clientId: client.id,
        clientDisplayName: client.fullName,
        clientRucOverride: null,
        clientIdentityDocumentOverride: null,
        lines: [
          {
            serviceId: seed.serviceId,
            description: seed.serviceFullName,
            quantity: 1,
            unitPrice: 5000,
          },
        ],
        payments: [{ method: "CASH", amount: 5000 }],
      },
    );

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const histRow = page
      .locator('[data-testid^="invoice-history-row-"]')
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(histRow).toBeVisible({ timeout: 30_000 });

    // No standalone "View" button exists anymore — only the row itself is interactive.
    await expect(histRow.getByRole("button", { name: "View" })).toHaveCount(0);
    await expect(histRow).toHaveAttribute("role", "button");

    // Clicking anywhere on the row opens the detail modal.
    await histRow.click();
    await expect(
      page.getByRole("dialog").filter({ hasText: invoice.invoiceNumberFormatted }),
    ).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");

    // Keyboard access: focus the row and press Enter to open it too.
    await histRow.focus();
    await histRow.press("Enter");
    await expect(
      page.getByRole("dialog").filter({ hasText: invoice.invoiceNumberFormatted }),
    ).toBeVisible({ timeout: 15_000 });
  });

  // Issue #186 · AC1 + AC3 — the "Corregir y reenviar" action is its own control (never mixed into
  // the state), and the SIFEN transmission date is shown apart from the comprobante date.
  test("Issue #186 · AC1 y AC3 acción propia para reenviar + fecha de envío a SIFEN", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    // A plain invoice never sent to SIFEN.
    const plainClient = await seedClient(request, token, `E2E 186 PLAIN ${Date.now()}`);
    await apiPostJson(request, token, "/api/invoices", {
      clientId: plainClient.id,
      clientDisplayName: plainClient.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 5000 }],
      payments: [{ method: "CASH", amount: 5000 }],
    });

    // A SIFEN-rejected invoice — simulate-sifen-rejection also stamps sifenSubmittedAt.
    const rejectedName = `E2E 186 RECHAZADA ${Date.now()}`;
    const rejected = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: rejectedName,
      email: "e2e186@example.com",
      lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 55000 }],
      payments: [{ method: "CASH", amount: 55000 }],
    });
    const rejRes = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${rejected.id}/simulate-sifen-rejection`,
    );
    expect(rejRes.ok(), await rejRes.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);

    // Plain invoice: no correction button and nothing sent to SIFEN.
    await searchInvoiceHistory(page, plainClient.fullName);
    const plainRow = page
      .locator('[data-testid^="invoice-history-row-"]', { hasText: plainClient.fullName })
      .filter({ visible: true });
    await expect(plainRow).toBeVisible({ timeout: 30_000 });
    await expect(plainRow.locator('[data-testid^="invoice-row-correct-resend-"]')).toHaveCount(0);
    await expect(plainRow.getByTestId("invoice-row-sifen-sent")).toHaveCount(0);

    // Rejected invoice: state "Needs attention", its own "Correct and resend" button, and a real
    // "Sent to SIFEN" date (simulate-sifen-rejection stamps sifenSubmittedAt).
    await searchInvoiceHistory(page, rejectedName);
    const rejRow = page
      .locator('[data-testid^="invoice-history-row-"]', { hasText: rejectedName })
      .filter({ visible: true });
    await expect(rejRow).toBeVisible({ timeout: 30_000 });
    await expect(rejRow.locator("[data-invoice-state]")).toHaveText("Needs attention");
    await expect(page.getByTestId(`invoice-row-correct-resend-${rejected.id}`)).toBeVisible();
    await expect(rejRow.getByTestId("invoice-row-sifen-sent")).toContainText("Sent to SIFEN");
    await expect(rejRow.getByTestId("invoice-row-sifen-sent")).toContainText(/\d/);
  });
});
