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
// HU-10 is this integration's first event-registration interaction (cancellation, `rGeVeCan`).
// AC-01/AC-02 (gating + countdown) and AC-03/AC-04/AC-05 (approved/rejected/history rendering) are
// all UI-surfaced, so they're covered here — using the new `prepare-with-status-hours-ago` and
// `fabricate-cancellation-result` test-support endpoints to fabricate each state directly, the same
// pattern HU-08/HU-09 already used for their own preconditions. One test additionally drives the
// real cancel button/form end-to-end against the real backend (signing + a real network attempt to
// the events endpoint) — in the `e2e` profile that endpoint is unreachable by design (see
// application-e2e.properties), so this exercises the genuine "SIFEN did not respond" error path,
// same precedent as HU-07's own Playwright coverage of its "no answer" branch.

test.describe("SIFEN HU-10 · Cancelar una factura ya aprobada", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  async function createInvoice(request: APIRequestContext, token: string) {
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU10 ${Date.now()}-${Math.random()}`);
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
    const row = page.locator("tbody").getByRole("row").filter({ hasText: clientFullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "View" }).click();
  }

  async function prepareApprovedHoursAgo(request: APIRequestContext, invoiceId: number, hoursAgo: number) {
    const res = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoiceId}/prepare-with-status-hours-ago/APPROVED/${hoursAgo}`,
    );
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  async function fabricateCancellationResult(
    request: APIRequestContext,
    invoiceId: number,
    approved: boolean,
  ) {
    const res = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoiceId}/fabricate-cancellation-result/${approved}`,
    );
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  test("HU-10 · AC-01 sin verificación SIFEN previa no existe la opción de cancelar", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);
    void invoice;

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await expect(page.getByTestId("sifen-cancel-button")).toHaveCount(0);
  });

  test("HU-10 · AC-01 una factura pendiente de verificación tampoco ofrece cancelar", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);

    const res = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-for-status-check`,
    );
    expect(res.ok(), await res.text()).toBeTruthy();

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await expect(page.getByTestId("sifen-status-section")).toBeVisible();
    await expect(page.getByTestId("sifen-cancel-button")).toHaveCount(0);
  });

  test("HU-10 · AC-01/AC-02 factura aprobada dentro del plazo: muestra el tiempo restante y el botón habilitado", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);
    await prepareApprovedHoursAgo(request, invoice.id, 1);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    // Issue #161: cancellation now lives under its own solapa in the invoice detail modal.
    await page.getByTestId("sifen-tab-cancel").click();
    await expect(page.getByTestId("sifen-cancel-deadline-remaining")).toBeVisible();
    await expect(page.getByTestId("sifen-cancel-deadline-remaining")).toContainText(
      /\d+h \d+m left/,
    );
    const button = page.getByTestId("sifen-cancel-button");
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
  });

  test("HU-10 · AC-02 pasado el plazo de 48hs la opción queda deshabilitada con una explicación visible", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);
    await prepareApprovedHoursAgo(request, invoice.id, 50);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await page.getByTestId("sifen-tab-cancel").click();
    await expect(page.getByTestId("sifen-cancel-deadline-expired")).toBeVisible();
    await expect(page.getByTestId("sifen-cancel-deadline-expired")).toContainText(
      "48-hour window",
    );
    const button = page.getByTestId("sifen-cancel-button");
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
  });

  test("HU-10 · AC-03/AC-05 SIFEN aprueba la cancelación: pasa a Cancelled y queda el registro histórico", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);
    await prepareApprovedHoursAgo(request, invoice.id, 1);
    await fabricateCancellationResult(request, invoice.id, true);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await expect(page.getByTestId("sifen-status-section").getByText("Cancelled")).toBeVisible();
    await expect(page.getByTestId("sifen-cancel-button")).toHaveCount(0);

    await page.getByTestId("sifen-tab-cancel").click();
    const history = page.getByTestId("sifen-cancellation-history");
    await expect(history).toBeVisible();
    await expect(history).toContainText("isabelzymanscki@gmail.com");
    await expect(history).toContainText("Error en el monto facturado al cliente");
  });

  test("Issue #145 · una cancelación aprobada por SIFEN también anula el comprobante", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);
    await prepareApprovedHoursAgo(request, invoice.id, 1);
    await fabricateCancellationResult(request, invoice.id, true);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    // The merged action voids the invoice record too, not just the SIFEN submission.
    await expect(page.getByTestId("invoice-status-badge")).toHaveText("Voided");
    // The standalone "Anular comprobante" action must not appear alongside the SIFEN outcome.
    await expect(page.getByRole("button", { name: "Void invoice" })).toHaveCount(0);
  });

  test("Issue #145 · el botón standalone 'Anular comprobante' no aparece mientras la cancelación en SIFEN está disponible", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);
    await prepareApprovedHoursAgo(request, invoice.id, 1);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await page.getByTestId("sifen-tab-cancel").click();
    await expect(page.getByTestId("sifen-cancel-button")).toBeVisible();
    await expect(page.getByRole("button", { name: "Void invoice" })).toHaveCount(0);
  });

  test("Issue #145 · la cancelación aprobada anula el comprobante incluso con la caja ya cerrada", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);
    await prepareApprovedHoursAgo(request, invoice.id, 1);
    await apiPostJson(request, token, "/api/cash-sessions/close", { countedCashAmount: 0 });
    await fabricateCancellationResult(request, invoice.id, true);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    // The cash session being closed would normally block a plain void
    // (CASH_SESSION_CLOSED_CANNOT_VOID) — the merged SIFEN-cancel flow bypasses that guard.
    await expect(page.getByTestId("invoice-status-badge")).toHaveText("Voided");
  });

  test("Issue #145 · cancelar en SIFEN inmediatamente después de la aprobación queda bloqueado con un mensaje claro", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);
    await prepareApprovedHoursAgo(request, invoice.id, 0);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await page.getByTestId("sifen-tab-cancel").click();
    await expect(page.getByTestId("sifen-cancel-too-soon")).toBeVisible();
    await expect(page.getByTestId("sifen-cancel-button")).toBeDisabled();
  });

  test("HU-10 · AC-04 SIFEN rechaza la cancelación: muestra el motivo y mantiene el estado anterior", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);
    await prepareApprovedHoursAgo(request, invoice.id, 1);
    await fabricateCancellationResult(request, invoice.id, false);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    // Status is untouched — still Approved, not Cancelled.
    await expect(page.getByTestId("sifen-status-section").getByText("Approved", { exact: true })).toBeVisible();
    await page.getByTestId("sifen-tab-cancel").click();
    await expect(page.getByTestId("sifen-cancellation-rejected")).toBeVisible();
    await expect(page.getByTestId("sifen-cancellation-rejected")).toContainText(
      "Plazo de solicitud de cancelación de una FE extemporáneo",
    );
    // AC-01/AC-02: since it's still Approved and within the window, cancelling can still be retried.
    await expect(page.getByTestId("sifen-cancel-button")).toBeVisible();
  });

  test("HU-10 · flujo real end-to-end: SIFEN no responde en el ambiente e2e y la factura queda sin cambios", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);
    await prepareApprovedHoursAgo(request, invoice.id, 1);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await page.getByTestId("sifen-tab-cancel").click();
    await page.getByTestId("sifen-cancel-button").click();
    await page
      .getByLabel("Cancellation reason")
      .fill("Error en el monto facturado al cliente durante la prueba automatizada");
    await page.getByTestId("sifen-cancel-confirm-button").click();

    await expect(page.getByText("SIFEN did not respond to the cancellation request.")).toBeVisible({
      timeout: 30_000,
    });
    // The invoice must remain Approved — no ambiguous partial state.
    await expect(page.getByTestId("sifen-status-section").getByText("Approved", { exact: true })).toBeVisible();
  });

  test("HU-10 · valida que el motivo tenga al menos 5 caracteres antes de enviar", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);
    await prepareApprovedHoursAgo(request, invoice.id, 1);

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await page.getByTestId("sifen-tab-cancel").click();
    await page.getByTestId("sifen-cancel-button").click();
    await page.getByLabel("Cancellation reason").fill("abcd");
    await page.getByTestId("sifen-cancel-confirm-button").click();

    await expect(page.getByText("Enter at least 5 characters")).toBeVisible();
  });
});
