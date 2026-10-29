import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiPostJson, loginAsDemoApi, seedCategoryServiceProfessional, seedClient } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { professionalFormDialog } from "../fixtures/ui";
import { goToInvoiceHistory } from "../fixtures/billing";

/**
 * Todos los botones Cancelar / Cerrar comparten el mismo estilo (secundario, con fondo) y van
 * siempre a la izquierda de los demás botones de su fila.
 */

/** Background color of the design-system secondary button (bg-primary-lt). */
async function secondaryBackground(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("button");
    probe.className = "bg-primary-lt";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
}

async function expectCancelFirstAndSecondary(page: Page, cancel: Locator, others: Locator[]) {
  await expect(cancel).toBeVisible();
  const background = await cancel.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  expect(background).toBe(await secondaryBackground(page));
  const box = (await cancel.boundingBox())!;
  for (const other of others) {
    await expect(other).toBeVisible();
    const o = (await other.boundingBox())!;
    expect(Math.abs(o.y - box.y)).toBeLessThan(12); // same row
    expect(box.x).toBeLessThan(o.x);
  }
}

test.describe("Botones Cancelar unificados", () => {
  test("Ficha de servicio: «Cerrar» con fondo y a la izquierda de Guardar / Anular", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Cancel ${Date.now()}`);
    await apiPostJson(request, token, "/api/service-records", {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 1, unitPrice: 50_000 }],
      tips: [{ professionalId: seed.professionalId, amount: 0 }],
    });

    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#service-record-history-text-filter").fill(client.fullName);
    const row = page.locator('tbody tr[role="button"]').filter({ hasText: client.fullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const dialog = page.getByRole("dialog");
    const close = dialog.getByTestId("service-record-close");
    await expectCancelFirstAndSecondary(page, close, [
      dialog.getByTestId("service-record-submit"),
      dialog.getByRole("button", { name: "Void record" }),
    ]);
    // Same size as the other buttons of the row (it used to be a smaller one).
    const [closeBox, saveBox] = await Promise.all([
      close.boundingBox(),
      dialog.getByTestId("service-record-submit").boundingBox(),
    ]);
    expect(Math.abs(closeBox!.height - saveBox!.height)).toBeLessThan(2);
  });

  test("Detalle de cliente: «Cancelar» (antes sin fondo) ahora con fondo y primero", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E Cancel client ${Date.now()}`);
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    await expectCancelFirstAndSecondary(page, page.getByTestId("client-edit-cancel"), [
      page.getByTestId("client-edit-deactivate"),
      page.getByRole("button", { name: "Save", exact: true }),
    ]);
  });

  test("Configuración del negocio: «Cancelar» con el estilo del sistema, a la izquierda de Guardar", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    await expectCancelFirstAndSecondary(page, page.getByRole("button", { name: "Cancel", exact: true }), [
      page.getByRole("button", { name: "Save changes", exact: true }),
    ]);
  });

  test("Nuevo profesional: «Cancelar» con fondo y a la izquierda", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = professionalFormDialog(page);
    await expectCancelFirstAndSecondary(page, dlg.getByRole("button", { name: "Cancel", exact: true }), [
      dlg.getByRole("button", { name: "Save and set schedule" }),
    ]);
  });
});
