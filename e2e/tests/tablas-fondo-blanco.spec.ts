import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import {
  enableCommissionsGlobally,
  generateSettlements,
  entriesOfInvoice,
  issueInvoice,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
} from "../fixtures/commissions";

/**
 * Todas las tablas tienen fondo blanco (la superficie de las tarjetas, como la tabla de
 * Comisiones → Configuración → Historial de cambios), nunca el crema del fondo de la página.
 */

async function colors(page: Page): Promise<{ surface: string; page: string }> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "bg-surface";
    document.body.appendChild(probe);
    const surface = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { surface, page: getComputedStyle(document.body).backgroundColor };
  });
}

/** The color actually painted behind the table: its own background or the nearest ancestor's. */
async function paintedBackground(table: Locator): Promise<string> {
  return table.evaluate((el) => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
    }
    return "";
  });
}

async function expectWhiteTable(page: Page, table: Locator) {
  await expect(table).toBeVisible({ timeout: 20_000 });
  const c = await colors(page);
  expect(c.surface).not.toBe(c.page); // the test only makes sense if the page is cream
  expect(await table.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(c.surface);
  expect(await paintedBackground(table)).toBe(c.surface);
}

test.describe("Tablas con fondo blanco", () => {
  test("Comisiones → Liquidaciones (la tabla de la captura) y Movimientos", async ({ page, request }) => {
    await enableCommissionsGlobally(request);
    try {
      const w = await provisionCommissionWorld(request, "TABLAS-BLANCAS");
      const inv = await issueInvoice(request, w.adminToken, [
        { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
      ]);
      await entriesOfInvoice(request, w.adminToken, inv.id, 1);
      await generateSettlements(request, w.adminToken, [w.ana.id]);

      await loginAdminUi(page, w);
      await page.getByRole("link", { name: "Commissions" }).click();
      await expectWhiteTable(page, page.getByTestId("commission-settlements-table").locator("table"));
      await page.getByRole("tab", { name: "Movements", exact: true }).click();
      await expectWhiteTable(page, page.getByTestId("movements-table").locator("table"));
      await page.getByRole("tab", { name: "Rules", exact: true }).click();
      await expectWhiteTable(page, page.getByTestId("rules-table").locator("table"));
      // The reference table (inside a card) keeps its white background.
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      await expectWhiteTable(page, page.getByTestId("commission-settings-history").locator("table"));
    } finally {
      await restoreCommissionsGlobal(request);
    }
  });

  test("listados principales: clientes, profesionales, servicios, fichas y facturación", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E Tabla ${Date.now()}`);
    const seed = await seedCategoryServiceProfessional(request, token);
    // One service record and one invoice, so their history tables have rows to render.
    await apiPostJson(request, token, "/api/service-records", {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 1, unitPrice: 50_000 }],
      tips: [{ professionalId: seed.professionalId, amount: 0 }],
    });
    await ensureCashSessionOpenApi(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    await apiPostJson(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 50_000 }],
      payments: [{ method: "CASH", amount: 50_000 }],
    });
    await loginAsDemo(page);

    for (const path of ["/app/clients", "/app/professionals", "/app/services"]) {
      await page.goto(path);
      await expectWhiteTable(page, page.locator("table").filter({ visible: true }).first());
    }

    await page.goto("/app/service-records");
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await expectWhiteTable(page, page.locator("table").filter({ visible: true }).first());

    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await expectWhiteTable(page, page.locator("table").filter({ visible: true }).first());
  });
});
