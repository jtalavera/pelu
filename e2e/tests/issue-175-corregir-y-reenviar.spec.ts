import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  apiBaseUrl,
  apiGetJson,
  apiPostJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// Issue #175: correct & resend a SIFEN-rejected invoice under the same CDC.
//   - "Corregir y reenviar" appears (row button + detail-modal accordion) only for REJECTED.
//   - Correcting resends the invoice: same CDC / number, status back to QUEUED, pending
//     inutilización CANCELLED, and the invoice can then be approved.
// Same pattern as sifen-rt25: the invoice is issued WITHOUT the SIFEN feature flag (so no async
// transmit can flip the status), then /api/admin/sifen-test-support/.../simulate-sifen-rejection
// fabricates the full REJECTED SIFEN state (CDC/QR + the pending inutilización), and
// .../prepare-as-approved fabricates approval. A fixture certificate is enough for the resend's
// re-sign (correct-and-resend never needs the flag, only a valid cert).

async function ensureCertificate(request: APIRequestContext) {
  const certRes = await request.post(
    `${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`,
  );
  expect(certRes.ok(), await certRes.text()).toBeTruthy();
}

async function post(request: APIRequestContext, path: string) {
  const res = await request.post(`${apiBaseUrl()}${path}`);
  expect(res.ok(), await res.text()).toBeTruthy();
}

type InvoiceView = {
  id: number;
  sifenSubmissionStatus: string | null;
  sifenControlNumber: string | null;
  invoiceNumber: number;
  total: string;
  lines: { unitPrice: string }[];
};

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
    email: "corregir175@example.com",
    lines: [{ serviceId, description: serviceName, quantity: 1, unitPrice: 55000 }],
    payments: [{ method: "CASH", amount: 55000 }],
  });
  await post(request, `/api/admin/sifen-test-support/invoices/${inv.id}/simulate-sifen-rejection`);
  return inv.id;
}

test.describe("Issue #175 · SIFEN — corregir y reenviar una factura rechazada", () => {

  test("the detail modal's 'Corregir y reenviar' accordion is REJECTED-only", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await ensureCertificate(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const rejectedName = `E2E 175 RECHAZADA ${Date.now()}`;
    await issueRejectedInvoice(request, token, seed.serviceId, seed.serviceFullName, rejectedName);

    const okName = `E2E 175 APROBADA ${Date.now()}`;
    const okId = await issueRejectedInvoice(request, token, seed.serviceId, seed.serviceFullName, okName);
    await post(request, `/api/admin/sifen-test-support/invoices/${okId}/prepare-as-approved`);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();

    // Rejected → accordion present, and the row shows the shortcut button.
    await page.locator("#invoice-history-text-filter").fill(rejectedName);
    const rejectedRow = page
      .locator('tbody tr[role="button"]', { hasText: rejectedName })
      .first();
    await expect(rejectedRow.locator('[data-testid^="invoice-row-correct-resend-"]')).toBeVisible();
    await rejectedRow.click();
    await expect(page.getByRole("dialog").getByTestId("sifen-tab-correct-resend")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Approved → no accordion, no row button.
    await page.locator("#invoice-history-text-filter").fill(okName);
    const okRow = page.locator('tbody tr[role="button"]', { hasText: okName }).first();
    await expect(okRow).toBeVisible({ timeout: 30_000 });
    await expect(okRow.locator('[data-testid^="invoice-row-correct-resend-"]')).toHaveCount(0);
    await okRow.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByTestId("sifen-tab-correct-resend")).toHaveCount(0);
  });

  test("correcting a rejected invoice resends it under the same CDC and it can be approved", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await ensureCertificate(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const clientName = `E2E 175 CORREGIR ${Date.now()}`;
    const invoiceId = await issueRejectedInvoice(
      request,
      token,
      seed.serviceId,
      seed.serviceFullName,
      clientName,
    );

    const before = await apiGetJson<InvoiceView>(request, token, `/api/invoices/${invoiceId}`);
    expect(before.sifenSubmissionStatus).toBe("REJECTED");
    const cdcBefore = before.sifenControlNumber;
    expect(cdcBefore).toBeTruthy();

    // The pending inutilización was recorded by simulate-sifen-rejection.
    const voidingBefore = await apiGetJson<{ invoiceId: number; status: string }[]>(
      request,
      token,
      "/api/sifen/number-voiding",
    );
    expect(voidingBefore.find((v) => v.invoiceId === invoiceId)?.status).toBe("PENDING");

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(clientName);

    // Row button (visible only for REJECTED).
    const row = page.locator('tbody tr[role="button"]', { hasText: clientName }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.locator('[data-testid^="invoice-row-correct-resend-"]').click();

    // Correction form — prefilled from the rejected invoice; fix the unit price.
    const form = page.getByRole("dialog", { name: "Correct and resend" });
    // Issue #186 · AC4 — the correction form matches the ficha-de-servicio detail modal size.
    await expect(form).toHaveClass(/max-w-4xl/);
    // Issue #190 — the invoice number is in the title, and the emission date shows read-only.
    await expect(form.getByRole("heading", { name: /Correct and resend — Invoice #\d+/ })).toBeVisible();
    await expect(form.getByTestId("sifen-correct-resend-emission-date")).toBeVisible();
    const priceField = form.locator("#line-price-0");
    await expect(priceField).toHaveValue("55.000");
    await priceField.fill("60000");
    // Issue #174 AC-02: the first payment amount follows the new total.
    await expect(form.locator("#pay-amount-0")).toHaveValue("60.000");

    const [resendResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/sifen/correct-and-resend") && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      form.getByTestId("sifen-correct-resend-confirm-button").click(),
    ]);
    expect(resendResponse.ok(), await resendResponse.text()).toBeTruthy();

    // Same CDC / number, back in the pipeline.
    const after = await apiGetJson<InvoiceView>(request, token, `/api/invoices/${invoiceId}`);
    expect(after.sifenControlNumber).toBe(cdcBefore);
    expect(after.invoiceNumber).toBe(before.invoiceNumber);
    expect(["QUEUED", "PENDING_VERIFICATION"]).toContain(after.sifenSubmissionStatus);
    expect(Number(after.total)).toBe(60000);
    expect(Number(after.lines[0].unitPrice)).toBe(60000);

    // The pending inutilización was called off.
    const voidingAfter = await apiGetJson<{ invoiceId: number; status: string }[]>(
      request,
      token,
      "/api/sifen/number-voiding",
    );
    expect(voidingAfter.find((v) => v.invoiceId === invoiceId)?.status).toBe("CANCELLED");

    // And the corrected document can now be approved.
    await post(request, `/api/admin/sifen-test-support/invoices/${invoiceId}/prepare-as-approved`);
    const approved = await apiGetJson<InvoiceView>(request, token, `/api/invoices/${invoiceId}`);
    expect(approved.sifenSubmissionStatus).toBe("APPROVED");
    expect(approved.sifenControlNumber).toBe(cdcBefore);
  });

  test("the backend rejects correct-and-resend for an invoice that is not REJECTED", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await ensureCertificate(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: `E2E 175 NO RECHAZADA ${Date.now()}`,
      email: "noreject175@example.com",
      lines: [
        { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 30000 },
      ],
      payments: [{ method: "CASH", amount: 30000 }],
    });
    await post(request, `/api/admin/sifen-test-support/invoices/${inv.id}/prepare-as-approved`);

    const res = await request.post(
      `${apiBaseUrl()}/api/invoices/${inv.id}/sifen/correct-and-resend`,
      {
        headers: authHeaders(token),
        data: {
          clientId: null,
          clientDisplayName: "X",
          email: "noreject175@example.com",
          lines: [
            { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 30000 },
          ],
          payments: [{ method: "CASH", amount: 30000 }],
        },
      },
    );
    expect(res.status()).toBe(409);
    expect(await res.text()).toContain("INVOICE_NOT_REJECTED");
  });

  // Follow-up: "Anular comprobante" on a rejected invoice = inutilizar its numeración ante SIFEN,
  // and once the number is dead "Corregir y reenviar" must disappear (row + detail + backend).
  test("'Anular comprobante' de una rechazada inutiliza la numeración y bloquea corregir y reenviar", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await ensureCertificate(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const clientName = `E2E 186 ANULAR RECHAZADA ${Date.now()}`;
    const invoiceId = await issueRejectedInvoice(
      request,
      token,
      seed.serviceId,
      seed.serviceFullName,
      clientName,
    );

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(clientName);
    const row = page.locator('tbody tr[role="button"]', { hasText: clientName }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const dialog = page.getByRole("dialog");
    const resolve = dialog.getByTestId("sifen-tab-correct-resend");
    await resolve.locator("summary").click();
    await expect(resolve.getByTestId("sifen-correct-resend-button")).toBeVisible();
    await expect(resolve.getByTestId("sifen-nullify-number-button")).toBeVisible();
    // The only "Void invoice" affordance is inside this section — no generic footer button.
    await expect(dialog.getByRole("button", { name: "Void invoice", exact: true })).toHaveCount(1);

    await resolve.getByTestId("sifen-nullify-number-button").click();
    await resolve.getByLabel("Reason").fill("Venta cargada por error, no se va a reenviar");
    await resolve.getByTestId("sifen-nullify-number-confirm").click();
    // application-e2e points SIFEN at an unreachable endpoint — the synchronous submit surfaces 502.
    await expect(
      resolve.getByText("SIFEN did not respond to the voiding request. Try again shortly."),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Fabricate SIFEN approving the inutilización → the invoice is voided automatically.
    const fab = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoiceId}/fabricate-number-voiding-result/true`,
    );
    expect(fab.ok(), await fab.text()).toBeTruthy();

    const after = await apiGetJson<InvoiceView & { status: string }>(
      request,
      token,
      `/api/invoices/${invoiceId}`,
    );
    expect(after.status).toBe("VOIDED");

    // Row: no correct-resend shortcut anymore.
    await page.reload();
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(clientName);
    const row2 = page.locator('tbody tr[role="button"]', { hasText: clientName }).first();
    await expect(row2).toBeVisible({ timeout: 30_000 });
    await expect(
      row2.locator('[data-testid^="invoice-row-correct-resend-"]'),
    ).toHaveCount(0);

    // Detail: the section shows the "resolved" note instead of the actions.
    await row2.click();
    const resolve2 = page.getByRole("dialog").getByTestId("sifen-tab-correct-resend");
    await resolve2.locator("summary").click();
    await expect(resolve2.getByTestId("sifen-rejected-resolved-note")).toBeVisible();
    await expect(resolve2.getByTestId("sifen-correct-resend-button")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Backend: correct-and-resend is refused for a voided invoice.
    const resend = await request.post(
      `${apiBaseUrl()}/api/invoices/${invoiceId}/sifen/correct-and-resend`,
      {
        headers: authHeaders(token),
        data: {
          clientId: null,
          clientDisplayName: "X",
          email: "anular186@example.com",
          lines: [
            {
              serviceId: seed.serviceId,
              description: seed.serviceFullName,
              quantity: 1,
              unitPrice: 55000,
            },
          ],
          payments: [{ method: "CASH", amount: 55000 }],
        },
      },
    );
    expect(resend.status()).toBe(409);
    expect(await resend.text()).toContain("INVOICE_ALREADY_VOIDED");
  });
});
