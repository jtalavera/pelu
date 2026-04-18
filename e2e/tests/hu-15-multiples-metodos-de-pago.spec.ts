import { expect, test } from "@playwright/test";
import { ensureActiveFiscalStampForInvoices, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";

test.describe("HU-15 · Múltiples métodos de pago", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
  });

  test("formulario de factura incluye sección de métodos de pago", async ({ page }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await expect(page.getByText("Payment methods", { exact: true })).toBeVisible();
  });

  test("HU-15 · 1 y 2 dos métodos cuya suma iguala el total", async ({ page, request }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Client display name").fill("Split pay");
    await page.locator("#line-desc-0").fill("Service");
    await page.locator("#line-price-0").fill("10000");
    await page.getByRole("button", { name: "Add payment method" }).click();
    await page.locator("#pay-method-0").selectOption("CASH");
    await page.locator("#pay-amount-0").fill("4000");
    await page.locator("#pay-method-1").selectOption("TRANSFER");
    await page.locator("#pay-amount-1").fill("6000");
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(page.getByText(/issued successfully/i)).toBeVisible();
  });

  test("HU-15 · 2 suma distinta del total muestra error de API", async ({ page, request }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Client display name").fill("Bad sum");
    await page.locator("#line-desc-0").fill("Service");
    await page.locator("#line-price-0").fill("10000");
    await page.locator("#pay-amount-0").fill("5000");
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(
      page.getByText("The sum of payment amounts must equal the invoice total.", { exact: true }),
    ).toBeVisible();
  });

  test("HU-15 · 3 saldo pendiente visible cuando falta asignar", async ({ page, request }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Client display name").fill("Remain");
    await page.locator("#line-desc-0").fill("Service");
    await page.locator("#line-price-0").fill("20000");
    await page.locator("#pay-amount-0").fill("5000");
    await expect(page.getByText("Remaining", { exact: true })).toBeVisible();
    await expect(page.locator("span").getByText("15,000", { exact: true })).toBeVisible();
  });
});
