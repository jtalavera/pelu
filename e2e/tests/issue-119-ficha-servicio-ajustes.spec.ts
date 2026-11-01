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
    const dlg = await openNewFichaDialog(page);

    const submit = dlg.getByTestId("service-record-submit");
    await expect(submit).toBeDisabled();

    await pickLineService(page, 0, seed.serviceFullName);
    await pickLineProfessional(page, 0, seed.professionalFullName);
    await expect(submit).toBeDisabled();

    await pickFichaClient(page, dlg, client.fullName);
    await expect(submit).toBeEnabled();
  });

  test("AC1 · cantidad y precio unitario se cargan por defecto y son editables; el total los usa", async ({
    page,
  }) => {
    await loginAsDemo(page);
    const dlg = await openNewFichaDialog(page);

    await pickLineService(page, 0, seed.serviceFullName);
    await pickLineProfessional(page, 0, seed.professionalFullName);

    // Defaults from the picked service: unit price = service price, quantity = 1.
    await expect(page.locator("#service-record-line-price-0")).toHaveValue("50.000");
    await expect(page.locator("#service-record-line-qty-0")).toHaveValue("1");
    const total = dlg.getByTestId("service-record-total");
    await expect(total).toContainText("50.000");

    // Editing quantity recomputes the total.
    await setControlledInputValue(page.locator("#service-record-line-qty-0"), "3");
    await expect(total).toContainText("150.000");

    // Editing the unit price directly also recomputes the total.
    await setControlledInputValue(page.locator("#service-record-line-price-0"), "40000");
    await expect(total).toContainText("120.000");
  });

  test("AC3+AC4+AC5 · al guardar una ficha nueva, la pantalla sube arriba, se limpia y muestra el nuevo mensaje", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E119 Reset ${Date.now()}`);

    await loginAsDemo(page);
    const dlg = await openNewFichaDialog(page);

    await pickFichaClient(page, dlg, client.fullName);
    await pickLineService(page, 0, seed.serviceFullName);
    await pickLineProfessional(page, 0, seed.professionalFullName);
    await dlg.getByTestId("service-record-submit").click();

    // Redesign: saving closes the dialog and a toast confirms it on the list.
    await expect(page.getByTestId("service-records-toast")).toContainText("Record saved.", {
      timeout: 15_000,
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(10);

    // Reopening the dialog starts from a clean form: no client and a single blank service line.
    await page.getByTestId("service-records-new").click();
    await expect(page.getByRole("dialog").getByLabel("Search or select client")).toHaveValue("");
    await expect(page.locator('[id^="service-record-line-svc-"]')).toHaveCount(1);
    await expect(page.locator("#service-record-line-svc-0")).toHaveValue("");
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
    const dialog = await openFichaDialog(page, client.fullName);
    const priceInput = dialog.locator("#service-record-line-price-0");
    const qtyInput = dialog.locator("#service-record-line-qty-0");
    await expect(priceInput).toHaveValue("50.000");
    await expect(qtyInput).toHaveValue("2");

    // Layout: the service spans the full width and, below it, Professional · Qty · Price in a row.
    const svcBox = await dialog.locator("#service-record-line-svc-0").boundingBox();
    const profBox = await dialog.locator("#service-record-line-prof-0").boundingBox();
    const priceBox = await priceInput.boundingBox();
    const qtyBox = await qtyInput.boundingBox();
    expect(svcBox && profBox && priceBox && qtyBox).toBeTruthy();
    expect(svcBox!.y).toBeLessThan(profBox!.y);
    expect(profBox!.x).toBeLessThanOrEqual(qtyBox!.x);
    expect(qtyBox!.x).toBeLessThanOrEqual(priceBox!.x);
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
    const dialog = await openFichaDialog(page, client.fullName);
    await expect(dialog.getByTestId("service-record-total")).toContainText("100.000");

    await expandFichaLine(dialog, 0);
    await dialog.getByTestId("service-record-line-remove").click();
    await dialog.getByTestId("service-record-submit").click();
    await expect(page.getByTestId("service-records-toast")).toContainText("Changes saved.", {
      timeout: 15_000,
    });

    // Reload fresh from the server and confirm the removed line really is gone.
    const dialog2 = await openFichaDialog(page, client.fullName);
    await expect(dialog2.getByTestId("service-record-total")).toContainText("50.000", {
      timeout: 15_000,
    });
    await expect(dialog2.getByTestId("service-record-line")).toHaveCount(1);
  });

  // Redesign: an existing ficha keeps its client (one read-only "CLIENTE · name" line); the old
  // "change client" action was removed on purpose, so the spec now guards that.
  test("AC7 · una ficha existente muestra su cliente y ya no permite cambiarlo", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E119 OrigClient ${Date.now()}`);
    await createServiceRecordApi(request, token, {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId }],
    });

    await loginAsDemo(page);
    const dialog = await openFichaDialog(page, client.fullName);
    await expect(dialog).toContainText(client.fullName.toUpperCase());
    await expect(dialog.getByLabel("Search or select client")).toHaveCount(0);
  });
});
