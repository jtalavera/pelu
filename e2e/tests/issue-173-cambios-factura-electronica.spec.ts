import { createRequire } from "node:module";
import { expect, test, type APIRequestContext } from "@playwright/test";

// pdf-parse is CJS with a debug-only side effect in its index; import the lib entrypoint directly.
const nodeRequire = createRequire(import.meta.url);
const pdfParse = nodeRequire("pdf-parse/lib/pdf-parse.js") as (
  data: Buffer,
) => Promise<{ text: string }>;
import {
  apiBaseUrl,
  apiGetJson,
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

// Issue #173 "Cambios en factura electrónica (Parte 1)":
//  1. recipient-email field on the comprobante form (prefilled from the client, editable,
//     mandatory when SIFEN is enabled unless "Sin identificar", written back to the client);
//  2. the KuDE is auto-emailed once SIFEN returns a successful result;
//  3. a successful SIFEN cancellation emails the client a notice with the document's data + KuDE;
//  4. a "Sin nominar" KuDE prints "Sin nombre" / "RUC: X";
//  6. the KuDE sale grid drops the always-empty "Cuotas" / "Tipo de Cambio" rows.
//
// e2e points SIFEN at an unreachable port, so a real "Aprobado" is never reached — the observable
// signals for items 2/3 are the new sifenKudeEmailedAt / sifenCancellationNotifiedAt timestamps,
// driven via the test-only /api/admin/sifen-test-support endpoints (email itself is disabled in the
// e2e Spring profile). PDF *content* (items 4/6) is also covered by SifenKudePdfServiceTest.

const DEMO_TENANT_ID = 1;
const FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";
/** Must match SifenInvoiceTestSupportController#FIXTURE_CERTIFICATE_RUC. */
const FIXTURE_CERT_RUC = "12345678-9";

const line = (serviceId: number, description: string) => ({
  serviceId,
  description,
  quantity: 1,
  unitPrice: 45000,
});
const payment = { method: "CASH", amount: 45000 };

async function ensureSifenIssuerBusinessProfile(request: APIRequestContext, token: string) {
  await apiPutJson(request, token, "/api/business-profile", {
    businessName: "Peluqueria E2E 173",
    ruc: FIXTURE_CERT_RUC,
    address: "Avda. Mcal. Lopez 1234",
    phone: "0981123456",
    contactEmail: "contacto@e2e-173.test",
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

async function enableSifen(request: APIRequestContext, token: string) {
  await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, true);
  await ensureSifenIssuerBusinessProfile(request, token);
  const certRes = await request.post(
    `${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`,
  );
  expect(certRes.ok(), await certRes.text()).toBeTruthy();
}

async function post(request: APIRequestContext, path: string) {
  const res = await request.post(`${apiBaseUrl()}${path}`);
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Opens the billing client search, types a query and clicks the matching client row. */
async function selectClientInSearch(page: import("@playwright/test").Page, fullNameUpper: string) {
  const field = page.getByLabel("Search or select client");
  await field.click();
  await field.fill(fullNameUpper.slice(0, 20));
  const listbox = page.getByRole("listbox", { name: "Search or select client" });
  await listbox.getByRole("button").filter({ hasText: fullNameUpper }).first().click();
}

type InvoiceView = {
  id: number;
  recipientEmail: string | null;
  sifenKudeEmailedAt: string | null;
  sifenCancellationNotifiedAt: string | null;
};

test.describe("Issue #173 · Cambios en factura electrónica (Parte 1)", () => {
  test.afterEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, false);
  });

  test("item 1 · the email field prefills from the selected client and is blank when none is on file", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);

    const stamp = Date.now();
    const nameWithEmail = `E2E 173 CON CORREO ${stamp}`;
    const nameWithoutEmail = `E2E 173 SIN CORREO ${stamp}`;
    const prefillEmail = `prefill-${stamp}@example.com`;
    await apiPostJson(request, token, "/api/clients", {
      fullName: nameWithEmail,
      phone: null,
      email: prefillEmail,
      ruc: null,
    });
    await seedClient(request, token, nameWithoutEmail);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();

    await selectClientInSearch(page, nameWithEmail);
    await expect(page.locator("#billing-client-email")).toHaveValue(prefillEmail);

    await selectClientInSearch(page, nameWithoutEmail);
    await expect(page.locator("#billing-client-email")).toHaveValue("");
  });

  test("item 1 · a new email typed on the comprobante form is written back to the client record", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const stamp = Date.now();
    const name = `E2E 173 WRITEBACK ${stamp}`;
    const newEmail = `writeback-${stamp}@example.com`;
    const client = await seedClient(request, token, name);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();

    await selectClientInSearch(page, name);
    await page.locator("#billing-client-email").fill(newEmail);
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("45000");
    await page.locator("#pay-amount-0").fill("45000");
    await clickIssueInvoiceAndExpectSuccess(page);

    const updated = await apiGetJson<{ email: string }>(request, token, `/api/clients/${client.id}`);
    expect(updated.email).toBe(newEmail);
  });

  test("item 1 · with SIFEN enabled the email is mandatory, except for a 'Sin nominar' comprobante", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await enableSifen(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();

    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("E2E 173 obligatorio");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("45000");
    await page.locator("#pay-amount-0").fill("45000");

    // blank email → the form blocks submission with a field-level error, no POST fires
    let invoicePosted = false;
    page.on("request", (r) => {
      if (r.url().includes("/api/invoices") && r.method() === "POST") invoicePosted = true;
    });
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(page.locator("#billing-client-email-err")).toBeVisible();
    expect(invoicePosted).toBe(false);

    // "Comprobante sin nominar" → email no longer required, issuance succeeds
    await page.getByLabel("Unnamed invoice (no client identified)").check();
    await clickIssueInvoiceAndExpectSuccess(page);
  });

  test("item 2 · the KuDE is auto-emailed after a successful SIFEN result, never after a rejection", async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await enableSifen(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    const approved = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: "E2E 173 auto-kude",
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      email: "autokude173@example.com",
      lines: [line(seed.serviceId, seed.serviceFullName)],
      payments: [payment],
    });
    await post(request, `/api/admin/sifen-test-support/invoices/${approved.id}/prepare-as-approved`);
    await post(request, `/api/admin/sifen-test-support/invoices/${approved.id}/run-approval-notifications`);
    const approvedView = await apiGetJson<InvoiceView>(request, token, `/api/invoices/${approved.id}`);
    expect(approvedView.recipientEmail).toBe("autokude173@example.com");
    expect(approvedView.sifenKudeEmailedAt).not.toBeNull();

    const rejected = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: "E2E 173 rechazada",
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      email: "rechazo173@example.com",
      lines: [line(seed.serviceId, seed.serviceFullName)],
      payments: [payment],
    });
    await post(request, `/api/admin/sifen-test-support/invoices/${rejected.id}/prepare-with-status/REJECTED`);
    await post(request, `/api/admin/sifen-test-support/invoices/${rejected.id}/run-approval-notifications`);
    const rejectedView = await apiGetJson<InvoiceView>(request, token, `/api/invoices/${rejected.id}`);
    expect(rejectedView.sifenKudeEmailedAt).toBeNull();
  });

  test("item 3 · a successful SIFEN cancellation emails the client a notice; a rejected one does not", async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await enableSifen(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    async function issueApproved(name: string) {
      const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
        clientId: null,
        clientDisplayName: name,
        clientRucOverride: null,
        clientIdentityDocumentOverride: null,
        email: "cancel173@example.com",
        lines: [line(seed.serviceId, seed.serviceFullName)],
        payments: [payment],
      });
      await post(request, `/api/admin/sifen-test-support/invoices/${inv.id}/prepare-as-approved`);
      return inv.id;
    }

    const cancelled = await issueApproved("E2E 173 cancelada ok");
    await post(request, `/api/admin/sifen-test-support/invoices/${cancelled}/fabricate-cancellation-result/true`);
    await post(request, `/api/admin/sifen-test-support/invoices/${cancelled}/run-cancellation-notifications`);
    const cancelledView = await apiGetJson<InvoiceView>(request, token, `/api/invoices/${cancelled}`);
    expect(cancelledView.sifenCancellationNotifiedAt).not.toBeNull();

    const rejected = await issueApproved("E2E 173 cancelacion rechazada");
    await post(request, `/api/admin/sifen-test-support/invoices/${rejected}/fabricate-cancellation-result/false`);
    await post(request, `/api/admin/sifen-test-support/invoices/${rejected}/run-cancellation-notifications`);
    const rejectedView = await apiGetJson<InvoiceView>(request, token, `/api/invoices/${rejected}`);
    expect(rejectedView.sifenCancellationNotifiedAt).toBeNull();
  });

  test("items 4 & 6 · the 'Sin nominar' KuDE prints 'Sin nombre' and drops the Cuotas / Tipo de Cambio rows", async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await enableSifen(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: null,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      email: null,
      lines: [line(seed.serviceId, seed.serviceFullName)],
      payments: [payment],
    });
    await post(request, `/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`);

    const res = await request.get(`${apiBaseUrl()}/api/invoices/${invoice.id}/sifen/kude`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const pdf = Buffer.from(await res.body());
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");

    const { text } = await pdfParse(pdf);
    // item 4: unidentified receiver still prints the receiver rows with placeholders
    expect(text).toContain("Sin nombre");
    expect(text).toContain("RUC del Cliente");
    // item 6: "Moneda" stays, "Cuotas" / "Tipo de Cambio" are gone
    expect(text).toContain("Moneda");
    expect(text).toContain("Guaraníes");
    expect(text).not.toContain("Cuotas");
    expect(text).not.toContain("Tipo de Cambio");
    // still-relevant sale rows remain
    expect(text).toContain("Fecha y hora de Emisión");
    expect(text).toContain("Condición de Venta");
  });
});
