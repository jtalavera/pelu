import { expect, test } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { pickServiceLine } from "../fixtures/invoice";
import { setControlledInputValue } from "../fixtures/ui";

test.describe.configure({ mode: "serial" });

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

test.describe("HU-29 · Fixes varios", () => {
  // AC1 — thousands separator in amount fields (concrete example: Services Price).
  test("HU-29 · 1 separador de miles en el campo Precio de Servicios", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.getByRole("button", { name: "+ New service" }).click();
    const dialog = page.getByRole("dialog", { name: "New service" });
    const price = dialog.getByLabel("Price");
    await setControlledInputValue(price, "1234567");
    await expect(price).toHaveValue("1.234.567");
  });

  // AC2 — per-item discounted subtotal, read-only, shown only with an active discount, in green.
  test("HU-29 · 2 subtotal con descuento por ítem en verde", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();

    await setControlledInputValue(page.locator("#line-price-0"), "10000");
    // No discount yet → field hidden
    await expect(page.getByTestId("line-discounted-total-0")).toHaveCount(0);

    await page.locator("#line-disc-toggle-0").check();
    await page.locator("#line-disc-val-0").fill("10");

    const discounted = page.getByTestId("line-discounted-total-0");
    await expect(discounted).toBeVisible();
    await expect(discounted).toContainText("9.000,00");
    await expect(discounted).toHaveClass(/text-emerald-600/);
  });

  // AC3 — combined discount (per-item + global) shown in the payment summary.
  test("HU-29 · 3 descuento combinado en resumen de pago", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();

    await setControlledInputValue(page.locator("#line-price-0"), "10000");
    await page.locator("#line-disc-toggle-0").check();
    await page.locator("#line-disc-val-0").fill("10"); // 10% of 10.000 = 1.000

    await page.getByLabel("Discount type").selectOption("PERCENT");
    await page.locator("#discount-value").fill("10"); // 10% of net 9.000 = 900

    // Combined discount = 1.000 + 900 = 1.900
    await expect(page.getByText("-1.900,00")).toBeVisible();
  });

  // AC4 — discount validations: percentage cannot exceed 100%.
  test("HU-29 · 4 validación de descuento por ítem (porcentaje > 100)", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU29 ${Date.now()}`);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();

    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("10000");
    await page.locator("#pay-amount-0").fill("10000");

    await page.locator("#line-disc-toggle-0").check();
    await page.locator("#line-disc-val-0").fill("150");

    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(
      page.getByText("Percentage discount cannot exceed 100% (e.g. 25).", { exact: true }),
    ).toBeVisible();
  });

  // AC5/AC6 — PDF tax columns and discount lines. Column geometry is covered by backend JUnit
  // tests; here we assert the PDF for a discounted invoice is served as a valid application/pdf.
  test("HU-29 · 5+6 PDF de comprobante con descuento se emite correctamente", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: `E2E HU29 PDF ${Date.now()}`,
      clientRucOverride: null,
      discountType: "PERCENT",
      discountValue: 10,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 10000,
          discountType: "PERCENT",
          discountValue: 10,
        },
      ],
      payments: [{ method: "CASH", amount: 8100 }],
    });
    const pdfRes = await request.get(`${API_BASE}/api/invoices/${inv.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()["content-type"] ?? "").toContain("application/pdf");
    const buf = await pdfRes.body();
    expect(buf.slice(0, 4).toString("latin1")).toBe("%PDF");
  });

  // AC7 — seed: GABRIELA present, ISABEL ZYMANSCKI / MERCEDES AQUINO removed (fresh seed).
  test("HU-29 · 7 datos semilla de profesionales actualizados", async ({ page, request }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await expect(page.getByText("GABRIELA", { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("ISABEL ZYMANSCKI", { exact: true })).toHaveCount(0);
    await expect(page.getByText("MERCEDES AQUINO", { exact: true })).toHaveCount(0);
  });

  // AC8 — table options menu overlays the table (rendered in a portal on document.body).
  test("HU-29 · 8 menú de opciones de tabla se superpone (portal)", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E HU29 Kebab ${Date.now()}`);
    await loginAsDemo(page);
    await page.goto("/app/clients");
    const trigger = page.getByTestId(`clients-row-${client.id}-trigger`);
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await trigger.click();

    const menu = page.locator('ul[role="menu"]');
    await expect(menu).toBeVisible();
    await expect(page.getByRole("menuitem").first()).toBeVisible();
    const portaled = await menu.evaluate((el) => el.parentElement === document.body);
    expect(portaled, "menu should be portaled to document.body to overlay the table").toBe(true);
  });

  // AC9 — Timbrado screen: new-stamp form is visually separated from current-stamp info.
  test("HU-29 · 9 separación visual de secciones en Timbrado", async ({ page, request }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");
    await expect(page.getByTestId("fiscal-stamp-current-section")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("fiscal-stamp-create-section")).toBeVisible();
  });

  // AC10 — "Ver" button in Comprobantes de hoy opens the same detail popup as History.
  test("HU-29 · 10 botón Ver en Comprobantes de hoy abre el detalle", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const inv = await apiPostJson<{ id: number; invoiceNumberFormatted: string }>(
      request,
      token,
      "/api/invoices",
      {
        clientId: null,
        clientDisplayName: `E2E HU29 Ver ${Date.now()}`,
        clientRucOverride: null,
        discountType: null,
        discountValue: null,
        lines: [
          {
            serviceId: seed.serviceId,
            description: seed.serviceFullName,
            quantity: 1,
            unitPrice: 9000,
          },
        ],
        payments: [{ method: "CASH", amount: 9000 }],
      },
    );

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "Cash Register" }).click();
    const viewBtn = page.getByTestId(`billing-today-view-${inv.id}`);
    await expect(viewBtn).toBeVisible({ timeout: 20_000 });
    await viewBtn.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(inv.invoiceNumberFormatted);
  });
});
