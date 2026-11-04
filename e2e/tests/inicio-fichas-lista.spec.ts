import { expect, test } from "@playwright/test";
import {
  apiPostJson,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Inicio · «Fichas de servicio de hoy» como lista de filas:
 *  - nombre en una línea y de tamaño moderado (no se parte); «Cobrar» chico (30 px, área táctil de 44 px);
 *  - la ficha del cliente genérico se ve como «Occasional client» (traducido), no como el nombre guardado;
 *  - la lista termina con «+ Nueva ficha» y la cabecera trae «Nueva ficha» junto a «Nuevo turno»;
 *  - «Nueva ficha» permite elegir «Occasional client» sin cliente registrado.
 */
test.describe.configure({ mode: "serial" });

test.describe("Inicio · fichas de hoy en lista", () => {
  test("fila: nombre en una línea, «Cobrar» chico y datos del turno/profesional", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Lista ${Date.now()} con un nombre bastante largo para cortar`);
    await apiPostJson(request, token, "/api/service-records", {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 1, unitPrice: 50_000 }],
      tips: [],
    });

    await loginAsDemo(page);
    const row = page.getByTestId("dashboard-service-record-card").filter({ hasText: "E2E Lista" }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    // The name stays on one line, at 14 px.
    const nameBox = row.locator(".truncate").first();
    const [box, fontSize] = await Promise.all([
      nameBox.boundingBox(),
      nameBox.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ]);
    expect(fontSize).toBeLessThanOrEqual(15);
    expect(box!.height).toBeLessThan(24);

    // «Cobrar» is a small pill (30 px) and the amount sits beside it.
    const pay = row.getByRole("button", { name: /^Charge/ });
    const payBox = await pay.boundingBox();
    expect(payBox!.height).toBeLessThanOrEqual(32);
    await expect(row).toContainText("50.000");
  });

  test("la lista termina con «+ Nueva ficha» y la cabecera la ofrece junto a «Nuevo turno»", async ({ page }) => {
    await loginAsDemo(page);
    const header = page.getByTestId("dashboard-new-service-record");
    await expect(header).toBeVisible({ timeout: 20_000 });
    await expect(header).toHaveText("+ New service record");
    // Same row, same weight and height as «Nuevo turno».
    const appointment = page.locator('[data-tour="dashboard-new-appointment"]');
    const [a, b] = await Promise.all([appointment.boundingBox(), header.boundingBox()]);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(4);
    expect(Math.abs(a!.height - b!.height)).toBeLessThan(2);
    expect(await appointment.getAttribute("class")).toBe(await header.getAttribute("class"));

    // The header button and the list's last row open the same dialog.
    await header.click();
    await expect(page.getByRole("dialog").getByText("New service record")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const addRow = page.getByTestId("dashboard-service-records-add-row");
    await addRow.scrollIntoViewIfNeeded();
    await addRow.click();
    await expect(page.getByRole("dialog").getByText("New service record")).toBeVisible();
  });

  test("Nueva ficha para «Occasional client»: se guarda sin cliente registrado y se ve traducida en la lista", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.getByTestId("dashboard-new-service-record").click({ timeout: 20_000 });
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await dialog.getByTestId("service-record-submit").click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });

    const row = page.getByTestId("dashboard-service-record-card").filter({ hasText: "Occasional client" }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).not.toContainText("CLIENTE OCASIONAL");
    // The generic client never shows in the clients list.
    await page.goto("/app/clients");
    await expect(page.getByText("CLIENTE OCASIONAL")).toHaveCount(0);
  });
});
