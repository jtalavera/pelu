import { expect, test } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// See sifen-hu-18-cargar-certificado.spec.ts for the "sifen-hu-<n>-<slug>" naming rationale.
//
// Most of HU-08's 17 ACs are about PDF *content* structure (header/timbrado/client data, item
// detail split by tax rate, totals, CDC grouping, legends, page numbering) — those are covered by
// SifenKudePdfServiceTest via PdfTextExtractor (a JUnit-content assertion is strictly better suited
// than a Playwright screenshot/OCR test for verifying exact text inside a generated PDF). The QR
// hash algorithm itself (AC-13/AC-14) is covered by SifenQrCodeServiceTest, reproducing the Manual
// Técnico's own worked example exactly.
//
// AC-16 (download from the invoice detail screen) and AC-17 (send by email) are the two ACs with a
// real UI surface, so they're what this file exercises end-to-end. Getting an invoice to
// APPROVED/APPROVED_WITH_OBSERVATION requires either a real SIFEN "Aprobado" response (still not
// achievable through Playwright/CI — see PROGRESS.md's "Verificación en vivo" for how this was
// pursued manually) or nothing in the app calling SifenInvoiceSubmissionService.submit() yet
// (tenant activation is HU-22). The test-only /api/admin/sifen-test-support endpoint (gated behind
// femme.data-init.enabled, only ever active in the e2e Spring profile) fabricates that precondition
// using the real SifenInvoiceHeaderService/SifenInvoiceDetailService/SifenQrCodeService — only the
// XML-DSig signature and the real SIFEN round-trip are skipped, since neither affects whether the
// KuDE renders/downloads/emails correctly from real, valid data.

test.describe("SIFEN HU-08 · Generar el comprobante en PDF (KuDE) de una factura aprobada", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  test("HU-08 · AC-16 el botón de descarga del KuDE aparece solo para una factura enviada y descarga un PDF real", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU08 ${Date.now()}`);

    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 60000,
        },
      ],
      payments: [{ method: "CASH", amount: 60000 }],
    });

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    let row = page.locator("tbody").getByRole("row").filter({ hasText: client.fullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "View" }).click();

    // RT-28 (Hardening_SIFEN.md): before the invoice was ever submitted to SIFEN at all (no CDC/QR
    // yet), there's still nothing deliverable — no KuDE section/button.
    await expect(page.getByTestId("sifen-kude-download-button")).toHaveCount(0);
    // Two "Close" buttons exist (the modal's icon close + the footer button) — the footer one is
    // the last in DOM order.
    await page.getByRole("button", { name: "Close", exact: true }).last().click();

    // Test-only setup (e2e profile only, see file header): fabricates the "pendiente de
    // verificación" precondition — RT-28 requires the KuDE to be deliverable even before SIFEN
    // answers, as long as the invoice was actually signed and sent (CDC/QR persisted).
    const prep = await request.post(
      `${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-with-status/PENDING_VERIFICATION`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await page.reload();
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    row = page.locator("tbody").getByRole("row").filter({ hasText: client.fullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "View" }).click();

    const section = page.getByTestId("sifen-status-section");
    await expect(section).toBeVisible();
    await expect(section.getByText("Pending verification", { exact: true })).toBeVisible();

    // RT-28: the pending-validation note renders alongside the download button.
    await expect(page.getByTestId("sifen-kude-pending-validation-note")).toBeVisible();

    const downloadButton = page.getByTestId("sifen-kude-download-button");
    await expect(downloadButton).toBeVisible();

    const [download, kudeResponse] = await Promise.all([
      page.waitForEvent("download"),
      page.waitForResponse(
        (r) => r.url().includes("/sifen/kude") && r.request().method() === "GET",
      ),
      downloadButton.click(),
    ]);
    expect(kudeResponse.ok(), await kudeResponse.text()).toBeTruthy();
    expect(kudeResponse.headers()["content-type"]).toContain("application/pdf");
    expect(download.suggestedFilename()).toMatch(/^KUDE-.*\.pdf$/);
  });

  test("HU-08 · RT-20 el KuDE ya es descargable apenas la factura queda en cola (QUEUED)", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU08d ${Date.now()}`);

    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 60000,
        },
      ],
      payments: [{ method: "CASH", amount: 60000 }],
    });

    // RT-20 (Hardening_SIFEN.md): fabricates the "signed, not yet transmitted" state
    // prepareAndSign leaves an invoice in — the CDC/QR already exist, so the KuDE must already be
    // deliverable, before any transmit attempt to SIFEN ever happens.
    const prep = await request.post(
      `${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-with-status/QUEUED`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    const row = page.locator("tbody").getByRole("row").filter({ hasText: client.fullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "View" }).click();

    const section = page.getByTestId("sifen-status-section");
    await expect(section).toBeVisible();
    await expect(section.getByText("Queued", { exact: true })).toBeVisible();
    await expect(page.getByTestId("sifen-submission-in-progress-note")).toBeVisible();
    await expect(page.getByTestId("sifen-check-status-button")).toHaveCount(0);

    await expect(page.getByTestId("sifen-kude-pending-validation-note")).toBeVisible();
    const downloadButton = page.getByTestId("sifen-kude-download-button");
    await expect(downloadButton).toBeVisible();

    const [download, kudeResponse] = await Promise.all([
      page.waitForEvent("download"),
      page.waitForResponse(
        (r) => r.url().includes("/sifen/kude") && r.request().method() === "GET",
      ),
      downloadButton.click(),
    ]);
    expect(kudeResponse.ok(), await kudeResponse.text()).toBeTruthy();
    expect(download.suggestedFilename()).toMatch(/^KUDE-.*\.pdf$/);
  });

  test("HU-08 · RT-28 una vez aprobada, el KuDE ya no muestra la nota de validación pendiente", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU08c ${Date.now()}`);

    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 60000,
        },
      ],
      payments: [{ method: "CASH", amount: 60000 }],
    });

    const prep = await request.post(
      `${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    const row = page.locator("tbody").getByRole("row").filter({ hasText: client.fullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "View" }).click();

    await expect(page.getByTestId("sifen-kude-download-button")).toBeVisible();
    await expect(page.getByTestId("sifen-kude-pending-validation-note")).toHaveCount(0);
  });

  test("HU-08 · AC-17 el KuDE puede enviarse por correo electrónico desde la pantalla de detalle", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU08b ${Date.now()}`);

    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 45000,
        },
      ],
      payments: [{ method: "CASH", amount: 45000 }],
    });

    const prep = await request.post(
      `${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    const row = page.locator("tbody").getByRole("row").filter({ hasText: client.fullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "View" }).click();

    await expect(page.getByTestId("sifen-kude-download-button")).toBeVisible();

    // Issue #161: KuDE-by-email now lives under its own solapa in the invoice detail modal.
    await page.getByTestId("sifen-tab-email").click();
    await page.getByLabel("Email address").fill("cliente-e2e@example.com");
    const sendButton = page.getByTestId("sifen-kude-send-email-button");

    const [emailResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/sifen/kude/email") && r.request().method() === "POST",
      ),
      sendButton.click(),
    ]);
    // The success response is 204 No Content — reading .text() on it throws in some browsers.
    expect(emailResponse.status()).toBe(204);
    await expect(page.getByTestId("sifen-kude-email-success")).toBeVisible({ timeout: 15_000 });
  });
});
