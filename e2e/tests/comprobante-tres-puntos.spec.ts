import { expect, test } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { goToInvoiceHistory, searchInvoiceHistory } from "../fixtures/billing";

/**
 * Detalle del comprobante: «Más acciones» es el «⋯» redondo, igual que en la ficha de servicio y en el
 * detalle del turno; va al final (derecha) de la fila «Cerrar · Compartir · ⋯» y conserva su menú.
 */
test.describe.configure({ mode: "serial" });

test.describe("Detalle del comprobante · «⋯» en lugar de «Más acciones»", () => {
  test("el menú es un «⋯» de 44 px a la derecha de la fila, con el mismo alto que «Cerrar», y abre sus opciones", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Puntos ${Date.now()}`);
    await apiPostJson(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 10000 }],
      payments: [{ method: "CASH", amount: 10000 }],
    });

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page
      .locator('[data-testid^="invoice-history-row-"]')
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const dialog = page.getByRole("dialog");
    const more = dialog.getByTestId("invoice-more-actions-button");
    await expect(more).toBeVisible({ timeout: 20_000 });

    // A round «⋯», still named «More actions» for assistive tech.
    await expect(more).toHaveText("⋯");
    await expect(more).toHaveAccessibleName(/more actions/i);
    const close = dialog.getByRole("button", { name: /^Close/ }).last();
    const [m, c] = await Promise.all([more.boundingBox(), close.boundingBox()]);
    expect(Math.round(m!.width)).toBe(44);
    expect(Math.round(m!.height)).toBe(44);
    expect(Math.round(c!.height)).toBe(44);
    // Same row, «Cerrar» on the left and «⋯» on the right.
    expect(Math.abs(m!.y - c!.y)).toBeLessThan(3);
    expect(c!.x).toBeLessThan(m!.x);
    const dlg = (await dialog.boundingBox())!;
    expect(m!.x + m!.width).toBeGreaterThan(dlg.x + dlg.width - 40);

    // It keeps opening its menu.
    await more.click();
    await expect(dialog.getByTestId("invoice-more-actions-menu").or(page.getByTestId("invoice-more-actions-menu"))).toBeVisible();
    await expect(page.getByRole("menuitem").first()).toBeVisible();
  });
});
