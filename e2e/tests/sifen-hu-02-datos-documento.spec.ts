import { expect, test } from "@playwright/test";
import {
  apiPostJsonStatus,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

// See sifen-hu-18-cargar-certificado.spec.ts for the "sifen-hu-<n>-<slug>" naming rationale.
//
// HU-02's other acceptance criteria (AC-01..AC-04, AC-06..AC-08 — CDC/timbrado/emisor/receptor
// document assembly) have no screen of their own: they're covered by
// SifenInvoiceHeaderServiceTest on the backend, the same "sin pantalla propia" pattern already
// used by HU-01/HU-05/HU-21. AC-05 (the Gs. 7.000.000 client-identification threshold) is the one
// criterion wired into the real invoicing flow, so it's the one covered here end-to-end.

test.describe.configure({ mode: "serial" });

test.describe("SIFEN HU-02 · Completar datos de identificación/timbrado/emisor/receptor", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  test("HU-02 · AC-05 factura de Gs. 7.000.000 sin identificar al cliente es rechazada (API)", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const { status, text } = await apiPostJsonStatus(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: null,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 7_000_000,
        },
      ],
      payments: [{ method: "CASH", amount: 7_000_000 }],
    });

    expect(status, text).toBe(400);
    expect(text).toContain("SIFEN_CLIENT_IDENTIFICATION_REQUIRED");
  });

  test("HU-02 · AC-05 misma factura con un documento de identidad del cliente es aceptada (API)", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const { status, text } = await apiPostJsonStatus(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: "Cliente Ocasional",
      clientRucOverride: null,
      clientIdentityDocumentOverride: "4123456",
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 7_000_000,
        },
      ],
      payments: [{ method: "CASH", amount: 7_000_000 }],
    });

    expect(status, text).toBe(201);
  });

  test("HU-02 · AC-05 justo debajo del umbral no exige identificar al cliente (API)", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const { status, text } = await apiPostJsonStatus(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: null,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 6_999_999,
        },
      ],
      payments: [{ method: "CASH", amount: 6_999_999 }],
    });

    expect(status, text).toBe(201);
  });

  test("HU-02 · AC-05 la pantalla de facturación exige y luego acepta la identificación (UI)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("7000000");
    await expect(page.locator("#line-price-0")).toHaveValue("7.000.000");
    await page.locator("#pay-amount-0").fill("7000000");

    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(
      page.getByText(
        "Sales of Gs. 7,000,000 or more require identifying the client with a RUC or an identity document.",
      ),
    ).toBeVisible();

    await page.getByLabel("Client identity document (override for this invoice)").fill("4123456");
    await clickIssueInvoiceAndExpectSuccess(page);
  });
});
