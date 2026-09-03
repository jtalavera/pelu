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
import { ensureCashSessionOpen } from "../fixtures/billing";
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
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("5000");
    await expect(page.locator("#line-price-0")).toHaveValue("5.000");
    await page.locator("#pay-amount-0").fill("5000");
    await expect(page.locator("#pay-amount-0")).toHaveValue("5.000");
    await clickIssueInvoiceAndExpectSuccess(page);

    // Clicking the History tab (no page reload) refreshes the list on its own — see HU-16 · 4.
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    const histRow = page
      .locator("tbody tr[role=\"button\"]")
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(histRow).toBeVisible({ timeout: 30_000 });
    // Total in history table must use dot separator, no decimals
    await expect(histRow).toContainText("5.000");
  });

  test("HU-16 · 1 y HU-16 · 3 pestaña historial encabezados y columnas", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByRole("heading", { name: "Invoice history" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Number" })).toBeVisible();
    // Issue #190 — "Date" was relabelled "Invoice date" to distinguish it from "Sent to SIFEN".
    await expect(page.getByRole("columnheader", { name: "Invoice date" })).toBeVisible();
    // Issue #186 · AC3 — the SIFEN-sent date is its own column, distinct from the comprobante date.
    await expect(page.getByRole("columnheader", { name: "Sent to SIFEN" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Client" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Total" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "SIFEN status" })).toBeVisible();
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
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByRole("heading", { name: "Invoice history" })).toBeVisible();

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
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("tab", { name: "History" }).click();

    const histRow = page
      .locator("tbody tr[role=\"button\"]")
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
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    const histRow = page
      .locator("tbody tr[role=\"button\"]")
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

  // Issue #186 · AC1 + AC3 — the "Corregir y reenviar" action sits in its own column (not stacked
  // under ESTADO SIFEN), and a separate "Sent to SIFEN" column shows the transmission date.
  test("Issue #186 · AC1 y AC3 columna propia para reenviar + fecha de envío a SIFEN", async ({
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
    await page.getByRole("tab", { name: "History" }).click();

    // Plain invoice: no correction button, "Sent to SIFEN" cell shows "—".
    await page.locator("#invoice-history-text-filter").fill(plainClient.fullName);
    const plainRow = page
      .locator('tbody tr[role="button"]', { hasText: plainClient.fullName })
      .filter({ visible: true });
    await expect(plainRow).toBeVisible({ timeout: 30_000 });
    await expect(plainRow.locator('[data-testid^="invoice-row-correct-resend-"]')).toHaveCount(0);
    // cells: [number, date, sentToSifen, client, total, status, sifenStatus, action]
    await expect(plainRow.locator("td")).toHaveCount(8);
    await expect(plainRow.locator("td").nth(2)).toHaveText("—");

    // Rejected invoice: correction button lives in the LAST cell, and the ESTADO SIFEN cell
    // (nth 6) holds only the badge, not the button. "Sent to SIFEN" cell shows a real date.
    await page.locator("#invoice-history-text-filter").fill(rejectedName);
    const rejRow = page
      .locator('tbody tr[role="button"]', { hasText: rejectedName })
      .filter({ visible: true });
    await expect(rejRow).toBeVisible({ timeout: 30_000 });
    const resendButton = rejRow.locator('[data-testid^="invoice-row-correct-resend-"]');
    await expect(resendButton).toBeVisible();
    await expect(rejRow.locator("td").last().locator('[data-testid^="invoice-row-correct-resend-"]')).toHaveCount(1);
    await expect(rejRow.locator("td").nth(6).locator('[data-testid^="invoice-row-correct-resend-"]')).toHaveCount(0);
    await expect(rejRow.locator("td").nth(2)).not.toHaveText("—");
    await expect(rejRow.locator("td").nth(2)).toContainText(/\d/);
  });
});
