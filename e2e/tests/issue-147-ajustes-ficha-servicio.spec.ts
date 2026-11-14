import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { openDashboardMore } from "../fixtures/dashboard";
import { openFichaDialog, openNewFichaDialog } from "../fixtures/fichas";

/**
 * «Anular ficha» and «Cerrar» share the footer's action row. Since the ficha redesign «Anular ficha»
 * lives in that row's «⋯» menu (last item), not as a button of its own.
 */
async function expectVoidBesideClose(page: Page, dialog: Locator) {
  const closeBtn = dialog.getByTestId("service-record-close");
  const more = dialog.getByTestId("service-record-more");
  await expect(closeBtn).toBeVisible();
  await expect(more).toBeVisible();
  const [c, m] = [(await closeBtn.boundingBox())!, (await more.boundingBox())!];
  expect(Math.abs(c.y + c.height / 2 - (m.y + m.height / 2))).toBeLessThan(3);
  await expect(dialog.getByRole("button", { name: "Void record" })).toHaveCount(0);
  await more.click();
  const menu = page.getByTestId("service-record-actions-panel");
  await expect(menu.getByTestId("service-record-void-open")).toBeVisible();
  await expect(menu.getByRole("menuitem").last()).toHaveAttribute("data-testid", "service-record-void-open");
  await page.keyboard.press("Escape");
}

test.describe.configure({ mode: "serial" });

test.describe("Issue #147 · Ajustes en Ficha de servicio", () => {
  test("AC1a · desde la lista de fichas, Anular ficha (en «⋯») y Cerrar quedan en la misma fila de acciones", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E147 History ${Date.now()}`);
    await apiPostJson(request, token, "/api/service-records", {
      clientId: client.id,
      lines: [
        {
          serviceId: seed.serviceId,
          professionalId: seed.professionalId,
          quantity: 1,
          unitPrice: 50_000,
        },
      ],
      tips: [{ professionalId: seed.professionalId, amount: 0 }],
    });

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    const dialog = await openFichaDialog(page, client.fullName);

    await expectVoidBesideClose(page, dialog);
  });

  test("AC1b · desde el Panel, Anular ficha (en «⋯») y Cerrar quedan en la misma fila de acciones", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E147 Panel ${Date.now()}`);
    await apiPostJson(request, token, "/api/service-records", {
      clientId: client.id,
      lines: [
        {
          serviceId: seed.serviceId,
          professionalId: seed.professionalId,
          quantity: 1,
          unitPrice: 50_000,
        },
      ],
      tips: [{ professionalId: seed.professionalId, amount: 0 }],
    });

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    await openDashboardMore(page, "records");
    const grid = page.getByTestId("dashboard-service-records-grid");
    await expect(grid).toBeVisible({ timeout: 15_000 });
    await grid
      .getByTestId("dashboard-service-record-card")
      .filter({ hasText: client.fullName })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await expectVoidBesideClose(page, dialog);
  });

  test("AC2 · cliente inactivo no aparece en el buscador de clientes de Ficha de servicio", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E147 Inactive ${Date.now()}`);
    const deactivateRes = await request.post(`${API_BASE}/api/clients/${client.id}/deactivate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deactivateRes.ok()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    const dlg = await openNewFichaDialog(page);
    await dlg.getByLabel("Search or select client").fill(client.fullName.slice(0, 10));
    // Let the debounced search land before asserting the inactive client is absent.
    await page.waitForTimeout(1_000);
    await expect(page.getByRole("button", { name: client.fullName })).toHaveCount(0);
  });
});
