import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiBaseUrl,
  apiGetJson,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// RT-25 (Hardening_SIFEN.md): "Inutilización de numeración" governance. SifenNumberVoidingService
// automatically records a PENDING voiding entry the moment a real transmit attempt resolves
// REJECTED (SifenSubmissionQueueListener's handleResult) — but application-e2e.properties points
// SIFEN at an unreachable endpoint, so a real e2e attempt only ever lands in PENDING_VERIFICATION
// (HU-06 AC-05's "no response" branch), never REJECTED. POST
// /api/admin/sifen-test-support/invoices/{id}/simulate-sifen-rejection fabricates that terminal
// outcome and calls the real trigger directly — see that endpoint's own javadoc. The listener→
// trigger wiring itself (only REJECTED calls it, not APPROVED/CONFLICT) is covered at the JUnit
// level in SifenSubmissionQueueListenerTest.
//
// Every test in this file shares the same demo tenant/H2 instance as every other SIFEN spec, so
// each locates its own row by the fabricated invoice's own number (range "FACTURA <n>") rather than
// assuming it's the only — or the first/last — pending row on the page.

type IssuedInvoice = { id: number };

async function createInvoice(request: APIRequestContext, token: string): Promise<IssuedInvoice> {
  const seed = await seedCategoryServiceProfessional(request, token);
  const client = await seedClient(request, token, `E2E RT25 ${Date.now()}-${Math.random()}`);
  return apiPostJson<IssuedInvoice>(request, token, "/api/invoices", {
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
}

async function rejectAndGetVoidingRow(page: Page, request: APIRequestContext, token: string) {
  const invoice = await createInvoice(request, token);
  const rejectRes = await request.post(
    `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/simulate-sifen-rejection`,
  );
  expect(rejectRes.ok(), await rejectRes.text()).toBeTruthy();
  const detail = await apiGetJson<{ invoiceNumber: number }>(
    request,
    token,
    `/api/invoices/${invoice.id}`,
  );

  await loginAsDemo(page);
  await page.goto("/app/settings/sifen");
  await expect(page.getByTestId("sifen-number-voiding-section")).toBeVisible();
  return page
    .getByTestId("sifen-number-voiding-row")
    .filter({ hasText: `FACTURA ${detail.invoiceNumber}` });
}

test.describe("RT-25 · Inutilización de numeración", () => {
  test("RT-25 · una factura rechazada por SIFEN registra automáticamente una inutilización pendiente", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);

    const row = await rejectAndGetVoidingRow(page, request, token);

    await expect(row).toBeVisible();
    await expect(row.getByText("Pending submission")).toBeVisible();
    await expect(row.getByText("Automatic")).toBeVisible();
  });

  test("RT-25 · el motivo debe tener al menos 5 caracteres antes de enviar a SIFEN", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);

    const row = await rejectAndGetVoidingRow(page, request, token);
    await row.getByLabel("Reason").fill("ab");
    await row.getByRole("button", { name: "Submit to SIFEN" }).click();

    await expect(row.getByText("Enter a reason of at least 5 characters.")).toBeVisible();
  });

  test("RT-25 · enviar a SIFEN con un motivo válido intenta la transmisión real y muestra el resultado", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    // SifenNumberVoidingService.submit signs with the tenant's real active certificate (unlike the
    // fabricated REJECTED outcome above) — needs a real one installed first, same precondition
    // sifen-hu-22's own real-signing test documents.
    await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`);

    const row = await rejectAndGetVoidingRow(page, request, token);
    await row.getByLabel("Reason").fill("Factura rechazada, numeración inutilizada por prueba e2e");
    await row.getByRole("button", { name: "Submit to SIFEN" }).click();

    // application-e2e.properties points SIFEN at an unreachable endpoint — a real synchronous
    // attempt (SifenNumberVoidingService.submit, unlike RT-20's async invoice path) always gets no
    // response, surfacing the real 502 error through the UI rather than a fabricated result.
    await expect(
      row.getByText("SIFEN did not respond to the voiding request. Try again shortly."),
    ).toBeVisible();
  });
});
