import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiBaseUrl,
  apiGetJson,
  apiPostJson,
  apiPostJsonStatus,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  listFiscalStamps,
  loginAsDemoApi,
  loginPlatformAdminApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";

// Emisión atómica con SIFEN activo: si falta algún dato del emisor (dirección, teléfono, correo)
// la emisión completa se aborta con rollback — no queda factura, el número del timbrado no se
// consume y la operación puede reintentarse tal cual una vez completados los datos. Antes la
// factura quedaba commiteada como "emitida" sin CDC/QR, sin forma de bajar el KuDE.

const DEMO_TENANT_ID = 1;
const FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";
const FIXTURE_CERT_RUC = "12345678-9";

const COMPLETE_PROFILE = {
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
};

type IssuedInvoice = {
  id: number;
  invoiceNumber: number;
  status: string;
  sifenSubmissionStatus: string | null;
  sifenControlNumber: string | null;
};

test.describe("SIFEN · Emisión atómica ante datos del emisor incompletos", () => {
  async function setTenantFlag(request: APIRequestContext, enabled: boolean) {
    const token = await loginPlatformAdminApi(request);
    const res = await request.put(
      `${apiBaseUrl()}/api/admin/feature-flags/tenants/${DEMO_TENANT_ID}/${FLAG_KEY}`,
      { headers: authHeaders(token), data: { enabled } },
    );
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  async function saveProfile(
    request: APIRequestContext,
    token: string,
    overrides: Partial<typeof COMPLETE_PROFILE>,
  ) {
    const res = await request.put(`${apiBaseUrl()}/api/business-profile`, {
      headers: authHeaders(token),
      data: { ...COMPLETE_PROFILE, ...overrides },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  async function invoicePayload(request: APIRequestContext, token: string) {
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E atomica ${Date.now()}-${Math.random()}`);
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

  async function activeStampNextNumber(request: APIRequestContext, token: string) {
    const stamps = await listFiscalStamps(request, token);
    const active = stamps.find((s) => s.active);
    expect(active, "no active fiscal stamp").toBeTruthy();
    return active!.nextEmissionNumber;
  }

  async function invoiceTotal(request: APIRequestContext, token: string) {
    const page = await apiGetJson<{ totalElements: number }>(
      request,
      token,
      "/api/invoices?size=1",
    );
    return page.totalElements;
  }

  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`);
    await setTenantFlag(request, true);
    await saveProfile(request, token, {});
  });

  test.afterEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await saveProfile(request, token, {});
    await setTenantFlag(request, false);
    await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support/certificates/clear`);
  });

  const MISSING_CASES: Array<{
    name: string;
    overrides: Partial<typeof COMPLETE_PROFILE>;
    code: string;
  }> = [
    { name: "dirección", overrides: { address: "" }, code: "SIFEN_ISSUER_ADDRESS_MISSING" },
    { name: "teléfono", overrides: { phone: "" }, code: "SIFEN_ISSUER_CONTACT_INFO_MISSING" },
    { name: "correo", overrides: { contactEmail: "" }, code: "SIFEN_ISSUER_CONTACT_INFO_MISSING" },
  ];

  for (const c of MISSING_CASES) {
    test(`sin ${c.name} del emisor la emisión se aborta y no queda ninguna factura`, async ({
      request,
    }) => {
      const token = await loginAsDemoApi(request);
      await saveProfile(request, token, c.overrides);
      const payload = await invoicePayload(request, token);
      const invoicesBefore = await invoiceTotal(request, token);
      const nextNumberBefore = await activeStampNextNumber(request, token);

      const result = await apiPostJsonStatus(request, token, "/api/invoices", payload);

      expect(result.status).toBe(412);
      expect(result.text).toContain(c.code);
      // Rollback completo: ni factura, ni número de timbrado consumido.
      expect(await invoiceTotal(request, token)).toBe(invoicesBefore);
      expect(await activeStampNextNumber(request, token)).toBe(nextNumberBefore);

      // Completados los datos, el mismo pedido emite y reutiliza el número que no se consumió.
      await saveProfile(request, token, {});
      const issued = await apiPostJson<IssuedInvoice>(request, token, "/api/invoices", payload);
      expect(issued.status).toBe("ISSUED");
      expect(issued.sifenSubmissionStatus).toBe("QUEUED");
      expect(issued.sifenControlNumber).toHaveLength(44);
      expect(issued.invoiceNumber).toBe(nextNumberBefore);
      expect(await invoiceTotal(request, token)).toBe(invoicesBefore + 1);
    });
  }
});

// Corregir y reenviar (issue #175) es atómico igual: si el re-firmado falla porque faltan datos del
// emisor, la factura rechazada queda intacta (REJECTED, líneas originales, inutilización pendiente)
// en vez de quedar a medio corregir con su resultado SIFEN ya borrado.
test.describe("SIFEN · Corregir y reenviar atómico ante datos del emisor incompletos", () => {
  type InvoiceView = {
    id: number;
    sifenSubmissionStatus: string | null;
    sifenControlNumber: string | null;
    lines: { unitPrice: string }[];
  };

  async function saveProfile(
    request: APIRequestContext,
    token: string,
    overrides: Partial<typeof COMPLETE_PROFILE>,
  ) {
    const res = await request.put(`${apiBaseUrl()}/api/business-profile`, {
      headers: authHeaders(token),
      data: { ...COMPLETE_PROFILE, ...overrides },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  test.afterEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await saveProfile(request, token, {});
    await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support/certificates/clear`);
  });

  test("sin dirección del emisor corregir y reenviar falla y la factura rechazada queda intacta", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`);
    await saveProfile(request, token, {});
    const seed = await seedCategoryServiceProfessional(request, token);

    // Sin el flag SIFEN la factura se emite tradicional; simulate-sifen-rejection fabrica el
    // estado REJECTED completo (CDC/QR + inutilización pendiente), igual que issue-175.
    const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: `E2E atomica corregir ${Date.now()}`,
      email: "atomica-corregir@example.com",
      lines: [
        { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 55000 },
      ],
      payments: [{ method: "CASH", amount: 55000 }],
    });
    const sim = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${inv.id}/simulate-sifen-rejection`,
    );
    expect(sim.ok(), await sim.text()).toBeTruthy();
    const before = await apiGetJson<InvoiceView>(request, token, `/api/invoices/${inv.id}`);
    expect(before.sifenSubmissionStatus).toBe("REJECTED");

    const correction = {
      clientId: null,
      clientDisplayName: `E2E atomica corregido ${Date.now()}`,
      email: "atomica-corregir@example.com",
      lines: [
        { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 60000 },
      ],
      payments: [{ method: "CASH", amount: 60000 }],
    };

    await saveProfile(request, token, { address: "" });
    const failed = await apiPostJsonStatus(
      request,
      token,
      `/api/invoices/${inv.id}/sifen/correct-and-resend`,
      correction,
    );
    expect(failed.status).toBe(412);
    expect(failed.text).toContain("SIFEN_ISSUER_ADDRESS_MISSING");

    // Rollback: sigue rechazada, con el contenido original y la inutilización aún pendiente.
    const afterFailure = await apiGetJson<InvoiceView>(request, token, `/api/invoices/${inv.id}`);
    expect(afterFailure.sifenSubmissionStatus).toBe("REJECTED");
    expect(afterFailure.sifenControlNumber).toBe(before.sifenControlNumber);
    expect(Number(afterFailure.lines[0].unitPrice)).toBe(55000);
    const voiding = await apiGetJson<{ content: { invoiceId: number; status: string }[] }>(
      request,
      token,
      "/api/sifen/number-voiding?size=200",
    );
    expect(voiding.content.find((v) => v.invoiceId === inv.id)?.status).not.toBe("CANCELLED");

    // Completados los datos, la misma corrección se aplica y reenvía bajo el mismo CDC.
    await saveProfile(request, token, {});
    const resent = await apiPostJson<InvoiceView>(
      request,
      token,
      `/api/invoices/${inv.id}/sifen/correct-and-resend`,
      correction,
    );
    expect(["QUEUED", "PENDING_VERIFICATION"]).toContain(resent.sifenSubmissionStatus);
    expect(resent.sifenControlNumber).toBe(before.sifenControlNumber);
    expect(Number(resent.lines[0].unitPrice)).toBe(60000);
  });
});
