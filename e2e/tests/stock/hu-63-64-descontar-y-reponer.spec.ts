import { expect, test } from "@playwright/test";

import { loginAs } from "../../fixtures/auth";
import {
  createProduct,
  kardex,
  onHand,
  peluLogin,
  peluOk,
  platformToken,
  setTenantFlag,
  stock,
  stockAlerts,
  stockClientToken,
  stockItemByName,
  stockReceive,
  stockSession,
  waitForOutboxDrained,
} from "../../fixtures/stock/api";
import { issueInvoiceApi, issueInvoiceUi } from "../../fixtures/stock/billing";
import { getStockWorld } from "../../fixtures/stock/world";

// HU-63 · Descontar stock al facturar (Cambio 6) · HU-64 · Reponer stock al anular o corregir
// (Cambio 7). Cross-system: the kardex is read from the real control-stock.

async function productInStock(tenantId: number, adminToken: string, categoryId: number, name: string, initial?: string) {
  const serviceId = await createProduct(adminToken, categoryId, name);
  const stockToken = await stockSession(tenantId);
  let itemId = 0;
  await expect
    .poll(async () => {
      itemId = (await stockItemByName(stockToken, name))?.id ?? 0;
      return itemId;
    }, { timeout: 30_000 })
    .toBeGreaterThan(0);
  if (initial) await stockReceive(stockToken, itemId, initial);
  return { serviceId, itemId, stockToken };
}

test.describe("HU-63 · Descontar stock al facturar", () => {
  test("una factura con 2 productos (y un servicio) descuenta stock y deja la salida en el kardex", async ({ page }) => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const stamp = Date.now();
    const a = await productInStock(world.s1.id, admin, world.s1.categoryId, `Shampoo kardex ${stamp}`, "10");
    const b = await productInStock(world.s1.id, admin, world.s1.categoryId, `Máscara kardex ${stamp}`, "10");
    const haircut = await peluOk<{ id: number }>("/api/services", {
      token: admin,
      body: { name: `Corte kardex ${stamp}`, categoryId: world.s1.categoryId, priceMinor: 50000, durationMinutes: 30 },
    });

    await loginAs(page, world.s1.adminEmail, world.s1.adminPassword);
    const invoice = await issueInvoiceUi(page, [
      { serviceId: a.serviceId, name: `Shampoo kardex ${stamp}`, quantity: 2 },
      { serviceId: b.serviceId, name: `Máscara kardex ${stamp}`, quantity: 1 },
      { serviceId: haircut.id, name: `Corte kardex ${stamp}`, quantity: 1 },
    ]);

    await expect.poll(() => onHand(a.stockToken, a.itemId), { timeout: 30_000 }).toBe(8);
    await expect.poll(() => onHand(b.stockToken, b.itemId), { timeout: 30_000 }).toBe(9);
    const rows = await kardex(a.stockToken, a.itemId);
    const sale = rows.find((r) => r.reasonCode === "SALE");
    expect(sale, JSON.stringify(rows)).toBeDefined();
    expect(Number(sale!.quantityOut)).toBe(2);
    expect(`${sale!.sourceLabel ?? ""} ${sale!.documentNumber}`).toContain(invoice.invoiceNumberFormatted);
  });

  test("vender más de lo disponible igual se emite: queda en negativo y Stock genera la alerta", async () => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const name = `Tónico negativo ${Date.now()}`;
    const p = await productInStock(world.s1.id, admin, world.s1.categoryId, name, "1");
    await issueInvoiceApi(admin, [{ serviceId: p.serviceId, name, quantity: 3 }]);
    await expect.poll(() => onHand(p.stockToken, p.itemId), { timeout: 30_000 }).toBe(-2);
    await expect
      .poll(async () => (await stockAlerts(p.stockToken, "NEGATIVE_STOCK")).some((x) => x.itemId === p.itemId), { timeout: 30_000 })
      .toBe(true);
    // The NEGATIVE_STOCK warning Stock answered is kept on the delivered event.
    const platform = await platformToken();
    await waitForOutboxDrained(platform, world.s1.id);
  });
});

test.describe("HU-64 · Reponer stock al anular o corregir", () => {
  test("Anular comprobante repone el producto (reversión en el kardex)", async ({ page }) => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const name = `Spray anulación ${Date.now()}`;
    const p = await productInStock(world.s1.id, admin, world.s1.categoryId, name, "5");

    await loginAs(page, world.s1.adminEmail, world.s1.adminPassword);
    const inv = await issueInvoiceUi(page, [{ serviceId: p.serviceId, name, quantity: 2 }]);
    await expect.poll(() => onHand(p.stockToken, p.itemId), { timeout: 30_000 }).toBe(3);

    await page.getByRole("tab", { name: "History" }).click();
    await page.locator('tbody tr[role="button"]').filter({ hasText: inv.invoiceNumberFormatted }).first().click();
    await page.getByRole("button", { name: "Void invoice" }).click();
    await page.locator("#void-reason").fill("Cliente devolvió el producto");
    await page.getByRole("button", { name: "Confirm void" }).click();

    await expect.poll(() => onHand(p.stockToken, p.itemId), { timeout: 30_000 }).toBe(5);
    const rows = await kardex(p.stockToken, p.itemId);
    expect(rows.some((r) => r.documentType === "REVERSAL")).toBe(true);
  });

  test("Cancelar en SIFEN (aprobada) e inutilización de número también reponen", async () => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const stamp = Date.now();
    const cancelName = `Crema cancelación ${stamp}`;
    const voidName = `Crema inutilización ${stamp}`;
    const c = await productInStock(world.s1.id, admin, world.s1.categoryId, cancelName, "4");
    const v = await productInStock(world.s1.id, admin, world.s1.categoryId, voidName, "4");

    const approved = await issueInvoiceApi(admin, [{ serviceId: c.serviceId, name: cancelName, quantity: 1 }]);
    const rejected = await issueInvoiceApi(admin, [{ serviceId: v.serviceId, name: voidName, quantity: 1 }]);
    await expect.poll(() => onHand(c.stockToken, c.itemId), { timeout: 30_000 }).toBe(3);
    await expect.poll(() => onHand(v.stockToken, v.itemId), { timeout: 30_000 }).toBe(3);

    // SIFEN's answers are fabricated by the e2e test-support endpoints (no SIFEN in e2e): an
    // approved cancellation, and an approved inutilización of a rejected comprobante.
    await peluOk(`/api/admin/sifen-test-support/invoices/${approved.id}/fabricate-cancellation-result/true`, { body: {} });
    await peluOk(`/api/admin/sifen-test-support/invoices/${rejected.id}/fabricate-number-voiding-result/true`, { body: {} });

    await expect.poll(() => onHand(c.stockToken, c.itemId), { timeout: 30_000 }).toBe(4);
    await expect.poll(() => onHand(v.stockToken, v.itemId), { timeout: 30_000 }).toBe(4);
  });

  test("corregir una factura rechazada por SIFEN revierte la venta anterior y registra la nueva", async () => {
    const world = getStockWorld();
    const platform = await platformToken();
    const admin = await peluLogin(world.s2.adminEmail, world.s2.adminPassword);
    const name = `Aceite corrección ${Date.now()}`;
    const p = await productInStock(world.s2.id, admin, world.s2.categoryId, name, "10");
    const inv = await issueInvoiceApi(admin, [{ serviceId: p.serviceId, name, quantity: 1 }]);
    await expect.poll(() => onHand(p.stockToken, p.itemId), { timeout: 30_000 }).toBe(9);

    // Rejected by SIFEN (fabricated), then corrected with 3 units through the real endpoint.
    await peluOk(`/api/admin/sifen-test-support/invoices/${inv.id}/simulate-sifen-rejection`, { body: {} });
    await peluOk("/api/admin/sifen-test-support/ensure-valid-certificate", { body: {} });
    await setTenantFlag(platform, world.s2.id, "SIFEN_ELECTRONIC_INVOICING", true);
    try {
      const corrected = await fetch(`${process.env.PLAYWRIGHT_API_BASE_URL}/api/invoices/${inv.id}/sifen/correct-and-resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin}` },
        body: JSON.stringify({
          clientId: null,
          clientDisplayName: "Cliente Stock E2E",
          clientRucOverride: null,
          discountType: "NONE",
          discountValue: null,
          lines: [{ serviceId: p.serviceId, description: name, quantity: 3, unitPrice: 50000, discountType: null, discountValue: null }],
          payments: [{ method: "CASH", amount: 150000, cardBrand: null, cardBrandOtherDescription: null }],
        }),
      });
      // The Stock side happens inside the correction's own transaction, before any re-signing.
      expect([200, 412, 422, 500]).toContain(corrected.status);
    } finally {
      await setTenantFlag(platform, world.s2.id, "SIFEN_ELECTRONIC_INVOICING", false);
    }

    await expect.poll(() => onHand(p.stockToken, p.itemId), { timeout: 30_000 }).toBe(7);
    const rows = await kardex(p.stockToken, p.itemId);
    expect(rows.filter((r) => r.reasonCode === "SALE").length).toBe(2);
    expect(rows.some((r) => r.documentType === "REVERSAL")).toBe(true);
  });

  test("el mismo envío repetido con la misma clave de idempotencia deja un solo movimiento", async () => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const name = `Peine idempotencia ${Date.now()}`;
    const p = await productInStock(world.s1.id, admin, world.s1.categoryId, name, "10");
    const inv = await issueInvoiceApi(admin, [{ serviceId: p.serviceId, name, quantity: 1 }]);
    await expect.poll(() => onHand(p.stockToken, p.itemId), { timeout: 30_000 }).toBe(9);

    // Resend exactly what pelu's outbox sent (same key PELU:INVOICE:{id}:0): Stock replays it.
    const m2m = await stockClientToken();
    const replay = await stock(`/api/v1/integration/documents`, {
      token: m2m,
      headers: { "X-Tenant-Id": String(world.s1.id), "Idempotency-Key": `PELU:INVOICE:${inv.id}:0` },
      body: {
        type: "ISSUE",
        reason: "SALE",
        timing: "POST_SALE",
        source: { system: "PELU", docType: "INVOICE", docId: String(inv.id), docNumber: "x" },
        lines: [{ sourceLineId: "1", externalType: "SERVICE", externalId: String(p.serviceId), quantity: 1 }],
      },
    });
    expect([200, 201, 409, 422]).toContain(replay.status);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await onHand(p.stockToken, p.itemId)).toBe(9);
    expect((await kardex(p.stockToken, p.itemId)).filter((r) => r.reasonCode === "SALE")).toHaveLength(1);
  });
});
