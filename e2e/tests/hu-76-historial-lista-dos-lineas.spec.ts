import { expect, test } from "@playwright/test";
import { issueInvoice, loginAdminUi, provisionCommissionWorld, type CommissionWorld } from "../fixtures/commissions";
import { goToInvoiceHistory } from "../fixtures/billing";

/**
 * HU-76 · Historial de comprobantes: vuelve a la lista de dos líneas (nombre y total arriba; estado,
 * número, fecha, forma de pago y envío a SIFEN debajo). Entra en el ancho real sin desplazar y el
 * total queda siempre a la vista. Mundo propio por test.
 */
let w: CommissionWorld;

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "Historial lista", { commissionsEnabled: false });
});

test("AC1-3 · cada comprobante es una lista de dos líneas con el total a la vista y sin encabezados de tabla", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  await page.setViewportSize({ width: 1024, height: 800 });
  await loginAdminUi(page, w);
  await page.goto("/app/billing");
  await goToInvoiceHistory(page);

  const list = page.getByTestId("invoice-history-list").filter({ visible: true });
  await expect(list).toBeVisible({ timeout: 30_000 });
  // A list, not a table: no column headers.
  expect(await list.evaluate((el) => el.tagName)).toBe("UL");
  await expect(page.getByRole("columnheader")).toHaveCount(0);

  const row = page.getByTestId(`invoice-history-row-${inv.id}`);
  await expect(row).toBeVisible();
  // First line: the client and the total. Second line: state, number, date, payment method.
  await expect(row.getByTestId("invoice-row-client")).toContainText("Cliente Comisiones E2E");
  await expect(row.getByTestId("invoice-row-total")).toContainText("110.000");
  await expect(row.locator("[data-invoice-state]")).toBeVisible();
  await expect(row.getByTestId("invoice-row-number")).toContainText(/No\. /);
  await expect(row.getByTestId("invoice-row-date")).toContainText(/\d{1,2}:\d{2}/);
  await expect(row.getByTestId("invoice-row-method")).toContainText("Cash");

  // Everything fits: the total is inside the card and the list does not scroll sideways.
  const total = (await row.getByTestId("invoice-row-total").boundingBox())!;
  const card = (await list.boundingBox())!;
  expect(total.x + total.width).toBeLessThanOrEqual(card.x + card.width + 1);
  expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // The row is at least 64 px tall (two lines).
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(64);
});

test("AC4 · en un ancho angosto la segunda línea baja de renglón y el total sigue a la vista", async ({ page, request }) => {
  test.setTimeout(90_000);
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  await page.setViewportSize({ width: 390, height: 800 });
  await loginAdminUi(page, w);
  await page.goto("/app/billing");
  await goToInvoiceHistory(page);
  const row = page.getByTestId(`invoice-history-row-${inv.id}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  const total = (await row.getByTestId("invoice-row-total").boundingBox())!;
  expect(total.x + total.width).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // Clicking the row still opens the detail.
  await row.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
