import { expect, test } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe.configure({ mode: "serial" });

test.describe("Issue #147 · Ajustes en Ficha de servicio", () => {
  test("AC1a · desde Historial de fichas, Cerrar aparece junto y alineado a Anular ficha", async ({
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
    await page.goto("/app/service-records");
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await page.locator("#service-record-history-text-filter").fill(client.fullName);
    await page.getByRole("button", { name: "View" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const voidBtn = dialog.getByRole("button", { name: "Void record" });
    const closeBtn = dialog.getByTestId("service-record-close");
    await expect(voidBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();

    const voidBox = await voidBtn.boundingBox();
    const closeBox = await closeBtn.boundingBox();
    expect(voidBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    // "aligned to" — both sit in the same action row, so their tops line up.
    expect(Math.abs(voidBox!.y - closeBox!.y)).toBeLessThan(5);
    // "right next to" — Close sits immediately to the right of Anular ficha in the row.
    expect(closeBox!.x).toBeGreaterThan(voidBox!.x);
  });

  test("AC1b · desde el Panel, Cerrar aparece junto y alineado a Anular ficha", async ({
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
    await page.goto("/app");
    const grid = page.getByTestId("dashboard-service-records-grid");
    await expect(grid).toBeVisible({ timeout: 15_000 });
    await grid
      .getByTestId("dashboard-service-record-card")
      .filter({ hasText: client.fullName })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const voidBtn = dialog.getByRole("button", { name: "Void record" });
    const closeBtn = dialog.getByTestId("service-record-close");
    await expect(voidBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();

    const voidBox = await voidBtn.boundingBox();
    const closeBox = await closeBtn.boundingBox();
    expect(voidBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(Math.abs(voidBox!.y - closeBox!.y)).toBeLessThan(5);
    expect(closeBox!.x).toBeGreaterThan(voidBox!.x);
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
    await page.goto("/app/service-records");
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 10));
    await expect(page.getByRole("button", { name: client.fullName })).toHaveCount(0);
  });
});
