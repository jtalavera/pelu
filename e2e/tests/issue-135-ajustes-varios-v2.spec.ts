import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  type SeededSalon,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { openDashboardMore } from "../fixtures/dashboard";
import { setControlledInputValue } from "../fixtures/ui";
import { openFichaDialog } from "../fixtures/fichas";
import {
  filterPropinasByProfessional,
  openWithdrawDialog,
  propinasMovements,
} from "../fixtures/propinas";

test.describe.configure({ mode: "serial" });

type ServiceRecordSeed = { id: number; status: string };

async function seedOpenRecordWithLines(
  request: APIRequestContext,
  token: string,
  params: {
    clientId: number;
    serviceId: number;
    professionalId: number;
    unitPrice: number;
    lineCount: number;
  },
): Promise<ServiceRecordSeed> {
  return apiPostJson<ServiceRecordSeed>(request, token, "/api/service-records", {
    clientId: params.clientId,
    lines: Array.from({ length: params.lineCount }, () => ({
      serviceId: params.serviceId,
      professionalId: params.professionalId,
      quantity: 1,
      unitPrice: params.unitPrice,
    })),
    tips: [{ professionalId: params.professionalId, amount: 0 }],
  });
}

async function seedProfessional(
  request: APIRequestContext,
  token: string,
  fullName: string,
): Promise<{ id: number }> {
  return apiPostJson<{ id: number }>(request, token, "/api/professionals", {
    fullName,
    phone: null,
    email: null,
    photoDataUrl: null,
  });
}

/**
 * Creates an open ficha de servicio with a tip for one professional, then issues an invoice
 * referencing it so the ficha auto-closes — Propinas only reports/accumulates CLOSED-record tips.
 */
async function seedClosedTip(
  request: APIRequestContext,
  token: string,
  params: {
    clientId: number;
    serviceId: number;
    professionalId: number;
    unitPrice: number;
    tipAmount: number;
  },
): Promise<{ recordId: number; invoiceId: number }> {
  const record = await apiPostJson<ServiceRecordSeed>(request, token, "/api/service-records", {
    clientId: params.clientId,
    lines: [
      {
        serviceId: params.serviceId,
        professionalId: params.professionalId,
        quantity: 1,
        unitPrice: params.unitPrice,
      },
    ],
    tips: [{ professionalId: params.professionalId, amount: params.tipAmount }],
  });
  const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
    clientId: params.clientId,
    clientDisplayName: null,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [
      {
        serviceId: params.serviceId,
        description: "E2E service",
        quantity: 1,
        unitPrice: params.unitPrice,
        discountType: null,
        discountValue: null,
      },
    ],
    payments: [{ method: "CASH", amount: params.unitPrice }],
    serviceRecordId: record.id,
    tipsAmount: params.tipAmount,
  });
  return { recordId: record.id, invoiceId: invoice.id };
}

test.describe("Issue #135 · Ajustes varios v2", () => {
  let seed: SeededSalon;

  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    seed = await seedCategoryServiceProfessional(request, token);
  });

  test("1 · al actualizar una ficha desde la lista, el diálogo se cierra y el aviso de respuesta queda a la vista", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 380, height: 380 });
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E135 Hist ${Date.now()}`);
    await seedOpenRecordWithLines(request, token, {
      clientId: client.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 50000,
      lineCount: 4,
    });

    await loginAsDemo(page);
    const dialog = await openFichaDialog(page, client.fullName);
    const scrollContainer = dialog.locator(".overflow-y-auto");

    // Open the folded tips section and scroll to the bottom of the form before saving, simulating
    // a user who scrolled past the top while editing a field further down.
    await dialog.getByTestId("service-record-tips-toggle").click();
    await expect
      .poll(async () => {
        await scrollContainer.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        return scrollContainer.evaluate((el) => el.scrollTop);
      })
      .toBeGreaterThan(0);

    const tipInput = dialog.locator(`#service-record-tip-${seed.professionalId}`);
    await setControlledInputValue(tipInput, "1000");
    await dialog.getByTestId("service-record-submit").click();

    // Redesign: saving closes the dialog and a toast confirms it, already in view (no scrolling).
    const toast = page.getByTestId("service-records-toast");
    await expect(toast).toContainText("Changes saved.", { timeout: 15_000 });
    await expect(toast).toBeInViewport();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("1b · al actualizar una ficha desde el Panel, el aviso de respuesta queda a la vista", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 380, height: 380 });
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E135 Panel ${Date.now()}`);
    await seedOpenRecordWithLines(request, token, {
      clientId: client.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 50000,
      lineCount: 4,
    });

    await loginAsDemo(page);
    await page.goto("/app");
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
    await dialog.getByTestId("service-record-tips-toggle").click();
    const tipInput = dialog.locator(`#service-record-tip-${seed.professionalId}`);
    await setControlledInputValue(tipInput, "1000");
    await dialog.getByTestId("service-record-submit").click();

    // The dialog closes on save; the confirmation is a toast inside the viewport.
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("dashboard-record-toast")).toContainText("Changes saved.");
    await expect(page.getByTestId("dashboard-record-toast")).toBeInViewport();
  });

  test("2 · los movimientos muestran el retiro de cada profesional como una fila con signo menos", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const profB = await seedProfessional(request, token, `E2E135 Prof B ${Date.now()}`);

    const clientA = await seedClient(request, token, `E2E135 ClientA ${Date.now()}`);
    await seedClosedTip(request, token, {
      clientId: clientA.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 50000,
      tipAmount: 10000,
    });
    const clientB = await seedClient(request, token, `E2E135 ClientB ${Date.now()}`);
    await seedClosedTip(request, token, {
      clientId: clientB.id,
      serviceId: seed.serviceId,
      professionalId: profB.id,
      unitPrice: 50000,
      tipAmount: 8000,
    });

    await loginAsDemo(page);
    await page.goto("/app/propinas");

    // Withdraw part of each professional's balance from the balances card.
    await openWithdrawDialog(page, seed.professionalId);
    await expect(page.getByTestId("propinas-dialog-balance")).toHaveText("Gs. 10.000", { timeout: 15_000 });
    await setControlledInputValue(page.locator("#propinas-withdrawal-amount"), "4000");
    await page.getByTestId("propinas-withdraw-confirm").click();
    await expect(page.getByTestId("propinas-toast")).toContainText(
      "Withdrawal completed successfully.",
      { timeout: 15_000 },
    );

    await openWithdrawDialog(page, profB.id);
    await expect(page.getByTestId("propinas-dialog-balance")).toHaveText("Gs. 8.000", { timeout: 15_000 });
    await setControlledInputValue(page.locator("#propinas-withdrawal-amount"), "2000");
    await page.getByTestId("propinas-withdraw-confirm").click();
    await expect(page.getByTestId("propinas-toast")).toContainText(
      "Withdrawal completed successfully.",
      { timeout: 15_000 },
    );

    // Each withdrawal is a movement row of its own professional, with a minus sign.
    await filterPropinasByProfessional(page, seed.professionalFullName);
    const rowA = propinasMovements(page).filter({ hasText: "Withdrawal" });
    await expect(rowA).toHaveCount(1, { timeout: 15_000 });
    await expect(rowA).toContainText("Gs. 4.000");
    await expect(rowA).toContainText("−");
    await expect(rowA).toContainText(seed.professionalFullName);

    await filterPropinasByProfessional(page, profB.fullName);
    const rowB = propinasMovements(page).filter({ hasText: "Withdrawal" });
    await expect(rowB).toHaveCount(1, { timeout: 15_000 });
    await expect(rowB).toContainText("Gs. 2.000");
    await expect(rowB).toContainText(profB.fullName);
  });
});
