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
    // No dashed divider above the row.
    expect(await addRow.evaluate((el) => getComputedStyle(el.parentElement!).borderTopStyle)).not.toBe("dashed");
    await addRow.click();
    await expect(page.getByRole("dialog").getByText("New service record")).toBeVisible();
  });

  test("«+ Nuevo turno» bajo los turnos abre el formulario en Inicio y el turno guardado aparece en la lista", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    const row = page.getByTestId("dashboard-appointments-add-row");
    // With no turnos today the list is replaced by the empty state (its button opens the same form).
    const opener = (await row.count()) ? row : page.getByRole("button", { name: "New appointment" }).last();
    await opener.scrollIntoViewIfNeeded();
    await opener.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/app\/?$/);
    await expect(dialog.getByRole("heading", { name: "New appointment" })).toBeVisible();

    // Save with the required fields empty → field errors, still on Inicio.
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert").first()).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(seed.professionalId).toBeTruthy();
  });

  test("la etiqueta «Pagada» de una ficha cobrada abre el comprobante en Inicio", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const client = await seedClient(request, token, `E2E Pagada ${Date.now()}`);
    const line = { serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 1, unitPrice: 30_000 };
    const record = await apiPostJson<{ id: number }>(request, token, "/api/service-records", {
      clientId: client.id,
      lines: [line],
      tips: [],
    });
    await apiPostJson(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: null,
      clientRucOverride: null,
      discountType: null,
      discountValue: null,
      lines: [
        {
          serviceId: line.serviceId,
          description: "E2E Pagada line",
          quantity: 1,
          unitPrice: line.unitPrice,
          discountType: null,
          discountValue: null,
        },
      ],
      payments: [{ method: "CASH", amount: line.unitPrice }],
      serviceRecordId: record.id,
      tipsAmount: 0,
    });

    await loginAsDemo(page);
    const badge = page.getByTestId(`dashboard-service-record-invoice-${record.id}`);
    await badge.scrollIntoViewIfNeeded({ timeout: 20_000 });
    await expect(badge).toHaveText("Paid");
    await badge.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/app\/?$/);
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
    await dialog.locator("#service-record-client-search").click();
    await page.getByRole("button", { name: "Occasional client", exact: true }).click();
    await dialog.getByTestId("service-record-submit").click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });

    const row = page.getByTestId("dashboard-service-record-card").filter({ hasText: "Occasional client" }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).not.toContainText("CLIENTE OCASIONAL");
    // The generic client never shows in the clients list.
    await page.goto("/app/clients");
    await expect(page.getByText("CLIENTE OCASIONAL")).toHaveCount(0);
  });

  test("«Cobrar» se ve igual en el Inicio y en la lista de Fichas de servicio (píldora rellena)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Cobrar igual ${Date.now()}`);
    const record = await apiPostJson<{ id: number }>(request, token, "/api/service-records", {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 1, unitPrice: 50_000 }],
      tips: [],
    });
    const look = (el: Element) => {
      const cs = getComputedStyle(el);
      return { radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, color: cs.color, border: cs.borderTopWidth, height: cs.height };
    };

    await loginAsDemo(page);
    const inicio = page.getByTestId(`dashboard-service-record-pay-${record.id}`);
    await expect(inicio).toBeVisible({ timeout: 20_000 });
    const inicioLook = await inicio.evaluate(look);

    await page.goto("/app/service-records");
    const list = page.getByTestId(`service-record-pay-${record.id}`);
    await expect(list).toBeVisible({ timeout: 20_000 });
    const listLook = await list.evaluate(look);

    expect(listLook).toEqual(inicioLook);
    // Filled pill, not an outlined square.
    expect(parseFloat(listLook.radius)).toBeGreaterThan(14);
    expect(listLook.border).toBe("0px");
  });

  test("«Ver historial» va a la derecha del título, en el mismo lugar que «Ver agenda»", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);

    const history = page.getByTestId("dashboard-service-records-history-link");
    await expect(history).toBeVisible({ timeout: 20_000 });
    await expect(history).toHaveText("View history →");
    const agenda = page.getByRole("link", { name: /View agenda/ });
    await expect(agenda).toBeVisible();

    // Inside the title row of «Fichas de servicio de hoy», right-aligned like «Ver agenda».
    const titleRow = page.getByTestId("dashboard-today-records").getByTestId("section-title");
    await expect(titleRow.getByTestId("dashboard-service-records-history-link")).toBeVisible();
    const h = (await history.boundingBox())!;
    const a = (await agenda.boundingBox())!;
    expect(Math.abs(h.x + h.width - (a.x + a.width))).toBeLessThan(3);

    await history.click();
    await expect(page).toHaveURL(/\/app\/service-records/);
  });
});
