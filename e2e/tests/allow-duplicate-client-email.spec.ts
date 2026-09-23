import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiPostJson,
  apiPostJsonStatus,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  setTenantFeatureFlag,
} from "../fixtures/api";

// Feature flag ALLOW_DUPLICATE_CLIENT_EMAIL — lifts the per-tenant "client email must be unique"
// check so SIFEN electronic-invoicing testing can reuse the same recipient email across many test
// clients. The relaxation only applies in the SIFEN TEST environment; the `e2e` Spring profile keeps
// the SIFEN environment at its TEST default, so here the flag alone drives the behaviour.

const DEMO_TENANT_ID = 1;
const FLAG_KEY = "ALLOW_DUPLICATE_CLIENT_EMAIL";

async function createClient(
  request: APIRequestContext,
  token: string,
  fullName: string,
  email: string,
) {
  return apiPostJsonStatus(request, token, "/api/clients", { fullName, email });
}

test.describe("ALLOW_DUPLICATE_CLIENT_EMAIL · unicidad de email de cliente para pruebas SIFEN", () => {
  test.afterEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, false);
  });

  test("flag apagado · un segundo cliente con el mismo email es rechazado (409 CLIENT_EMAIL_DUPLICATE)", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, false);

    const email = `dup-off-${Date.now()}@e2e.test`;
    const first = await createClient(request, token, `E2E DUP OFF A ${Date.now()}`, email);
    expect(first.status, first.text).toBe(200);

    const second = await createClient(request, token, `E2E DUP OFF B ${Date.now()}`, email);
    expect(second.status).toBe(409);
    expect(second.text).toContain("CLIENT_EMAIL_DUPLICATE");
  });

  test("flag encendido · dos clientes pueden compartir el mismo email", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, true);

    const email = `dup-on-${Date.now()}@e2e.test`;
    const first = await createClient(request, token, `E2E DUP ON A ${Date.now()}`, email);
    const second = await createClient(request, token, `E2E DUP ON B ${Date.now()}`, email);

    expect(first.status, first.text).toBe(200);
    expect(second.status, second.text).toBe(200);
    expect(JSON.parse(first.text).email).toBe(email);
    expect(JSON.parse(second.text).email).toBe(email);
  });

  test("flag encendido · emitir factura reutilizando un email que ya tiene otro cliente no falla", async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, true);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    const sharedEmail = `dup-invoice-${Date.now()}@e2e.test`;
    // Client A already owns the email.
    const a = await createClient(request, token, `E2E DUP INV A ${Date.now()}`, sharedEmail);
    expect(a.status, a.text).toBe(200);

    // Client B is linked to an invoice whose recipient email is the one A already has — the
    // write-back to B's profile would normally 409 with CLIENT_EMAIL_DUPLICATE.
    const b = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E DUP INV B ${Date.now()}`,
    });

    const invoice = await apiPostJsonStatus(request, token, "/api/invoices", {
      clientId: b.id,
      clientDisplayName: `E2E DUP INV B ${Date.now()}`,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      email: sharedEmail,
      lines: [
        { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 50000 },
      ],
      payments: [{ method: "CASH", amount: 50000 }],
    });

    expect(invoice.status, invoice.text).toBeLessThan(300);
    expect(invoice.text).not.toContain("CLIENT_EMAIL_DUPLICATE");
  });
});
