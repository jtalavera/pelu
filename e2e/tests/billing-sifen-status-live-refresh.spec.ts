import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiBaseUrl,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// Billing tables (Caja → today's invoices, and Historial) and the invoice detail dialog refresh an invoice's SIFEN status on
// their own as soon as the backend records it — no reload, no click. SIFEN statuses change in the
// backend with no user action (queue consumer, consulta-lote polling every second), so both
// tables silently re-read their page every 2s while any visible row is "En cola" or "Pendiente de
// verificación" (useSifenStatusLiveRefresh); the open detail dialog re-reads its invoice the same
// way.
//
// The backend-side change is made through /api/admin/sifen-test-support (e2e profile only, SIFEN
// unreachable in e2e): simulate-batch-result runs the same mapping a real consulta-lote answer
// goes through, and prepare-with-status stands in for the queue consumer.

const DEMO_TENANT_ID = 1;
const SIFEN_FLAG = "SIFEN_ELECTRONIC_INVOICING";
/** Live refresh ticks every 2s — leave room for a couple of ticks plus the request itself. */
const LIVE_UPDATE_TIMEOUT = 10_000;

async function createInvoice(request: APIRequestContext, label: string) {
  const token = await loginAsDemoApi(request);
  const seed = await seedCategoryServiceProfessional(request, token);
  const client = await seedClient(request, token, `${label} ${Date.now()}`);
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
        unitPrice: 50000,
      },
    ],
    payments: [{ method: "CASH", amount: 50000 }],
  });
  return { invoiceId: invoice.id, clientName: client.fullName };
}

async function supportPost(request: APIRequestContext, path: string, data?: unknown) {
  const res = await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support${path}`, { data });
  expect(res.ok(), await res.text()).toBeTruthy();
}

function visibleRow(page: Page, clientName: string) {
  return page
    .locator('tbody tr[role="button"]')
    .filter({ hasText: clientName })
    .filter({ visible: true });
}

test.describe("Billing · el estado SIFEN se actualiza solo en las tablas de facturas", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    // The SIFEN state is fabricated below — issuance must stay a plain one so no real async
    // transmit races the fabrication calls (same reason as sifen-hu-07).
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG, false);
  });

  test("Caja: una factura pendiente de verificación pasa a Aprobada sin recargar cuando SIFEN aprueba el lote", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const { invoiceId, clientName } = await createInvoice(request, "E2E Live Caja");
    await supportPost(request, `/invoices/${invoiceId}/prepare-pending-in-batch/555000111`);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    const row = visibleRow(page, clientName);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("Pending verification", { exact: true })).toBeVisible();

    await supportPost(request, `/invoices/${invoiceId}/simulate-batch-result`, {
      batchResultCode: "0362",
      status: "APPROVED",
      protocolNumber: "1122334455",
      resultCode: "0260",
      message: "Autorización del DE satisfactoria",
    });

    await expect(row.getByText("Approved", { exact: true })).toBeVisible({
      timeout: LIVE_UPDATE_TIMEOUT,
    });
  });

  test("Historial: una factura pendiente de verificación pasa a Rechazada sin recargar cuando SIFEN rechaza el lote", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const { invoiceId, clientName } = await createInvoice(request, "E2E Live Hist");
    await supportPost(request, `/invoices/${invoiceId}/prepare-pending-in-batch/555000222`);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(clientName);
    const row = visibleRow(page, clientName);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("Pending verification", { exact: true })).toBeVisible();

    await supportPost(request, `/invoices/${invoiceId}/simulate-batch-result`, {
      batchResultCode: "0362",
      status: "REJECTED",
      protocolNumber: null,
      resultCode: "1264",
      message: "RUC del emisor no está habilitado para utilizar este tipo de servicio",
    });

    await expect(row.getByText("Not found / Rejected", { exact: true })).toBeVisible({
      timeout: LIVE_UPDATE_TIMEOUT,
    });
  });

  test("Historial: una factura en cola se actualiza sola cuando el backend la procesa", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const { invoiceId, clientName } = await createInvoice(request, "E2E Live Queued");
    await supportPost(request, `/invoices/${invoiceId}/prepare-with-status/QUEUED`);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(clientName);
    const row = visibleRow(page, clientName);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("Queued", { exact: true })).toBeVisible();

    await supportPost(request, `/invoices/${invoiceId}/prepare-with-status/APPROVED`);

    await expect(row.getByText("Approved", { exact: true })).toBeVisible({
      timeout: LIVE_UPDATE_TIMEOUT,
    });
  });

  test("Detalle: con el diálogo abierto, una factura pendiente de verificación pasa a Aprobada sin cerrarlo", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const { invoiceId, clientName } = await createInvoice(request, "E2E Live Modal");
    await supportPost(request, `/invoices/${invoiceId}/prepare-pending-in-batch/555000333`);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(clientName);
    const row = visibleRow(page, clientName);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const section = page.getByTestId("sifen-status-section");
    await expect(section).toBeVisible();
    await expect(section.getByText("Pending verification", { exact: true })).toBeVisible();

    await supportPost(request, `/invoices/${invoiceId}/simulate-batch-result`, {
      batchResultCode: "0362",
      status: "APPROVED",
      protocolNumber: "9988776655",
      resultCode: "0260",
      message: "Autorización del DE satisfactoria",
    });

    await expect(section.getByText("Approved", { exact: true }).first()).toBeVisible({
      timeout: LIVE_UPDATE_TIMEOUT,
    });
    await expect(section.getByText("Pending verification", { exact: true })).toHaveCount(0);
    // Once approved, the dialog offers the KuDE download — no reopen needed.
    await expect(page.getByTestId("sifen-kude-download-button")).toBeVisible();
  });
});
