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

async function createServiceRecordApi(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  body: {
    clientId: number;
    lines: Array<{
      serviceId: number;
      professionalId?: number | null;
      quantity?: number | null;
      unitPrice?: number | null;
    }>;
  },
): Promise<ServiceRecordSeed> {
  return apiPostJson<ServiceRecordSeed>(request, token, "/api/service-records", {
    clientId: body.clientId,
    lines: body.lines.map((l) => ({
      serviceId: l.serviceId,
      professionalId: l.professionalId ?? null,
      quantity: l.quantity ?? 1,
      unitPrice: l.unitPrice ?? 50000,
    })),
    tips: [],
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

test.describe("Issue #129 · Ajustes en Ficha de servicio (iteración 2)", () => {
  let seed: SeededSalon;

  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    seed = await seedCategoryServiceProfessional(request, token);
  });

  test("Fix 1 · el mensaje de guardado exitoso no aparece duplicado", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E129 Msg ${Date.now()}`);

    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName, exact: false }).click();
    await page.getByRole("button", { name: "Add service" }).click();
    await pickLineService(page, 0, seed.serviceFullName);
    await pickLineProfessional(page, 0, seed.professionalFullName);
    await page.getByRole("button", { name: "Save record" }).click();

    const expectedMessage =
      "Service record created successfully. You can check it on the Dashboard or in the Service record history.";
    const alert = page.getByRole("alert").filter({ hasText: expectedMessage });
    await expect(alert).toBeVisible({ timeout: 15_000 });

    // A substring match would still pass if the message were duplicated; assert the exact
    // trimmed text of the alert to prove it renders only once.
    const text = (await alert.textContent())?.replace(/\s+/g, " ").trim();
    expect(text).toBe(expectedMessage);
  });

  test("Fix 2 · el modal de detalle es suficientemente ancho para mostrar las columnas", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E129 Modal ${Date.now()}`);
    await createServiceRecordApi(request, token, {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId }],
    });

    await loginAsDemo(page);
    const row = await findHistoryRow(page, client.fullName);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "View" }).click();

    const dialog = page.getByRole("dialog", { name: "Service record detail" });
    const box = await dialog.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(700);

    // All 4 line-item fields fit and are visible without needing horizontal scroll.
    await expect(dialog.locator("#service-record-line-svc-0")).toBeVisible();
    await expect(dialog.locator("#service-record-line-prof-0")).toBeVisible();
    await expect(dialog.locator("#service-record-line-price-0")).toBeVisible();
    await expect(dialog.locator("#service-record-line-qty-0")).toBeVisible();
  });

  test("Fix 3 · se puede guardar una ficha con solo un cliente, sin servicios", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E129 NoLines ${Date.now()}`);

    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName, exact: false }).click();

    // Issue #133: no default line is seeded — a ficha may be saved with zero services.
    await expect(page.locator('[id^="service-record-line-svc-"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Save record" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Service record created successfully" }),
    ).toBeVisible({ timeout: 15_000 });

    const row = await findHistoryRow(page, client.fullName);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "View" }).click();
    const dialog = page.getByRole("dialog", { name: "Service record detail" });
    await expect(dialog.locator('[id^="service-record-line-svc-"]')).toHaveCount(0);
  });

  test("Fix 3 · se puede guardar un servicio sin profesional, precio ni cantidad", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E129 PartialLine ${Date.now()}`);

    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName, exact: false }).click();
    await page.getByRole("button", { name: "Add service" }).click();
    await pickLineService(page, 0, seed.serviceFullName);

    // Clear the auto-filled unit price/quantity and leave professional unselected.
    await setControlledInputValue(page.locator("#service-record-line-price-0"), "");
    await setControlledInputValue(page.locator("#service-record-line-qty-0"), "0");

    const submit = page.getByRole("button", { name: "Save record" });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Service record created successfully" }),
    ).toBeVisible({ timeout: 15_000 });

    const row = await findHistoryRow(page, client.fullName);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "View" }).click();
    const dialog = page.getByRole("dialog", { name: "Service record detail" });

    // Backend defaults: quantity → 1, unit price → 0, professional stays unset.
    await expect(dialog.locator("#service-record-line-qty-0")).toHaveValue("1");
    await expect(dialog.locator("#service-record-line-price-0")).toHaveValue("0");
  });

  test("Fix 4 · el panel muestra las fichas de hoy en una grilla limitada a 12 con botón Más", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    // Other tests in this run may also create "today" records for other clients — tag each
    // seeded client with a unique marker so card counts here aren't polluted by that state.
    const marker = `E2E129 Dashboard ${Date.now()}`;
    for (let i = 0; i < 15; i++) {
      const client = await seedClient(request, token, `${marker} ${i}`);
      await createServiceRecordApi(request, token, {
        clientId: client.id,
        lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId }],
      });
    }

    await loginAsDemo(page);
    await page.goto("/app");

    const grid = page.getByTestId("dashboard-service-records-grid");
    await expect(grid).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(marker, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });

    const allCards = page.getByTestId("dashboard-service-record-card");
    await expect(allCards).toHaveCount(12);
    const markedCards = allCards.filter({ hasText: marker });

    // Cards lay out in a multi-row grid, not a single horizontally-scrolling row.
    const firstBox = await allCards.nth(0).boundingBox();
    const lastBox = await allCards.nth(11).boundingBox();
    expect(firstBox && lastBox).toBeTruthy();
    expect(lastBox!.y).toBeGreaterThan(firstBox!.y);

    const moreButton = page.getByTestId("dashboard-service-records-more");
    await expect(moreButton).toBeVisible();
    await moreButton.click();

    await expect(markedCards).toHaveCount(15);
    await expect(page).toHaveURL(/\/app\/?$/);
  });
});
