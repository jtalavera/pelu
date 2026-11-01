import { expect, test, type Page } from "@playwright/test";
import {
  apiPostJson,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  type SeededSalon,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { openDashboardMore } from "../fixtures/dashboard";
import { setControlledInputValue } from "../fixtures/ui";
import {
  expandFichaLine,
  openFichaDialog,
  openNewFichaDialog,
  pickFichaClient,
  pickLineProfessional,
  pickLineService,
} from "../fixtures/fichas";

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
    const dlg = await openNewFichaDialog(page);
    await pickFichaClient(page, dlg, client.fullName);
    await pickLineService(page, 0, seed.serviceFullName);
    await pickLineProfessional(page, 0, seed.professionalFullName);
    await dlg.getByTestId("service-record-submit").click();

    // Redesign: one toast on the list (not an inline alert) — it must render only once.
    const toast = page.getByTestId("service-records-toast");
    await expect(toast).toContainText("Record saved.", { timeout: 15_000 });
    const text = (await toast.textContent())?.replace(/\s+/g, " ").trim();
    expect(text).toBe("Record saved.");
    await expect(page.getByText("Record saved.")).toHaveCount(1);
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
    const dialog = await openFichaDialog(page, client.fullName);
    const box = await dialog.boundingBox();
    expect(box).toBeTruthy();
    // The redesigned detail is deliberately narrower (max-w-xl) but wide enough for every field.
    expect(box!.width).toBeGreaterThan(450);
    expect(box!.width).toBeLessThanOrEqual(600);

    // All line-item fields fit and are visible without needing horizontal scroll.
    await expect(dialog.locator("#service-record-line-svc-0")).toBeVisible();
    await expect(dialog.locator("#service-record-line-prof-0")).toBeVisible();
    await expect(dialog.locator("#service-record-line-price-0")).toBeVisible();
    await expect(dialog.locator("#service-record-line-qty-0")).toBeVisible();
    const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("Fix 3 · se puede guardar una ficha con solo un cliente, sin servicios", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E129 NoLines ${Date.now()}`);

    await loginAsDemo(page);
    const dlg = await openNewFichaDialog(page);
    await pickFichaClient(page, dlg, client.fullName);

    // The blank default line has no service picked, so saving only needs a client.
    await dlg.getByTestId("service-record-submit").click();
    await expect(page.getByTestId("service-records-toast")).toContainText("Record saved.", {
      timeout: 15_000,
    });

    const dialog = await openFichaDialog(page, client.fullName);
    await expect(dialog.getByTestId("service-record-total")).toContainText("0");
    // No saved services: the editor only shows its blank placeholder line.
    await expect(dialog.locator("#service-record-line-svc-0")).toHaveValue("");
  });

  test("Fix 3 · se puede guardar un servicio sin profesional, precio ni cantidad", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E129 PartialLine ${Date.now()}`);

    await loginAsDemo(page);
    const dlg = await openNewFichaDialog(page);
    await pickFichaClient(page, dlg, client.fullName);
    await pickLineService(page, 0, seed.serviceFullName);

    // Clear the auto-filled unit price/quantity and leave professional unselected.
    await setControlledInputValue(page.locator("#service-record-line-price-0"), "");
    await setControlledInputValue(page.locator("#service-record-line-qty-0"), "0");

    const submit = dlg.getByTestId("service-record-submit");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByTestId("service-records-toast")).toContainText("Record saved.", {
      timeout: 15_000,
    });

    const dialog = await openFichaDialog(page, client.fullName);
    await expandFichaLine(dialog, 0);

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

    await openDashboardMore(page, "records");
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
