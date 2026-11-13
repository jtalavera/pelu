import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi, seedCategoryServiceProfessional, seedClient } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Ficha de servicio · lista limpia (opción A del mockup): el cliente grande, cada servicio como una
 * fila simple que se toca para editar, el total grande y un pie «Cerrar · Guardar · Cobrar · ⋯» con
 * lo secundario (turno, propinas, anular) en el menú. Sin servicios frecuentes.
 */
test.describe("Ficha de servicio · lista limpia", () => {
  test("filas simples, total grande y pie con «⋯»", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E Limpia ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    await apiPostJson(request, admin, "/api/service-records", {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 1, unitPrice: 30_000 }],
      tips: [],
    });

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    await page.getByTestId("dashboard-service-record-card").filter({ hasText: new RegExp(clientName, "i") }).first().click({ position: { x: 40, y: 20 } });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("service-record-add-line")).toBeVisible({ timeout: 20_000 });

    // The client is the big line of the dialog.
    const clientLine = dialog.getByLabel(/^Client$/i).locator("div").nth(1);
    expect(await clientLine.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);

    // The service is a plain row (collapsed): no fields until it is tapped.
    const toggle = dialog.getByTestId("service-record-line-toggle").first();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(dialog.locator("#service-record-line-qty-0")).toHaveCount(0);
    await toggle.click();
    await expect(dialog.locator("#service-record-line-qty-0")).toBeVisible();
    await toggle.click();
    await expect(dialog.locator("#service-record-line-qty-0")).toHaveCount(0);

    // The total is large.
    const totalAmount = dialog.getByTestId("service-record-total").locator("span").last();
    expect(await totalAmount.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(22);

    // Footer: Close · Save · … Charge · ⋯ in one row, left to right; no «Anular» button there.
    const close = dialog.getByTestId("service-record-close");
    const save = dialog.getByTestId("service-record-submit");
    const pay = dialog.getByTestId("service-record-generate-invoice");
    const more = dialog.getByTestId("service-record-more");
    const [c, s, p, m] = await Promise.all([close, save, pay, more].map((l) => l.boundingBox()));
    expect(c!.x).toBeLessThan(s!.x);
    expect(s!.x).toBeLessThan(p!.x);
    expect(p!.x).toBeLessThan(m!.x);
    // Same row: the vertical centres line up (the «⋯» button can be shorter than the others).
    const centres = [c!, s!, p!, m!].map((b) => b.y + b.height / 2);
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(3);
    await expect(dialog.getByTestId("service-record-void-open")).toHaveCount(0);

    // The secondary actions are in the menu, «Anular ficha» last and in red.
    await more.click();
    const menu = page.getByTestId("service-record-actions-panel");
    await expect(menu.getByTestId("service-record-tips-toggle")).toBeVisible();
    await expect(menu.getByTestId("service-record-void-open")).toBeVisible();
    await expect(menu.getByRole("menuitem").last()).toHaveAttribute("data-testid", "service-record-void-open");
    await page.keyboard.press("Escape");

    // No frequent-service chips.
    await expect(dialog.getByTestId("service-record-frequent-chip")).toHaveCount(0);
  });

  test("las propinas ya no son una sección fija: aparecen al pedirlas desde «⋯»", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E LimpiaTips ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    await apiPostJson(request, admin, "/api/service-records", {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 1, unitPrice: 30_000 }],
      tips: [],
    });
    await loginAsDemo(page);
    await page.goto("/app/hoy");
    await page.getByTestId("dashboard-service-record-card").filter({ hasText: new RegExp(clientName, "i") }).first().click({ position: { x: 40, y: 20 } });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("service-record-more")).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByTestId("service-record-tips")).toHaveCount(0);
    await dialog.getByTestId("service-record-more").click();
    await page.getByTestId("service-record-tips-toggle").click();
    await expect(dialog.getByTestId("service-record-tips")).toBeVisible();
    // Once shown, the option is no longer offered.
    await dialog.getByTestId("service-record-more").click();
    await expect(page.getByTestId("service-record-tips-toggle")).toHaveCount(0);
  });
});
