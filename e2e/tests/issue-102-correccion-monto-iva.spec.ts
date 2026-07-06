import { expect, test } from "@playwright/test";
import {
  apiBaseUrl,
  apiGetJson,
  apiPostJson,
  apiPutJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
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

test.describe("Issue #102 · Corrección del monto de IVA", () => {
  test("el IVA del resumen se calcula sobre el total final con descuento global, no sobre el subtotal", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);

    const taxes = await apiGetJson<{ id: number; rate: number; active: boolean }[]>(
      request,
      token,
      "/api/taxes",
    );
    const tax10 = taxes.find((t) => t.active && t.rate === 10);
    const tax5 = taxes.find((t) => t.active && t.rate === 5);
    expect(tax10, "demo tenant must seed an active IVA 10% tax").toBeTruthy();
    expect(tax5, "demo tenant must seed an active IVA 5% tax").toBeTruthy();

    const suffix = Date.now();
    const cat = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
      name: `E2E Iva Cat ${suffix}`,
      accentKey: "stone",
    });
    const svc10 = await apiPostJson<{ id: number }>(request, token, "/api/services", {
      name: `E2E Iva10 ${suffix}`,
      categoryId: cat.id,
      taxId: tax10!.id,
      priceMinor: 88000,
      durationMinutes: 30,
    });
    const svc5 = await apiPostJson<{ id: number }>(request, token, "/api/services", {
      name: `E2E Iva5 ${suffix}`,
      categoryId: cat.id,
      taxId: tax5!.id,
      priceMinor: 42000,
      durationMinutes: 30,
    });

    // Subtotal 130.000, 10% global discount (13.000) -> total 117.000.
    // Column totals after the proportional split: IVA10 col 79.200 (88000-8800),
    // IVA5 col 37.800 (42000-4200) -> IVA10 = 79200/11 = 7.200, IVA5 = 37800/21 = 1.800,
    // Total IVA = 9.000. The old (buggy) code would instead show 8.000 / 2.000 (pre-discount).
    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: `E2E Iva ${suffix}`,
      clientRucOverride: null,
      discountType: "PERCENT",
      discountValue: 10,
      lines: [
        { serviceId: svc10.id, description: "E2E Iva10", quantity: 1, unitPrice: 88000 },
        { serviceId: svc5.id, description: "E2E Iva5", quantity: 1, unitPrice: 42000 },
      ],
      payments: [{ method: "CASH", amount: 117000 }],
    });

    const pdf = await fetchInvoicePdf(request, token, invoice.id);
    expect(pdfContainsText(pdf, "7.200")).toBe(true);
    expect(pdfContainsText(pdf, "1.800")).toBe(true);
    expect(pdfContainsText(pdf, "9.000")).toBe(true);
    // Regression guard: the old pre-discount (wrong) IVA amounts must not appear.
    expect(pdfContainsText(pdf, "8.000")).toBe(false);
    expect(pdfContainsText(pdf, "2.000")).toBe(false);
  });
});
