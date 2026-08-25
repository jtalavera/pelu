import { expect, test } from "@playwright/test";
import {
  ensureActiveFiscalStampForInvoices,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

// Issue #170: SIFEN rejected invoices paid with Tarjeta de crédito/débito because the mandatory
// E7.1.1/gPagTarCD card-brand group was never captured or emitted. These tests cover the
// UI-reachable behavior (the required "Marca de tarjeta" field and its validation); the actual
// SIFEN XML content (gPagTarCD presence, dRedon never negative) is covered by backend unit tests
// (SifenDocumentXmlServiceTest, SifenInvoiceDetailServiceTest) since this e2e suite never calls
// the real SIFEN test server.
test.describe("Issue #170 · Marca de tarjeta y redondeo de descuento", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
  });

  test("AC1/AC2 · exige marca de tarjeta y, si es Otro, su descripción", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("Card brand required");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("50000");

    // No card brand field for CASH (the default method).
    await expect(page.locator("#pay-card-brand-0")).toHaveCount(0);

    await page.locator("#pay-method-0").selectOption("CREDIT_CARD");
    await expect(page.locator("#pay-card-brand-0")).toBeVisible();

    // AC1: submitting without a brand is blocked with a validation error.
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(page.getByText("Select the card brand.", { exact: true })).toBeVisible();

    // AC2: brand "Otro" reveals a required free-text description field.
    await page.locator("#pay-card-brand-0").selectOption("OTHER");
    await expect(page.locator("#pay-card-brand-other-0")).toBeVisible();
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(
      page.getByText("Enter the card brand description.", { exact: true }),
    ).toBeVisible();
  });

  test("AC3 · emite con Tarjeta de crédito y marca Visa", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("Visa credit");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("50000");
    await page.locator("#pay-method-0").selectOption("CREDIT_CARD");
    await page.locator("#pay-card-brand-0").selectOption("VISA");

    await clickIssueInvoiceAndExpectSuccess(page);
  });

  test("AC3 · emite con Tarjeta de débito y marca Otro con descripción", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("Other debit brand");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("50000");
    await page.locator("#pay-method-0").selectOption("DEBIT_CARD");
    await page.locator("#pay-card-brand-0").selectOption("OTHER");
    await page.locator("#pay-card-brand-other-0").fill("Union Pay");

    await clickIssueInvoiceAndExpectSuccess(page);
  });

  // AC4: a discounted multi-line invoice must not be blocked client-side or by the API — this is
  // the UI-reachable half of issue #170's second bug (SIFEN's dRedon rejection); the exact
  // negative-rounding reproduction lives in SifenInvoiceDetailServiceTest since it needs 12 lines.
  test("AC4 · comprobante con varias líneas y descuento global se emite sin errores", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("Multiline discount");

    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("10000");
    await page.getByRole("button", { name: "Add item" }).click();
    await pickServiceLine(page, seed.serviceFullName, 1);
    await page.locator("#line-price-1").fill("20000");
    await page.getByRole("button", { name: "Add item" }).click();
    await pickServiceLine(page, seed.serviceFullName, 2);
    await page.locator("#line-price-2").fill("30000");

    await page.locator("#discount-type").selectOption("FIXED");
    await page.locator("#discount-value").fill("6000");
    // Subtotal 60.000, discount 6.000, total 54.000 (dot-separator, no-decimals format).
    await expect(page.getByText("54.000", { exact: true }).first()).toBeVisible();
    await page.locator("#pay-amount-0").fill("54000");

    await clickIssueInvoiceAndExpectSuccess(page);
  });
});
