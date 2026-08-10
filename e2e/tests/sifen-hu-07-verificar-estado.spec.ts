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
// HU-07 AC-01/AC-02/AC-05 (query resolution to Aprobado/Rechazado, and the automatic check on
// retry) are covered by SifenDocumentQueryClientTest/SifenInvoiceSubmissionServiceTest on the
// backend — no document sent by this system has reached real SIFEN approval yet (HU-06's known
// gap, blocked on HU-08's QR code), so there's no way to reach an "Aprobado" invoice for real, in
// backend tests or here. AC-04 is the one criterion with a screen of its own, so it's the one
// covered end-to-end here.
//
// Getting an invoice into 'pendiente de verificación' requires a real submission attempt to SIFEN
// that got no response (HU-06 AC-05) — but nothing in the app calls
// SifenInvoiceSubmissionService.submit() yet (tenant activation is HU-22, still pending), so no
// invoice can reach that state through real usage today. The test-only
// /api/admin/sifen-test-support endpoint (gated behind femme.data-init.enabled, same as
// /api/admin/seed/reset, and only ever active in the e2e Spring profile) fabricates that
// precondition directly: a valid SIFEN certificate, a matching business RUC, and the invoice
// marked pending-verification with a real-shaped CDC. The e2e profile also points SIFEN's "test"
// base URL at an unreachable local port (application-e2e.properties), so clicking the button below
// exercises the real controller -> service -> query-client -> mTLS-connection code path end to
// end, failing fast locally instead of depending on a live call to SIFEN's real test environment.

test.describe("SIFEN HU-07 · Verificar en SIFEN el estado de una factura pendiente", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  test("HU-07 · AC-04 el botón de verificar estado aparece solo para una factura pendiente de verificación y la consulta real deja la factura pendiente (SIFEN no contesta)", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU07 ${Date.now()}`);

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

    // Test-only setup (e2e profile only, see file header): fabricates the 'pendiente de
    // verificación' precondition + a valid cert/RUC so the real check-status call below actually
    // reaches SifenDocumentQueryClient instead of failing at certificate resolution.
    const prep = await request.post(
      `${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-for-status-check`,
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
    await expect(section.getByText("Pending verification", { exact: true })).toBeVisible();

    const checkButton = page.getByTestId("sifen-check-status-button");
    await expect(checkButton).toBeVisible();

    const [checkResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/sifen/check-status") && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      checkButton.click(),
    ]);
    expect(checkResponse.ok(), await checkResponse.text()).toBeTruthy();

    // The unreachable test-base-url override (application-e2e.properties) means SIFEN gives no
    // answer for real — the invoice stays pending-verification, exercising the exact "no
    // response" path HU-06 AC-05 already documented as a real SIFEN failure mode.
    await expect(
      page
        .getByText("SIFEN has not answered yet. The invoice is still pending verification.")
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(section.getByText("Pending verification", { exact: true })).toBeVisible();
  });

  test("HU-07 · AC-04 una factura sin intento de envío a SIFEN no muestra la sección de estado SIFEN", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU07b ${Date.now()}`);

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
          unitPrice: 30000,
        },
      ],
      payments: [{ method: "CASH", amount: 30000 }],
    });

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    const row = page.locator("tbody").getByRole("row").filter({ hasText: client.fullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "View" }).click();

    await expect(page.getByRole("heading", { name: /Invoice #/ })).toBeVisible();
    await expect(page.getByTestId("sifen-status-section")).toHaveCount(0);
  });
});
