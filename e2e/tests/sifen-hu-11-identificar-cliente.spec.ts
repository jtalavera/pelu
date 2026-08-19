import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiBaseUrl,
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
// HU-11 is this integration's second event-registration interaction (after HU-10's cancellation) —
// the "Evento de Nominación" (rGEveNom), used to identify the client on an invoice that was issued
// without one. AC-01 (gating), AC-02/AC-03/AC-04 (form + validation) and AC-05/AC-06 (approved/
// rejected history rendering) are all UI-surfaced, so they're covered here — using the new
// `fabricate-client-identification-result` test-support endpoint to fabricate each outcome directly,
// same pattern HU-10 used for its own cancellation outcomes. One test additionally drives the real
// form end-to-end against the real backend (signing + a real network attempt to the events
// endpoint) — in the `e2e` profile that endpoint is unreachable by design, so this exercises the
// genuine "SIFEN did not respond" error path, same precedent as HU-07/HU-10's own coverage.

test.describe("SIFEN HU-11 · Identificar al cliente en una factura sin datos", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  /** An invoice issued for a client without RUC/identity document — SIFEN's "sin datos" case. */
  async function createInvoiceWithoutClientData(request: APIRequestContext, token: string) {
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU11 ${Date.now()}-${Math.random()}`);
    const invoice = await apiPostJson<{ id: number; invoiceNumberFormatted: string }>(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 55000,
        },
      ],
      payments: [{ method: "CASH", amount: 55000 }],
    });
    return { invoice, client };
  }

  /** An invoice issued for a client that already has a RUC — not eligible for AC-01. */
  async function createInvoiceWithClientRuc(request: APIRequestContext, token: string) {
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(
      request,
      token,
      `E2E HU11 conRuc ${Date.now()}-${Math.random()}`,
      undefined,
      "80000005-6",
    );
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
          unitPrice: 55000,
        },
      ],
      payments: [{ method: "CASH", amount: 55000 }],
    });
    return { invoice, client };
  }

  async function openInvoiceDetail(page: Page, clientFullName: string) {
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(clientFullName);
    const row = page.locator("tbody tr[role=\"button\"]").filter({ hasText: clientFullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
  }

  async function prepareAsApproved(request: APIRequestContext, invoiceId: number) {
    const res = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoiceId}/prepare-as-approved`,
    );
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  async function fabricateIdentificationResult(
    request: APIRequestContext,
    invoiceId: number,
    approved: boolean,
  ) {
    const res = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoiceId}/fabricate-client-identification-result/${approved}`,
    );
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  /**
   * Real signing (the end-to-end test below) requires a valid certificate for the demo tenant —
   * normally seeded incidentally by other SIFEN e2e specs that run earlier against the same shared
   * H2 instance. Running this spec file alone doesn't get that for free, so it's ensured explicitly.
   */
  async function ensureValidCertificate(request: APIRequestContext) {
    const res = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`,
    );
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  test("HU-11 · AC-01 factura aprobada sin datos del cliente ofrece identificar", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoiceWithoutClientData(request, token);
    await prepareAsApproved(request, invoice.id);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    // Issue #161: client identification now lives under its own solapa in the invoice detail modal.
    // Issue #167 AC3: the form now renders directly in the accordion body — no separate trigger
    // button anymore; opening the section is enough to see the whole form and its fields.
    await page.getByTestId("sifen-tab-identify").click();
    await expect(page.getByTestId("sifen-identify-client-button")).toHaveCount(0);
    await expect(page.getByTestId("sifen-identify-client-confirm-button")).toBeVisible();
    await expect(page.locator("#identify-client-name")).toBeVisible();
  });

  test("HU-11 · AC-01 una factura no aprobada no ofrece identificar", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoiceWithoutClientData(request, token);
    void invoice;

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await expect(page.getByTestId("sifen-identify-client-confirm-button")).toHaveCount(0);
  });

  test("HU-11 · AC-01 una factura aprobada que ya tiene datos del cliente no ofrece identificar", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoiceWithClientRuc(request, token);
    await prepareAsApproved(request, invoice.id);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await expect(page.getByTestId("sifen-identify-client-confirm-button")).toHaveCount(0);
  });

  test("HU-11 · AC-01 una factura ya identificada no vuelve a ofrecer la opción", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const { invoice } = await createInvoiceWithoutClientData(request, token);
    await prepareAsApproved(request, invoice.id);
    // AC-05 overwrites clientDisplayName to the identified client's name — search by the stable
    // invoice number instead, since the client's own name is no longer a reliable search key here.
    await fabricateIdentificationResult(request, invoice.id, true);

    await loginAsDemo(page);
    await openInvoiceDetail(page, invoice.invoiceNumberFormatted);

    await expect(page.getByTestId("sifen-identify-client-confirm-button")).toHaveCount(0);
    await page.getByTestId("sifen-tab-identify").click();
    await expect(page.getByTestId("sifen-client-identification-history")).toBeVisible();
  });

  test("HU-11 · AC-05 SIFEN aprueba la identificación: queda el registro histórico", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const { invoice } = await createInvoiceWithoutClientData(request, token);
    await prepareAsApproved(request, invoice.id);
    await fabricateIdentificationResult(request, invoice.id, true);

    await loginAsDemo(page);
    await openInvoiceDetail(page, invoice.invoiceNumberFormatted);

    await page.getByTestId("sifen-tab-identify").click();
    const history = page.getByTestId("sifen-client-identification-history");
    await expect(history).toBeVisible();
    await expect(history).toContainText("isabelzymanscki@gmail.com");
    await expect(history).toContainText("María Fernanda Duarte");
    await expect(history).toContainText("4123456");
  });

  test("HU-11 · AC-06 SIFEN rechaza la identificación: muestra el motivo y la opción sigue disponible", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoiceWithoutClientData(request, token);
    await prepareAsApproved(request, invoice.id);
    await fabricateIdentificationResult(request, invoice.id, false);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await page.getByTestId("sifen-tab-identify").click();
    await expect(page.getByTestId("sifen-client-identification-rejected")).toBeVisible();
    await expect(page.getByTestId("sifen-client-identification-rejected")).toContainText(
      "Datos del receptor inconsistentes",
    );
    // AC-01: rejection doesn't lock out further attempts.
    await expect(page.getByTestId("sifen-identify-client-confirm-button")).toBeVisible();
  });

  test("HU-11 · AC-02/AC-03 empresa sin RUC válido muestra un error de validación", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoiceWithoutClientData(request, token);
    await prepareAsApproved(request, invoice.id);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await page.getByTestId("sifen-tab-identify").click();
    await page.locator("#identify-client-name").fill("Comercial ABC S.A.");
    await page.getByLabel("Company").click();
    await page.locator("#identify-client-ruc").fill("not-a-ruc");
    await page.getByTestId("sifen-identify-client-confirm-button").click();

    await expect(
      page.getByText("Enter a valid RUC. Format: digits, hyphen, digits (e.g. 80000005-6)."),
    ).toBeVisible();
  });

  test("HU-11 · AC-04 cliente del exterior sin dirección ni país muestra errores de validación", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoiceWithoutClientData(request, token);
    await prepareAsApproved(request, invoice.id);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await page.getByTestId("sifen-tab-identify").click();
    await page.locator("#identify-client-name").fill("John Smith");
    await page.getByLabel("Client from abroad").click();
    await page.locator("#identify-client-document").fill("AB123456");
    await page.getByTestId("sifen-identify-client-confirm-button").click();

    await expect(page.getByText("Select a country.")).toBeVisible();
    await expect(page.getByText("Enter the client's address.")).toBeVisible();
  });

  test("HU-11 · AC-02 el nombre es obligatorio", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoiceWithoutClientData(request, token);
    await prepareAsApproved(request, invoice.id);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await page.getByTestId("sifen-tab-identify").click();
    await page.locator("#identify-client-document").fill("4123456");
    await page.getByTestId("sifen-identify-client-confirm-button").click();

    await expect(page.getByText("Enter the client's name or business name.")).toBeVisible();
  });

  test("HU-11 · flujo real end-to-end: SIFEN no responde en el ambiente e2e y la factura queda sin cambios", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoiceWithoutClientData(request, token);
    await prepareAsApproved(request, invoice.id);
    await ensureValidCertificate(request);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await page.getByTestId("sifen-tab-identify").click();
    await page.locator("#identify-client-name").fill("María Fernanda Duarte");
    await page.locator("#identify-client-document").fill("4123456");
    await page.getByTestId("sifen-identify-client-confirm-button").click();

    await expect(
      page.getByText("SIFEN did not respond to the client identification request."),
    ).toBeVisible({ timeout: 60_000 });
    // No ambiguous partial state — the form stays open for retry (same pattern as HU-10's own
    // cancel form), and reloading confirms the invoice was never actually marked identified.
    await expect(page.getByTestId("sifen-identify-client-confirm-button")).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    const row = page.locator("tbody tr[role=\"button\"]").filter({ hasText: client.fullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await page.getByTestId("sifen-tab-identify").click();
    await expect(page.getByTestId("sifen-identify-client-confirm-button")).toBeVisible();
  });
});
