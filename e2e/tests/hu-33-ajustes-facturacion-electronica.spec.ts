import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiBaseUrl,
  apiPostJson,
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

// HU-33 "Ajustes varios a facturación electrónica" — three fixes, all conditioned on the tenant's
// SIFEN_ELECTRONIC_INVOICING flag being active:
//  AC-01: every "Descargar PDF" action always produces the KuDE format — the traditional generator
//         is retired. Covered here by asserting the click hits /sifen/kude, never /pdf.
//  AC-02: "Enviar por Correo Electronico" no longer surfaces a generic error. Not covered here —
//         see EmailServiceTest (JUnit): the real failure mode (blank/invalid ACS config reaching
//         the Azure SDK) can't be reproduced through Playwright, since application-e2e.properties
//         always disables real email sending (app.femme.email.enabled=false), so the send always
//         takes the safe dev-log branch regardless of what this spec does.
//  AC-03: the invoice "Ver" dialog shows only the KuDE download button, never both.
//
// DEMO_TENANT_ID=1 has this flag OFF by default in the e2e profile (Flyway is disabled there, so
// V28/V30's seed rows never run — see FeatureFlagService#isEnabled's `.orElse(false)`). Every test
// below turns it on explicitly and back off in afterEach, so later specs (e.g.
// hu-35-factura-pdf.spec.ts, alphabetically right after this file, which relies on the legacy PDF
// format still being reachable) aren't affected.

const DEMO_TENANT_ID = 1;
const FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";
/** Embeds RUC 12345678-9 — must match SifenInvoiceTestSupportController#FIXTURE_CERTIFICATE_RUC. */
const FIXTURE_CERT_RUC = "12345678-9";

test.describe("HU-33 · Ajustes varios a facturación electrónica", () => {
  test.afterEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, false);
  });

  /** Same shape as sifen-hu-22-activacion-por-tenant.spec.ts's own fixture — needed for a real
   * invoice to actually reach SIFEN submission (SifenInvoiceHeaderService.requireIssuerDataComplete). */
  async function ensureSifenIssuerBusinessProfile(request: APIRequestContext, token: string) {
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Peluqueria E2E HU33",
      ruc: FIXTURE_CERT_RUC,
      address: "Avda. Mcal. Lopez 1234",
      phone: "0981123456",
      contactEmail: "contacto@e2e-hu33.test",
      logoDataUrl: null,
      taxpayerType: "INDIVIDUAL",
      economicActivityCode: "96020",
      economicActivityDescription: "Peluqueria y otros tratamientos de belleza",
      sifenDepartmentCode: "12",
      sifenDepartmentName: "CENTRAL",
      sifenCityCode: "5044",
      sifenCityName: "FERNANDO DE LA MORA",
      sifenFantasyName: null,
      kudeFooterMessage: null,
    });
  }

  test("HU-33 · AC-01 con el flag activo, Descargar PDF en la alerta de nueva factura siempre usa el formato KuDE", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, true);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await ensureSifenIssuerBusinessProfile(request, token);
    const certRes = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`,
    );
    expect(certRes.ok(), await certRes.text()).toBeTruthy();

    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);

    const legacyPdfRequestUrls: string[] = [];
    page.on("request", (req) => {
      if (/\/api\/invoices\/\d+\/pdf$/.test(req.url())) {
        legacyPdfRequestUrls.push(req.url());
      }
    });

    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("E2E HU33 KuDE siempre");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("9000");
    await page.locator("#pay-amount-0").fill("9000");
    // Real SIFEN endpoint is unreachable in e2e (application-e2e.properties → discard port), so
    // this freshly-issued invoice lands PENDING_VERIFICATION — never auto-approved, same as
    // sifen-hu-22-activacion-por-tenant.spec.ts's own "AC-04/AC-06/AC-07" test.
    await clickIssueInvoiceAndExpectSuccess(page);

    const downloadBtn = page.getByRole("button", { name: "Download PDF" });
    await expect(downloadBtn).toBeVisible({ timeout: 10_000 });

    const [kudeResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/sifen/kude") && r.request().method() === "GET",
      ),
      downloadBtn.click(),
    ]);
    // Not approved yet, so the KuDE endpoint correctly rejects it — proving AC-01 (the button now
    // targets the KuDE endpoint at all, never the legacy one) without needing a real SIFEN approval.
    expect(kudeResponse.status()).toBe(409);
    await expect(
      page.getByRole("alert").filter({ hasText: "Approved or Approved with observation" }),
    ).toBeVisible({ timeout: 10_000 });

    expect(legacyPdfRequestUrls).toHaveLength(0);
  });

  test("HU-33 · AC-03 con el flag activo, el diálogo de detalle muestra solo el botón del KuDE", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU33b ${Date.now()}`);

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

    // Test-only setup (e2e profile only): fabricates the "Aprobado" precondition directly, same as
    // sifen-hu-08-generar-comprobante-kude.spec.ts's own AC-16 test.
    const prep = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, true);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    const row = page.locator("tbody tr[role=\"button\"]").filter({ hasText: client.fullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const section = page.getByTestId("sifen-status-section");
    await expect(section).toBeVisible();

    await expect(page.getByTestId("sifen-kude-download-button")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Download PDF" }),
    ).toHaveCount(0);
  });
});
