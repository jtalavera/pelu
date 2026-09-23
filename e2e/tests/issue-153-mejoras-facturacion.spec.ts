import { expect, test } from "@playwright/test";
import {
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

test.describe.configure({ mode: "serial" });

test.describe("Issue-153 · Mejoras a facturación", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
  });

  test("AC1 · el botón 'Nuevo comprobante' de la botonera se elimina y el de la solapa Caja se mantiene", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();

    // Only "Cash Register" and "History" remain in the tab bar.
    const tabs = page.getByRole("tablist", { name: "Billing" }).getByRole("tab");
    await expect(tabs).toHaveCount(2);
    await expect(page.getByRole("tab", { name: "New Invoice" })).toHaveCount(0);

    // The "New Invoice" button inside the Cash Register tab still opens the form.
    await page.getByRole("button", { name: "New Invoice" }).click();
    await expect(page.getByRole("heading", { name: "Issue Invoice" })).toBeVisible();
  });

  test("AC2 · al hacer click en 'Nuevo comprobante' se borra el mensaje de la factura anterior", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();

    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("E2E-153 Occ");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("15000");
    await page.locator("#pay-amount-0").fill("15000");
    const { invoiceNumberFormatted } = await clickIssueInvoiceAndExpectSuccess(page);
    await expect(
      page.getByText(`Invoice ${invoiceNumberFormatted} issued successfully.`),
    ).toBeVisible();

    // Go back to the Cash Register tab and click "New Invoice" again.
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();

    // The success message from the previous invoice must be gone.
    await expect(page.getByRole("alert").filter({ hasText: "Invoice issued" })).toHaveCount(0);
    await expect(
      page.getByText(`Invoice ${invoiceNumberFormatted} issued successfully.`),
    ).toHaveCount(0);
  });
});
