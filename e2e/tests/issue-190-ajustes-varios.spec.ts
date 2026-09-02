import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  apiBaseUrl,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// Issue #190 — "Ajustes varios 2-09-2026":
//   1. "Historial de comprobantes": the "Fecha" column header becomes "Fecha factura".
//   2. "Corregir y reenviar": the emission date shows read-only above the client section.
//   3. "Corregir y reenviar": the comprobante number shows next to the form title.
//   4/5. SIFEN's 72h transmission window — a resend past it shows a non-blocking warning + a
//        permanent hint about the SIFEN restriction (the resend itself is never blocked).
//   6. "Historial de comprobantes": paging to the last page and back no longer hangs the app.
//   7. "Configuración → SIFEN": certificates and voided numbers are shown in real tables.

async function ensureCertificate(request: APIRequestContext) {
  const res = await request.post(
    `${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`,
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function post(request: APIRequestContext, path: string) {
  const res = await request.post(`${apiBaseUrl()}${path}`);
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function issueRejectedInvoice(
  request: APIRequestContext,
  token: string,
  serviceId: number,
  serviceName: string,
  clientName: string,
) {
  const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
    clientId: null,
    clientDisplayName: clientName,
    clientRucOverride: null,
    clientIdentityDocumentOverride: null,
    email: "issue190@example.com",
    lines: [{ serviceId, description: serviceName, quantity: 1, unitPrice: 55000 }],
    payments: [{ method: "CASH", amount: 55000 }],
  });
  await post(request, `/api/admin/sifen-test-support/invoices/${inv.id}/simulate-sifen-rejection`);
  return inv.id;
}

test.describe("Issue #190 · Ajustes varios", () => {
  test("AC1 · el encabezado de la columna de fecha del comprobante dice 'Fecha factura'", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByRole("columnheader", { name: "Invoice date" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Date", exact: true })).toHaveCount(0);
  });

  test("AC2 + AC3 · 'Corregir y reenviar' muestra el número y la fecha de emisión del comprobante", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await ensureCertificate(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const clientName = `E2E190 HEADER ${Date.now()}`;
    await issueRejectedInvoice(request, token, seed.serviceId, seed.serviceFullName, clientName);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(clientName);

    const row = page.locator('tbody tr[role="button"]', { hasText: clientName }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.locator('[data-testid^="invoice-row-correct-resend-"]').click();

    const form = page.getByRole("dialog", { name: "Correct and resend" });
    // AC3 — number next to the title, same shape as the detail modal ("Invoice #0001038").
    await expect(
      form.getByRole("heading", { name: /Correct and resend — Invoice #\d+/ }),
    ).toBeVisible();
    // AC2 — emission date, read-only (plain text, not an input), above the client section.
    const emission = form.getByTestId("sifen-correct-resend-emission-date");
    await expect(emission).toBeVisible();
    await expect(emission.locator("input, textarea")).toHaveCount(0);
  });

  test("AC4 + AC5 · pasado el plazo de 72h de SIFEN el reenvío avisa pero no se bloquea", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await ensureCertificate(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const clientName = `E2E190 PLAZO ${Date.now()}`;
    const invoiceId = await issueRejectedInvoice(
      request,
      token,
      seed.serviceId,
      seed.serviceFullName,
      clientName,
    );
    // Emitted 100h ago → outside SIFEN's 72h transmission window.
    await post(request, `/api/admin/sifen-test-support/invoices/${invoiceId}/backdate-issued-at/100`);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(clientName);
    const row = page.locator('tbody tr[role="button"]', { hasText: clientName }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.locator('[data-testid^="invoice-row-correct-resend-"]').click();

    const form = page.getByRole("dialog", { name: "Correct and resend" });
    // AC5 — the permanent hint about the SIFEN restriction is always there.
    await expect(form.getByTestId("sifen-correct-resend-window-hint")).toBeVisible();
    // AC4 — past the window, a warning shows…
    await expect(form.getByTestId("sifen-correct-resend-window-expired")).toBeVisible();
    // …but the resend is NOT blocked.
    await expect(form.getByTestId("sifen-correct-resend-confirm-button")).toBeEnabled();
  });

  test("AC6 · paginar hasta la última página del historial y volver atrás no cuelga la app", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    const token190 = `E2E190PAGING${Date.now()}`;
    // 12 rows → 2 pages at the default page size of 10.
    for (let i = 0; i < 12; i++) {
      await apiPostJson(request, token, "/api/invoices", {
        clientId: null,
        clientDisplayName: `${token190} ${i}`,
        clientRucOverride: null,
        clientIdentityDocumentOverride: null,
        email: "issue190paging@example.com",
        lines: [
          { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 40000 },
        ],
        payments: [{ method: "CASH", amount: 40000 }],
      });
    }

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(token190);

    const pager = page.getByRole("navigation", { name: "Pagination" });
    await expect(pager).toContainText("1 / 2");
    await expect(page.locator('tbody tr[role="button"]')).toHaveCount(10);

    // To the last page…
    await pager.getByRole("button", { name: "Next" }).click();
    await expect(pager).toContainText("2 / 2");
    await expect(page.locator('tbody tr[role="button"]')).toHaveCount(2);
    await expect(pager.getByRole("button", { name: "Next" })).toBeDisabled();

    // …and back. The app must stay responsive (this used to hang on "Cargando…").
    await pager.getByRole("button", { name: "Previous" }).click();
    await expect(pager).toContainText("1 / 2");
    await expect(page.locator('tbody tr[role="button"]')).toHaveCount(10);
    await expect(page.getByRole("heading", { name: "Invoice history" })).toBeVisible();
  });

  test("AC7 · Configuración → SIFEN muestra certificados y numeración inutilizada en tablas", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await ensureCertificate(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    // One rejected invoice → one automatic voiding row to render.
    const clientName = `E2E190 SIFEN ${Date.now()}`;
    await issueRejectedInvoice(request, token, seed.serviceId, seed.serviceFullName, clientName);

    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");

    // Certificates table.
    const certSection = page.getByTestId("sifen-certificate-list-section");
    await expect(certSection.getByRole("table")).toBeVisible();
    await expect(certSection.getByRole("columnheader", { name: "Upload date" })).toBeVisible();
    await expect(certSection.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-row").first()).toBeVisible();

    // Voided-numbers table, with a per-row action column + the submit button in the row.
    const voidingSection = page.getByTestId("sifen-number-voiding-section");
    await expect(voidingSection.getByRole("table")).toBeVisible();
    await expect(voidingSection.getByRole("columnheader", { name: "Range" })).toBeVisible();
    await expect(voidingSection.getByRole("columnheader", { name: "Action" })).toBeVisible();
    const row = page.getByTestId("sifen-number-voiding-row").first();
    await expect(row).toBeVisible();
    await expect(row.getByLabel("Reason")).toBeVisible();
    await expect(row.getByRole("button", { name: "Submit to SIFEN" })).toBeVisible();
  });
});
