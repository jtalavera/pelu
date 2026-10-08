import { expect, test } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  loginAsDemoApi,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";

test.describe("Nuevo comprobante · orden de la lista de ítems (servicios antes que productos)", () => {
  test("la lista desplegable muestra primero todos los servicios y luego todos los productos", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);

    const stamp = Date.now();
    const cat = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
      name: `E2E Orden ${stamp}`,
      accentKey: "stone",
    });
    // Names are chosen so that the alphabetical/creation order would put the products first;
    // the dropdown must still list the services before them.
    const items = [
      { name: `Aaa Producto ${stamp}`, kind: "PRODUCT" },
      { name: `Bbb Producto ${stamp}`, kind: "PRODUCT" },
      { name: `Yyy Servicio ${stamp}`, kind: "SERVICE" },
      { name: `Zzz Servicio ${stamp}`, kind: "SERVICE" },
    ];
    for (const item of items) {
      await apiPostJson(request, token, "/api/services", {
        name: item.name,
        categoryId: cat.id,
        priceMinor: 10000,
        durationMinutes: 30,
        kind: item.kind,
      });
    }

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await expect(page.getByRole("heading", { name: "Issue Invoice" })).toBeVisible();

    // Focusing/typing in the item textbox opens the dropdown; narrow it to the four seeded items.
    await page.locator("#billing-line-svc-0").fill(String(stamp));
    const options = page.getByRole("listbox").getByRole("option");
    await expect(options).toHaveCount(4);
    await expect(options.nth(0)).toContainText(`Yyy Servicio ${stamp}`);
    await expect(options.nth(1)).toContainText(`Zzz Servicio ${stamp}`);
    await expect(options.nth(2)).toContainText(`Aaa Producto ${stamp}`);
    await expect(options.nth(3)).toContainText(`Bbb Producto ${stamp}`);
  });
});
