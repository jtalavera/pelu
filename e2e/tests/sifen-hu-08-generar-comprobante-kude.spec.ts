import { expect, test } from "@playwright/test";
import { goToInvoiceHistory, openInvoiceMainTab, openInvoicePanel, openInvoiceSifenTab, searchInvoiceHistory } from "../fixtures/billing";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  setTenantFeatureFlag,
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

const DEMO_TENANT_ID = 1;
const SIFEN_FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";

test.describe("SIFEN HU-08 · Generar el comprobante en PDF (KuDE) de una factura aprobada", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    // Every state this file exercises (QUEUED/APPROVED/CDC/QR) is fabricated directly via
    // /api/admin/sifen-test-support (which sets up its own certificate/issuer data — see
    // prepareWithQrAndStatus's ensureFullIssuerData) — invoice creation below must stay a plain,
    // non-SIFEN issuance (flag off), not a real signed submission: with the flag on (inherited
    // ambiently from earlier specs in this alphabetical block) POST /api/invoices enqueues a
    // genuine async transmit attempt that races the fabrication calls and can flip
    // sifenSubmissionStatus out from under a test.
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, false);
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
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    let row = page.locator('[data-testid^="invoice-history-row-"]').filter({ hasText: client.fullName }).filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

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
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    row = page.locator('[data-testid^="invoice-history-row-"]').filter({ hasText: client.fullName }).filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await openInvoiceSifenTab(page);
    const section = page.getByTestId("sifen-status-section");
    await expect(section.getByText("Pending verification", { exact: true })).toBeVisible();

    // The KuDE download lives on the detail's "Invoice" tab.
    await openInvoiceMainTab(page);
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

  test("KuDE de muestra estilo producción: descarga un PDF con prefijo MUESTRA- (solo ambiente de prueba)", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU08-muestra ${Date.now()}`);

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
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page.locator('[data-testid^="invoice-history-row-"]').filter({ hasText: client.fullName }).filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    // The e2e backend connects to SIFEN's test environment, so the sample button is offered.
    // Redesign: it lives in the "⋯" menu of the invoice detail.
    await page.getByTestId("invoice-more-actions-button").click();
    const sampleButton = page.getByTestId("sifen-kude-sample-download-button");
    await expect(sampleButton).toBeVisible();
    await expect(page.getByTestId("sifen-kude-sample-hint")).toBeVisible();

    const [download, sampleResponse] = await Promise.all([
      page.waitForEvent("download"),
      page.waitForResponse(
        (r) => r.url().includes("/sifen/kude?sample=true") && r.request().method() === "GET",
      ),
      sampleButton.click(),
    ]);
    expect(sampleResponse.ok(), await sampleResponse.text()).toBeTruthy();
    expect(sampleResponse.headers()["content-type"]).toContain("application/pdf");
    expect(download.suggestedFilename()).toMatch(/^MUESTRA-KUDE-.*\.pdf$/);
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
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page.locator('[data-testid^="invoice-history-row-"]').filter({ hasText: client.fullName }).filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await openInvoiceSifenTab(page);
    const section = page.getByTestId("sifen-status-section");
    await expect(section.getByText("Queued", { exact: true })).toBeVisible();
    await expect(page.getByTestId("sifen-submission-in-progress-note")).toBeVisible();
    await expect(page.getByTestId("sifen-check-status-button")).toHaveCount(0);

    // The KuDE download lives on the detail's "Invoice" tab.
    await openInvoiceMainTab(page);
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
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page.locator('[data-testid^="invoice-history-row-"]').filter({ hasText: client.fullName }).filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

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
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page.locator('[data-testid^="invoice-history-row-"]').filter({ hasText: client.fullName }).filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(page.getByTestId("sifen-kude-download-button")).toBeVisible();

    // KuDE-by-email lives in the invoice detail's "SIFEN" tab.
    await openInvoicePanel(page, "share");
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

  test("Issue #215 · el botón «Enviar por WhatsApp» aparece junto al de email dentro de «Compartir KuDE por mail o WhatsApp» y en escritorio abre WhatsApp Web directo (sin la página «app o web») sin contacto preseleccionado cuando el cliente no tiene celular", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU08whatsapp ${Date.now()}`);

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
            unitPrice: 45000,
          },
        ],
        payments: [{ method: "CASH", amount: 45000 }],
      },
    );

    const prep = await request.post(
      `${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    // Stub `window.open` so the test asserts the exact WhatsApp URL/text instead of actually
    // navigating to an external site.
    await page.addInitScript(() => {
      (window as unknown as { __whatsappOpenCalls: string[] }).__whatsappOpenCalls = [];
      window.open = ((url?: string | URL, target?: string) => {
        (window as unknown as { __whatsappOpenCalls: string[] }).__whatsappOpenCalls.push(
          String(url ?? ""),
        );
        (window as unknown as { __whatsappOpenTargets: string[] }).__whatsappOpenTargets = [
          ...((window as unknown as { __whatsappOpenTargets?: string[] }).__whatsappOpenTargets ??
            []),
          String(target ?? ""),
        ];
        return null;
      }) as typeof window.open;
    });

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page.locator('[data-testid^="invoice-history-row-"]').filter({ hasText: client.fullName }).filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(page.getByTestId("sifen-kude-download-button")).toBeVisible();

    // Same section as the email action (SIFEN tab) — the WhatsApp button sits right next to "Send".
    // Playwright runs the app in English (see playwright.config.ts `locale: "en-US"`).
    await openInvoicePanel(page, "share");
    const shareSection = page.getByTestId("sifen-tab-email");
    await expect(shareSection.getByRole("heading", { name: "Share KuDE by email or WhatsApp" })).toBeVisible();
    await expect(page.getByTestId("sifen-kude-send-email-button")).toBeVisible();
    const whatsappButton = page.getByTestId("sifen-kude-send-whatsapp-button");
    await expect(whatsappButton).toBeVisible();

    // Downloads the KuDE (same PDF the email/download flow already fetches) and opens a
    // prefilled WhatsApp Web link. No success box is shown afterwards (removed — the download and the
    // WhatsApp tab opening are themselves the confirmation).
    const [download, kudeResponse] = await Promise.all([
      page.waitForEvent("download"),
      page.waitForResponse(
        (r) => r.url().includes("/sifen/kude") && r.request().method() === "GET",
      ),
      whatsappButton.click(),
    ]);
    expect(kudeResponse.ok(), await kudeResponse.text()).toBeTruthy();
    expect(download.suggestedFilename()).toMatch(/^KUDE-.*\.pdf$/);
    await expect(page.getByTestId("sifen-kude-whatsapp-success")).toHaveCount(0);

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __whatsappOpenCalls: string[] }).__whatsappOpenCalls.length,
        ),
      )
      .toBeGreaterThan(0);

    const openCalls = await page.evaluate(
      () => (window as unknown as { __whatsappOpenCalls: string[] }).__whatsappOpenCalls,
    );
    // Desktop goes straight to WhatsApp Web — wa.me would show the "open app / use WhatsApp Web"
    // chooser page first.
    expect(openCalls[0]).toContain("https://web.whatsapp.com/send?text=");
    // Named window (not `_blank`) so repeated sends reuse the same WhatsApp Web tab.
    const openTargets = await page.evaluate(
      () => (window as unknown as { __whatsappOpenTargets: string[] }).__whatsappOpenTargets,
    );
    expect(openTargets[0]).toBe("femme-whatsapp");
    const decodedMessage = decodeURIComponent(openCalls[0].split("text=")[1]);
    expect(decodedMessage).toContain(client.fullName);
    expect(decodedMessage).toContain(invoice.invoiceNumberFormatted);
    // Money-format convention: dot-separator, no decimals (e.g. "Gs. 45.000"), never "45,000.00".
    expect(decodedMessage).toMatch(/Gs\.\s?45\.000\b/);
  });

  test("Issue #215 follow-up · con celular cargado en el cliente, «Enviar por WhatsApp» abre el chat de ese contacto en WhatsApp Web (phone=595…)", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(
      request,
      token,
      `E2E HU08whatsappTel ${Date.now()}`,
      "0981123456",
    );

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
            unitPrice: 45000,
          },
        ],
        payments: [{ method: "CASH", amount: 45000 }],
      },
    );

    const prep = await request.post(
      `${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await page.addInitScript(() => {
      (window as unknown as { __whatsappOpenCalls: string[] }).__whatsappOpenCalls = [];
      window.open = ((url?: string | URL, target?: string) => {
        (window as unknown as { __whatsappOpenCalls: string[] }).__whatsappOpenCalls.push(
          String(url ?? ""),
        );
        (window as unknown as { __whatsappOpenTargets: string[] }).__whatsappOpenTargets = [
          ...((window as unknown as { __whatsappOpenTargets?: string[] }).__whatsappOpenTargets ??
            []),
          String(target ?? ""),
        ];
        return null;
      }) as typeof window.open;
    });

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page.locator('[data-testid^="invoice-history-row-"]').filter({ hasText: client.fullName }).filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await openInvoicePanel(page, "share");
    const whatsappButton = page.getByTestId("sifen-kude-send-whatsapp-button");
    await expect(whatsappButton).toBeVisible();

    await Promise.all([
      page.waitForEvent("download"),
      page.waitForResponse((r) => r.url().includes("/sifen/kude") && r.request().method() === "GET"),
      whatsappButton.click(),
    ]);

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __whatsappOpenCalls: string[] }).__whatsappOpenCalls.length,
        ),
      )
      .toBeGreaterThan(0);

    const openCalls = await page.evaluate(
      () => (window as unknown as { __whatsappOpenCalls: string[] }).__whatsappOpenCalls,
    );
    // "0981123456" (local, leading 0) -> "595981123456" (country code 595, no leading 0).
    expect(openCalls[0]).toContain("https://web.whatsapp.com/send?phone=595981123456&text=");
  });

  test.describe("Issue #215 follow-up · en el celular", () => {
    // Only the UA matters: the app picks the mobile WhatsApp flow from navigator.userAgent, and
    // keeping the desktop viewport keeps the billing history layout the other tests navigate.
    test.use({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
    });

    async function openApprovedInvoiceShareTab(
      page: import("@playwright/test").Page,
      request: import("@playwright/test").APIRequestContext,
      clientLabel: string,
    ) {
      const token = await loginAsDemoApi(request);
      const seed = await seedCategoryServiceProfessional(request, token);
      // Phones are unique per tenant — random 09xx number so reruns never collide.
      const phone = `098${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
      const client = await seedClient(request, token, `${clientLabel} ${Date.now()}`, phone);
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
              unitPrice: 45000,
            },
          ],
          payments: [{ method: "CASH", amount: 45000 }],
        },
      );
      const prep = await request.post(
        `${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`,
      );
      expect(prep.ok(), await prep.text()).toBeTruthy();

      await loginAsDemo(page);
      await page.goto("/app/billing");
      await goToInvoiceHistory(page);
      await searchInvoiceHistory(page, client.fullName);
      const row = page.locator('[data-testid^="invoice-history-row-"]').filter({ hasText: client.fullName }).filter({ visible: true });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();
      await openInvoicePanel(page, "share");
      return { client, invoice, phone };
    }

    test("comparte el PDF del KuDE ya adjunto con el menú de compartir del sistema (sin descarga ni pestaña nueva)", async ({
      page,
      request,
    }) => {
      test.setTimeout(60_000);
      await page.addInitScript(() => {
        const w = window as unknown as {
          __shareCalls: { name: string; type: string; text: string }[];
          __whatsappOpenCalls: string[];
        };
        w.__shareCalls = [];
        w.__whatsappOpenCalls = [];
        Object.defineProperty(navigator, "canShare", {
          configurable: true,
          value: (data?: ShareData) => Boolean(data?.files?.length),
        });
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: async (data: ShareData) => {
            const f = data.files![0];
            w.__shareCalls.push({ name: f.name, type: f.type, text: data.text ?? "" });
          },
        });
        window.open = ((url?: string | URL) => {
          w.__whatsappOpenCalls.push(String(url ?? ""));
          return null;
        }) as typeof window.open;
      });

      const { client, invoice } = await openApprovedInvoiceShareTab(page, request, "E2E HU08waShare");

      let downloaded = false;
      page.on("download", () => {
        downloaded = true;
      });
      await page.getByTestId("sifen-kude-send-whatsapp-button").click();

      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { __shareCalls: unknown[] }).__shareCalls.length),
        )
        .toBe(1);
      const [shared] = await page.evaluate(
        () =>
          (window as unknown as { __shareCalls: { name: string; type: string; text: string }[] })
            .__shareCalls,
      );
      expect(shared.name).toMatch(/^KUDE-.*\.pdf$/);
      expect(shared.type).toBe("application/pdf");
      expect(shared.text).toContain(client.fullName);
      expect(shared.text).toContain(invoice.invoiceNumberFormatted);
      expect(shared.text).toMatch(/Gs\.\s?45\.000\b/);

      await expect(page.getByTestId("sifen-kude-send-whatsapp-button")).toBeEnabled();
      expect(downloaded).toBe(false);
      expect(
        await page.evaluate(
          () => (window as unknown as { __whatsappOpenCalls: string[] }).__whatsappOpenCalls,
        ),
      ).toEqual([]);
    });

    test("si el navegador no puede compartir archivos, descarga el KuDE y abre la app con wa.me", async ({
      page,
      request,
    }) => {
      test.setTimeout(60_000);
      await page.addInitScript(() => {
        const w = window as unknown as { __whatsappOpenCalls: string[]; __whatsappOpenTargets: string[] };
        w.__whatsappOpenCalls = [];
        w.__whatsappOpenTargets = [];
        Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined });
        Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
        window.open = ((url?: string | URL, target?: string) => {
          w.__whatsappOpenCalls.push(String(url ?? ""));
          w.__whatsappOpenTargets.push(String(target ?? ""));
          return null;
        }) as typeof window.open;
      });

      const { phone } = await openApprovedInvoiceShareTab(page, request, "E2E HU08waFallback");

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId("sifen-kude-send-whatsapp-button").click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/^KUDE-.*\.pdf$/);

      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { __whatsappOpenCalls: string[] }).__whatsappOpenCalls.length,
          ),
        )
        .toBeGreaterThan(0);
      const { calls, targets } = await page.evaluate(() => {
        const w = window as unknown as { __whatsappOpenCalls: string[]; __whatsappOpenTargets: string[] };
        return { calls: w.__whatsappOpenCalls, targets: w.__whatsappOpenTargets };
      });
      // On a phone wa.me hands off to the installed WhatsApp app.
      expect(calls[0]).toContain(`https://wa.me/595${phone.slice(1)}?text=`);
      expect(targets[0]).toBe("_blank");
    });
  });

  test("Issue #167 · AC1 el campo de correo se precarga con el email del cliente si está cargado", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const clientEmail = `e2e167-${Date.now()}@example.com`;
    const client = await apiPostJson<{ id: number; fullName: string }>(request, token, "/api/clients", {
      fullName: `E2E167 ConEmail ${Date.now()}`,
      phone: null,
      email: clientEmail,
      ruc: null,
    });

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
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page.locator('[data-testid^="invoice-history-row-"]').filter({ hasText: client.fullName }).filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await openInvoicePanel(page, "share");
    await expect(page.getByLabel("Email address")).toHaveValue(clientEmail);
  });

  test("Issue #167 · AC1 el campo de correo queda vacío si el cliente no tiene email cargado", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E167 SinEmail ${Date.now()}`);

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
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page.locator('[data-testid^="invoice-history-row-"]').filter({ hasText: client.fullName }).filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await openInvoicePanel(page, "share");
    await expect(page.getByLabel("Email address")).toHaveValue("");
  });
});
