import { expect, test } from "@playwright/test";
import { loginAsDemoApi, seedCategoryServiceProfessional } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { pickServiceLine } from "../fixtures/invoice";

test.describe("Issue #101 · Nombre del cliente no obligatorio sin RUC", () => {
  test("RUC cargado sin nombre bloquea la emisión del comprobante", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();

    // Name left blank, RUC filled — must block submission.
    await page.locator("#client-ruc").fill("80000005-6");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("9000");
    await page.locator("#pay-amount-0").fill("9000");
    await page.getByRole("button", { name: "Issue invoice" }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: /required when a RUC is provided/i }),
    ).toBeVisible();
    // The form must still show the unsent invoice (no reset/navigation on failed validation).
    await expect(page.locator("#client-ruc")).toHaveValue("80000005-6");
  });

  test("cliente ocasional con nombre y RUC en blanco no requiere nombre", async ({
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

    // Both left blank — must be allowed to submit.
    await expect(page.locator("#client-display-name")).toHaveValue("");
    await expect(page.locator("#client-ruc")).toHaveValue("");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("9000");
    await page.locator("#pay-amount-0").fill("9000");

    const [res] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/invoices") &&
          r.request().method() === "POST" &&
          !r.url().includes("/void") &&
          !r.url().includes("/pdf"),
        { timeout: 15_000 },
      ),
      page.getByRole("button", { name: "Issue invoice" }).click(),
    ]);
    expect(res.ok(), await res.text()).toBeTruthy();
    await expect(page.getByRole("alert").filter({ hasText: "Invoice issued" })).toBeVisible({
      timeout: 15_000,
    });
  });
});
