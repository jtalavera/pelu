import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiBaseUrl,
  apiGetJson,
  apiPostJson,
  authHeaders,
  apiPostJsonStatus,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";

// HU-10 AC-3 / HU-12 AC-5 / HU-52 AC-3: client email is NOT unique — several clients of the same
// tenant may share one email (phone and RUC uniqueness are unaffected). Covers manual create,
// edit, and an invoice whose recipient email is already used by another client.

async function createClient(
  request: APIRequestContext,
  token: string,
  fullName: string,
  email: string,
) {
  return apiPostJsonStatus(request, token, "/api/clients", { fullName, email });
}

test.describe("Email de cliente no único · varios clientes pueden compartir el mismo email", () => {
  test("crear · dos clientes pueden compartir el mismo email", async ({ request }) => {
    const token = await loginAsDemoApi(request);

    const email = `dup-create-${Date.now()}@e2e.test`;
    const first = await createClient(request, token, `E2E DUP A ${Date.now()}`, email);
    const second = await createClient(request, token, `E2E DUP B ${Date.now()}`, email);

    expect(first.status, first.text).toBe(200);
    expect(second.status, second.text).toBe(200);
    expect(JSON.parse(first.text).email).toBe(email);
    expect(JSON.parse(second.text).email).toBe(email);
  });

  test("editar · un cliente puede quedarse con el email de otro", async ({ request }) => {
    const token = await loginAsDemoApi(request);

    const email = `dup-edit-${Date.now()}@e2e.test`;
    const a = await createClient(request, token, `E2E DUP EDIT A ${Date.now()}`, email);
    expect(a.status, a.text).toBe(200);
    const b = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E DUP EDIT B ${Date.now()}`,
    });

    const res = await request.put(`${apiBaseUrl()}/api/clients/${b.id}`, {
      headers: authHeaders(token),
      data: { fullName: `E2E DUP EDIT B ${Date.now()}`, email },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).email).toBe(email);
  });

  test("emitir factura reutilizando un email que ya tiene otro cliente no falla", async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    const sharedEmail = `dup-invoice-${Date.now()}@e2e.test`;
    // Client A already owns the email.
    const a = await createClient(request, token, `E2E DUP INV A ${Date.now()}`, sharedEmail);
    expect(a.status, a.text).toBe(200);

    // Client B is linked to an invoice whose recipient email is the one A already has — the
    // invoice must be issued and B's profile email must stay untouched.
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
    const bAfter = await apiGetJson<{ email: string | null }>(request, token, `/api/clients/${b.id}`);
    expect(bAfter.email ?? null).toBeNull();
  });
});
