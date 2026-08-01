import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiBaseUrl,
  apiGetJson,
  apiPostJson,
  apiPostJsonStatus,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAs } from "../fixtures/auth";

// See sifen-hu-18-cargar-certificado.spec.ts for the "sifen-hu-<n>-<slug>" naming rationale.
//
// HU-22 (Fase 5, the last story of this integration) is the real per-tenant switch between the
// SIFEN pipeline (HU-01..HU-21) and the traditional generator, wired in InvoiceController.issue().
// Before this story, nothing in the app ever called SifenInvoiceSubmissionService.submit() for a
// real, normally-issued invoice — every other SIFEN e2e spec fabricates state via
// /api/admin/sifen-test-support/*. This spec is the first to drive a real POST /api/invoices
// through the entire HU-01..HU-06 chain (control number, header/receiver, totals, real XML-DSig
// signing, and a real network attempt) — application-e2e.properties points the SIFEN endpoints at
// 127.0.0.1:9 (the "discard" port), so that real attempt always lands in PENDING_VERIFICATION
// (HU-06 AC-05's "no response" branch), never a fabricated status.
//
// A full BusinessProfile with every SIFEN issuer field (RUC, address, taxpayer type, economic
// activity, department/city codes) is required for SifenInvoiceHeaderService to build a header at
// all (see requireIssuerDataComplete) — no existing e2e spec has ever needed one, so
// ensureSifenIssuerBusinessProfile below sets it up here. Its RUC must match exactly the RUC
// embedded in the certificate /api/admin/sifen-test-support/ensure-valid-certificate installs
// ("12345678-9", see SifenInvoiceTestSupportController#FIXTURE_CERTIFICATE_RUC), because
// SifenConnectionService rejects a RUC mismatch *before* attempting the network call.
//
// AC-02 (a tenant's override never affects another tenant) has no e2e coverage: this repo has no
// mechanism to create a second real tenant in tests (documented already in HU-18's own deviation,
// see PROGRESS.md) — verified instead at the unit level in FeatureFlagServiceTest.

const SYS_ADMIN_EMAIL = "root@pelu";
const SYS_ADMIN_PASSWORD = ".The.Super@admin.1982";
const DEMO_TENANT_ID = 1;
const FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";
const FIXTURE_CERT_RUC = "12345678-9";

test.describe("SIFEN HU-22 · Activar o desactivar la facturación electrónica por tenant", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    // Baseline: no certificate and the flag off — other specs sharing this H2 instance may have
    // left either behind (see SifenInvoiceTestSupportController#clearCertificates's own javadoc).
    await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support/certificates/clear`);
    await setTenantFlag(request, false);
  });

  async function loginSystemAdminApi(request: APIRequestContext): Promise<string> {
    const res = await request.post(`${apiBaseUrl()}/api/auth/login`, {
      data: { email: SYS_ADMIN_EMAIL, password: SYS_ADMIN_PASSWORD },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const json = (await res.json()) as { accessToken: string };
    return json.accessToken;
  }

  async function setTenantFlag(request: APIRequestContext, enabled: boolean) {
    const token = await loginSystemAdminApi(request);
    const res = await request.put(
      `${apiBaseUrl()}/api/admin/feature-flags/tenants/${DEMO_TENANT_ID}/${FLAG_KEY}`,
      { headers: authHeaders(token), data: { enabled } },
    );
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  async function ensureSifenIssuerBusinessProfile(request: APIRequestContext, token: string) {
    const res = await request.put(`${apiBaseUrl()}/api/business-profile`, {
      headers: authHeaders(token),
      data: {
        businessName: "Peluqueria E2E SIFEN",
        ruc: FIXTURE_CERT_RUC,
        address: "Avda. Mcal. Lopez 1234",
        phone: "0981123456",
        contactEmail: "contacto@e2e-sifen.test",
        logoDataUrl: null,
        taxpayerType: "INDIVIDUAL",
        economicActivityCode: "9602",
        economicActivityDescription: "Peluqueria y otros tratamientos de belleza",
        sifenDepartmentCode: "12",
        sifenDepartmentName: "CENTRAL",
        sifenCityCode: "5044",
        sifenCityName: "FERNANDO DE LA MORA",
        sifenFantasyName: null,
        kudeFooterMessage: null,
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  type IssuedInvoice = { id: number; status: string; sifenSubmissionStatus: string | null };

  async function invoiceLinesPayload(request: APIRequestContext, token: string, namePrefix: string) {
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `${namePrefix} ${Date.now()}-${Math.random()}`);
    return {
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
    };
  }

  async function createInvoice(request: APIRequestContext, token: string): Promise<IssuedInvoice> {
    const payload = await invoiceLinesPayload(request, token, "E2E HU22");
    return apiPostJson<IssuedInvoice>(request, token, "/api/invoices", payload);
  }

  test("HU-22 · AC-01 existe el toggle por tenant para un system admin", async ({ page }) => {
    await loginAs(page, SYS_ADMIN_EMAIL, SYS_ADMIN_PASSWORD);
    await page.goto("/app/settings/feature-flags");
    await expect(page.getByText(FLAG_KEY)).toBeVisible();
    await expect(page.locator(`#ff-tenant-${FLAG_KEY}`)).toBeVisible();
  });

  test("HU-22 · AC-03 con el flag desactivado la factura se emite sin ningún campo SIFEN", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const invoice = await createInvoice(request, token);
    expect(invoice.status).toBe("ISSUED");
    expect(invoice.sifenSubmissionStatus).toBeNull();
  });

  test("HU-22 · AC-04 con el flag activado y sin certificado vigente, la emisión queda bloqueada", async ({
    request,
  }) => {
    await setTenantFlag(request, true);
    const token = await loginAsDemoApi(request);
    await ensureSifenIssuerBusinessProfile(request, token);
    const payload = await invoiceLinesPayload(request, token, "E2E HU22 blocked");

    const result = await apiPostJsonStatus(request, token, "/api/invoices", payload);

    expect(result.status).toBe(412);
    expect(result.text).toContain("SIFEN_NO_VALID_CERTIFICATE");
  });

  test("HU-22 · AC-04/AC-06/AC-07 con certificado vigente la factura pasa por SIFEN y las demás quedan intactas", async ({
    request,
  }) => {
    await setTenantFlag(request, true);
    const token = await loginAsDemoApi(request);
    await ensureSifenIssuerBusinessProfile(request, token);
    await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`);

    const sifenInvoice = await createInvoice(request, token);
    // e2e's SIFEN endpoint is deliberately unreachable (application-e2e.properties) — this is the
    // real "no response" branch (HU-06 AC-05), not a fabricated status.
    expect(sifenInvoice.sifenSubmissionStatus).toBe("PENDING_VERIFICATION");

    // AC-06: disabling the flag afterward never touches an invoice already sent to SIFEN.
    await setTenantFlag(request, false);
    const refetchedSifenInvoice = await apiGetJson<IssuedInvoice>(
      request,
      token,
      `/api/invoices/${sifenInvoice.id}`,
    );
    expect(refetchedSifenInvoice.sifenSubmissionStatus).toBe("PENDING_VERIFICATION");

    // AC-03/AC-07: a traditional invoice issued while disabled has no SIFEN fields, and re-enabling
    // the flag afterward never converts it retroactively.
    const traditionalInvoice = await createInvoice(request, token);
    expect(traditionalInvoice.sifenSubmissionStatus).toBeNull();

    await setTenantFlag(request, true);
    const refetchedTraditionalInvoice = await apiGetJson<IssuedInvoice>(
      request,
      token,
      `/api/invoices/${traditionalInvoice.id}`,
    );
    expect(refetchedTraditionalInvoice.sifenSubmissionStatus).toBeNull();
  });

  test("HU-22 · AC-05 el sistema deja un registro histórico del cambio de flag", async ({ page }) => {
    await loginAs(page, SYS_ADMIN_EMAIL, SYS_ADMIN_PASSWORD);
    await page.goto("/app/settings/feature-flags");

    // The Switch's real <input> is visually sr-only (styling handled by sibling spans), so
    // Playwright's actionability check sees it as covered — same pattern any design-system Switch
    // needs in Playwright, force the click through to the native checkbox underneath.
    const tenantSwitch = page.locator(`#ff-tenant-${FLAG_KEY}`);
    await tenantSwitch.click({ force: true });

    const history = page.getByTestId(`feature-flag-history-${FLAG_KEY}`);
    await expect(history).toBeVisible();
    await expect(history).toContainText(SYS_ADMIN_EMAIL);
  });

  test("HU-22 · AC-08 el resto del sistema sigue funcionando con el flag activado", async ({
    request,
  }) => {
    await setTenantFlag(request, true);
    const token = await loginAsDemoApi(request);
    await ensureSifenIssuerBusinessProfile(request, token);
    await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`);

    const invoice = await createInvoice(request, token);
    const list = await apiGetJson<{ content: IssuedInvoice[]; totalElements: number }>(
      request,
      token,
      "/api/invoices?page=0&size=10",
    );
    expect(list.content.some((i) => i.id === invoice.id)).toBeTruthy();
  });
});
