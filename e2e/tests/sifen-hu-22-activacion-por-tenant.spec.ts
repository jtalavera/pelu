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
import { loginAs, loginAsDemo } from "../fixtures/auth";

// See sifen-hu-18-cargar-certificado.spec.ts for the "sifen-hu-<n>-<slug>" naming rationale.
//
// HU-22 (Fase 5, the last story of this integration) is the real per-tenant switch between the
// SIFEN pipeline (HU-01..HU-21) and the traditional generator, wired in InvoiceController.issue().
// Before this story, nothing in the app ever called SifenInvoiceSubmissionService for a real,
// normally-issued invoice — every other SIFEN e2e spec fabricates state via
// /api/admin/sifen-test-support/*. This spec is the first to drive a real POST /api/invoices
// through the entire HU-01..HU-06 chain (control number, header/receiver, totals, real XML-DSig
// signing, and a real network attempt) — application-e2e.properties points the SIFEN endpoints at
// 127.0.0.1:9 (the "discard" port), so that real attempt always lands in PENDING_VERIFICATION
// (HU-06 AC-05's "no response" branch), never a fabricated status.
//
// RT-20 (Hardening_SIFEN.md): POST /api/invoices no longer waits on SIFEN at all — it returns as
// soon as the document is signed (status QUEUED, with a real CDC already populated), and a
// background attempt (LocalAsyncSifenSubmissionQueue in this profile — see
// application-e2e.properties's app.femme.servicebus.enabled=false) transmits it moments later,
// landing in PENDING_VERIFICATION for the same "no response" reason as before. waitForSifenStatus
// polls for that transition instead of asserting it synchronously.
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
        economicActivityCode: "96020",
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

  type IssuedInvoice = {
    id: number;
    status: string;
    sifenSubmissionStatus: string | null;
    sifenControlNumber: string | null;
  };

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

  /**
   * RT-20: the transmit attempt runs on LocalAsyncSifenSubmissionQueue's background thread, not
   * inline with the POST — poll instead of asserting the terminal status synchronously.
   */
  async function waitForSifenStatus(
    request: APIRequestContext,
    token: string,
    invoiceId: number,
    expectedStatus: string,
  ): Promise<IssuedInvoice> {
    await expect
      .poll(
        async () => {
          const current = await apiGetJson<IssuedInvoice>(
            request,
            token,
            `/api/invoices/${invoiceId}`,
          );
          return current.sifenSubmissionStatus;
        },
        { timeout: 15_000 },
      )
      .toBe(expectedStatus);
    return apiGetJson<IssuedInvoice>(request, token, `/api/invoices/${invoiceId}`);
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

    const issuedAt = Date.now();
    const sifenInvoice = await createInvoice(request, token);
    // RT-20: the response comes back before SIFEN is ever contacted — already QUEUED, already
    // carrying a real CDC (minted synchronously by prepareAndSign), well under the old synchronous
    // request's own latency budget.
    expect(sifenInvoice.sifenSubmissionStatus).toBe("QUEUED");
    expect(sifenInvoice.sifenControlNumber).toBeTruthy();
    expect(sifenInvoice.sifenControlNumber).toHaveLength(44);
    expect(Date.now() - issuedAt).toBeLessThan(5_000);

    // e2e's SIFEN endpoint is deliberately unreachable (application-e2e.properties) — the
    // background transmit attempt (LocalAsyncSifenSubmissionQueue) lands in the real "no response"
    // branch (HU-06 AC-05) moments later, never a fabricated status.
    await waitForSifenStatus(request, token, sifenInvoice.id, "PENDING_VERIFICATION");

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

  // Adenda (2026-08-02): the UAT walkthrough found taxpayerType/economicActivity/department-city
  // (required by SifenInvoiceHeaderService.requireIssuerDataComplete before HU-01..HU-06 can build
  // a header at all) had no UI — the only way to set them was a raw curl PUT. This closes that gap:
  // a real "Datos fiscales para SIFEN" section on Settings → Business, shown only once the flag is
  // on, plus gating the whole page (and PUT /api/business-profile) to tenant ADMIN. See PROGRESS.md.
  test("HU-22 · Adenda con el flag activo, un ADMIN completa los datos fiscales SIFEN desde la UI", async ({
    page,
    request,
  }) => {
    await setTenantFlag(request, true);
    await loginAsDemo(page);
    await page.goto("/app/settings/business");

    await expect(page.getByText("SIFEN tax data")).toBeVisible();
    await page.getByRole("radio", { name: "Legal entity" }).click();
    await page.getByLabel("Economic activity code").fill("96020");
    await page
      .getByLabel("Economic activity description")
      .fill("Peluquería y otros tratamientos de belleza");
    await page.getByLabel("Department and city").fill("Fernando de la Mora");
    await expect(page.getByRole("option", { name: /FERNANDO DE LA MORA \(CENTRAL\)/ })).toBeVisible();
    await page.getByRole("option", { name: /FERNANDO DE LA MORA \(CENTRAL\)/ }).click();
    await page.getByLabel("Trade name").fill("Peluquería Lucía");

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Your business details were saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("radio", { name: "Legal entity" })).toBeChecked();
    await expect(page.getByLabel("Economic activity code")).toHaveValue("96020");
    await expect(page.getByLabel("Department and city")).toHaveValue(
      "FERNANDO DE LA MORA (CENTRAL)",
    );
    // The trade name (nombre de fantasía) persists — it used to be wiped on every settings save.
    await expect(page.getByLabel("Trade name")).toHaveValue("Peluquería Lucía");
  });

  test("HU-22 · Adenda con el flag desactivado, la sección de datos fiscales SIFEN no aparece", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    await expect(page.getByLabel("Business name")).toBeVisible();
    await expect(page.getByText("SIFEN tax data")).toHaveCount(0);
  });

  test("HU-22 · Adenda un system admin (no ADMIN del tenant) no puede gestionar Datos del negocio", async ({
    page,
  }) => {
    await loginAs(page, SYS_ADMIN_EMAIL, SYS_ADMIN_PASSWORD);
    await page.goto("/app/settings/taxes");
    await expect(page.getByRole("link", { name: "Business", exact: true })).toHaveCount(0);

    await page.goto("/app/settings/business");
    await expect(
      page.getByText("Only the business administrator can manage business settings."),
    ).toBeVisible();
  });

  test("HU-22 · Adenda PUT /api/business-profile devuelve 403 para un system admin, GET sigue abierto", async ({
    request,
  }) => {
    const token = await loginSystemAdminApi(request);
    const putRes = await request.put(`${apiBaseUrl()}/api/business-profile`, {
      headers: authHeaders(token),
      data: { businessName: "Should be rejected" },
    });
    expect(putRes.status()).toBe(403);

    const getRes = await request.get(`${apiBaseUrl()}/api/business-profile`, {
      headers: authHeaders(token),
    });
    expect(getRes.ok(), await getRes.text()).toBeTruthy();
  });
});
