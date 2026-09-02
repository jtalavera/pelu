import { expect, test, type Page } from "@playwright/test";
import {
  apiPostJson,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  type SeededSalon,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { setControlledInputValue } from "../fixtures/ui";

test.describe.configure({ mode: "serial" });

type ServiceRecordSeed = { id: number; status: string };

async function seedProfessional(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  fullName: string,
): Promise<{ id: number; fullName: string }> {
  // Names are stored in UPPERCASE (issue #155 AC3) — return what's actually displayed,
  // not the mixed-case string sent above.
  return apiPostJson<{ id: number; fullName: string }>(request, token, "/api/professionals", {
    fullName,
    phone: null,
    email: null,
    photoDataUrl: null,
  });
}

async function createServiceRecordApi(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  body: {
    clientId: number;
    lines: Array<{
      serviceId: number;
      professionalId: number;
      quantity?: number;
      unitPrice?: number;
    }>;
    tips?: Array<{ professionalId: number; amount: number }>;
  },
): Promise<ServiceRecordSeed> {
  return apiPostJson<ServiceRecordSeed>(request, token, "/api/service-records", {
    clientId: body.clientId,
    lines: body.lines.map((l) => ({
      serviceId: l.serviceId,
      professionalId: l.professionalId,
      quantity: l.quantity ?? 1,
      unitPrice: l.unitPrice ?? 50000,
    })),
    tips: body.tips ?? [],
  });
}

async function pickLineService(page: Page, idx: number, serviceFullName: string): Promise<void> {
  await page.locator(`#service-record-line-svc-${idx}`).fill(serviceFullName.slice(0, 12));
  await page.getByRole("button", { name: serviceFullName, exact: false }).click();
}

async function pickLineProfessional(page: Page, idx: number, fullName: string): Promise<void> {
  const input = page.locator(`#service-record-line-prof-${idx}`);
  await input.click();
  await input.fill(fullName.slice(0, 10));
  await page
    .locator(`#service-record-line-prof-${idx}-listbox`)
    .getByRole("button", { name: fullName, exact: false })
    .click();
}

/** Opens the History tab and filters by free-text query; returns the matching row. */
async function findHistoryRow(page: Page, query: string) {
  await page.goto("/app/service-records");
  await page.getByRole("tab", { name: "History" }).click();
  await page.locator("#service-record-history-text-filter").fill(query);
  return page.locator("tbody tr").filter({ hasText: query }).first();
}

test.describe("Issue #119 · Ajustes en Ficha de servicio y Facturación", () => {
  let seed: SeededSalon;
  let secondProfessional: { id: number; fullName: string };

  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    seed = await seedCategoryServiceProfessional(request, token);
    secondProfessional = await seedProfessional(request, token, `E2E119 Prof2 ${Date.now()}`);
  });

  test("AC2 · el botón Guardar solo se habilita con un cliente seleccionado", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E119 Client ${Date.now()}`);

    await loginAsDemo(page);
    await page.goto("/app/service-records");

    const submit = page.getByTestId("service-record-submit");
    await expect(submit).toBeDisabled();

    await page.getByRole("button", { name: "Add service" }).click();
    await pickLineService(page, 0, seed.serviceFullName);
    await pickLineProfessional(page, 0, seed.professionalFullName);
    await expect(submit).toBeDisabled();

    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName, exact: false }).click();
    await expect(submit).toBeEnabled();
  });

  test("AC1 · cantidad y precio unitario se cargan por defecto y son editables; el total los usa", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/service-records");

    const clientName = `E2E119 Qty ${Date.now()}`;
    await page.getByLabel("Search or select client").fill(clientName.slice(0, 8));

    await page.getByRole("button", { name: "Add service" }).click();
    await pickLineService(page, 0, seed.serviceFullName);
    await pickLineProfessional(page, 0, seed.professionalFullName);

    // Defaults from the picked service: unit price = service price, quantity = 1.
    await expect(page.locator("#service-record-line-price-0")).toHaveValue("50.000");
    await expect(page.locator("#service-record-line-qty-0")).toHaveValue("1");
    await expect(page.getByText(/^50\.000$/)).toBeVisible();

    // Editing quantity recomputes the total.
    await setControlledInputValue(page.locator("#service-record-line-qty-0"), "3");
    await expect(page.getByText(/^150\.000$/)).toBeVisible();

    // Editing the unit price directly also recomputes the total.
    await setControlledInputValue(page.locator("#service-record-line-price-0"), "40000");
    await expect(page.getByText(/^120\.000$/)).toBeVisible();
  });

  test("AC3+AC4+AC5 · al guardar una ficha nueva, la pantalla sube arriba, se limpia y muestra el nuevo mensaje", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E119 Reset ${Date.now()}`);

    await loginAsDemo(page);
    await page.goto("/app/service-records");

    // No manual "+ New record" button anymore (issue #119 AC5).
    await expect(page.getByRole("button", { name: "+ New record" })).toHaveCount(0);

    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName, exact: false }).click();
    await page.getByRole("button", { name: "Add service" }).click();
    await pickLineService(page, 0, seed.serviceFullName);
    await pickLineProfessional(page, 0, seed.professionalFullName);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByRole("button", { name: "Save record" }).click();

    await expect(
      page.getByRole("alert").filter({
        hasText:
          "Service record created successfully. You can check it on the Dashboard or in the Service record history.",
      }),
    ).toBeVisible({ timeout: 15_000 });

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(10);
    await expect(page.getByLabel("Search or select client")).toHaveValue("");
    // Issue #133: the reset "New record" form shows no blank line, only "Add service".
    await expect(page.locator('[id^="service-record-line-svc-"]')).toHaveCount(0);
  });

  test("AC6 · el detalle de una ficha muestra Cantidad y Precio unitario editables en el mismo orden", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E119 Detail ${Date.now()}`);
    await createServiceRecordApi(request, token, {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 2 }],
    });

    await loginAsDemo(page);
    const row = await findHistoryRow(page, client.fullName);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // The underlying page (History table row, hidden "New record" tab) stays mounted behind
    // the modal, so scope to the dialog to avoid duplicate-match ambiguity on shared line ids.
    const dialog = page.getByRole("dialog", { name: "Service record detail" });
    const priceInput = dialog.locator("#service-record-line-price-0");
    const qtyInput = dialog.locator("#service-record-line-qty-0");
    await expect(priceInput).toHaveValue("50.000");
    await expect(qtyInput).toHaveValue("2");

    // Column order left-to-right: Service, Professional, Unit price, Quantity.
    const svcBox = await dialog.locator("#service-record-line-svc-0").boundingBox();
    const profBox = await dialog.locator("#service-record-line-prof-0").boundingBox();
    const priceBox = await priceInput.boundingBox();
    const qtyBox = await qtyInput.boundingBox();
    expect(svcBox && profBox && priceBox && qtyBox).toBeTruthy();
    expect(svcBox!.x).toBeLessThan(profBox!.x);
    expect(profBox!.x).toBeLessThanOrEqual(priceBox!.x);
    expect(priceBox!.x).toBeLessThanOrEqual(qtyBox!.x);
  });

  test("AC7 · quitar un servicio de una ficha abierta y guardar persiste el cambio", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E119 RemoveLine ${Date.now()}`);
    await createServiceRecordApi(request, token, {
      clientId: client.id,
      lines: [
        { serviceId: seed.serviceId, professionalId: seed.professionalId },
        { serviceId: seed.serviceId, professionalId: secondProfessional.id },
      ],
    });

    await loginAsDemo(page);
    const row = await findHistoryRow(page, client.fullName);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    // The underlying page (History table row, hidden "New record" tab) stays mounted behind
    // the modal, so scope to the dialog to avoid duplicate-match ambiguity.
    const dialog = page.getByRole("dialog", { name: "Service record detail" });
    await expect(dialog.getByText(/^100\.000$/)).toBeVisible();

    await dialog.getByRole("button", { name: "Remove" }).first().click();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Changes saved." })).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByText(/^50\.000$/)).toBeVisible();

    // Reload fresh from the server and confirm the removed line really is gone.
    const row2 = await findHistoryRow(page, client.fullName);
    await expect(row2).toBeVisible({ timeout: 15_000 });
    await row2.click();
    await expect(dialog.getByText(/^50\.000$/)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.locator('[id^="service-record-line-svc-"]')).toHaveCount(1);
  });

  test("AC7 · cambiar el cliente de una ficha abierta y guardar persiste el cambio", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const originalClient = await seedClient(request, token, `E2E119 OrigClient ${Date.now()}`);
    const newClient = await seedClient(request, token, `E2E119 NewClient ${Date.now()}`);
    await createServiceRecordApi(request, token, {
      clientId: originalClient.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId }],
    });

    await loginAsDemo(page);
    const row = await findHistoryRow(page, originalClient.fullName);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    // The underlying page (History table row, hidden "New record" tab) stays mounted behind
    // the modal, so scope to the dialog to avoid duplicate-match ambiguity.
    const dialog = page.getByRole("dialog", { name: "Service record detail" });

    await dialog.getByLabel("Search or select client").fill(newClient.fullName.slice(0, 8));
    // The suggestion dropdown is rendered in a portal outside the dialog's DOM subtree.
    await page.getByRole("button", { name: newClient.fullName, exact: false }).click();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Changes saved." })).toBeVisible({
      timeout: 15_000,
    });

    // Reload fresh from the server and confirm the new client really persisted.
    const row2 = await findHistoryRow(page, newClient.fullName);
    await expect(row2).toBeVisible({ timeout: 15_000 });
    await row2.click();
    await expect(dialog.getByText(newClient.fullName)).toBeVisible({ timeout: 15_000 });

    const oldClientGone = await findHistoryRow(page, originalClient.fullName);
    await expect(oldClientGone).toHaveCount(0);
  });
});
