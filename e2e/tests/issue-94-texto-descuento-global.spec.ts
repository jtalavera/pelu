import { expect, test } from "@playwright/test";
import {
  apiBaseUrl,
  apiPostJson,
  apiPutJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { pdfContainsText } from "../fixtures/invoice";

async function setBusinessRuc(request: import("@playwright/test").APIRequestContext, token: string) {
  await apiPutJson(request, token, "/api/business-profile", {
    businessName: "Demo salon",
    ruc: "80000005-6",
    address: null,
    phone: null,
    contactEmail: null,
    logoDataUrl: null,
  });
}

async function fetchInvoicePdf(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  invoiceId: number,
): Promise<Buffer> {
  const res = await request.get(`${apiBaseUrl()}/api/invoices/${invoiceId}/pdf`, {
    headers: authHeaders(token),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return Buffer.from(await res.body());
}

test.describe("Issue #94 · Texto en descuento global del PDF", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  test("descuento global en Porcentaje imprime 'Dto. global X%' sin duplicar 'Dto.'", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: `E2E Issue94 Percent ${Date.now()}`,
      clientRucOverride: null,
      discountType: "PERCENT",
      discountValue: 10,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 10000,
        },
      ],
      payments: [{ method: "CASH", amount: 9000 }],
    });

    const pdf = await fetchInvoicePdf(request, token, invoice.id);
    expect(pdfContainsText(pdf, "Dto. global 10%")).toBe(true);
    expect(pdfContainsText(pdf, "Dto. global Dto.")).toBe(false);
  });

  test("descuento global en Monto fijo imprime 'Dto. global Monto fijo' sin duplicar 'Dto.'", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: `E2E Issue94 Fixed ${Date.now()}`,
      clientRucOverride: null,
      discountType: "FIXED",
      discountValue: 1000,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 10000,
        },
      ],
      payments: [{ method: "CASH", amount: 9000 }],
    });

    const pdf = await fetchInvoicePdf(request, token, invoice.id);
    expect(pdfContainsText(pdf, "Dto. global Monto fijo")).toBe(true);
    expect(pdfContainsText(pdf, "Dto. global Dto.")).toBe(false);
  });
});
