import { expect, test } from "@playwright/test";
import {
  applyChanges,
  enableCommissionsGlobally,
  entries,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  setTenantFlag,
  sum,
  voidInvoice,
  type CommissionWorld,
} from "../../fixtures/commissions";
import { apiPostJson } from "../../fixtures/api";

/**
 * HU-COM-04 · Generación automática de comisiones al emitir un comprobante.
 * HU-COM-05 · Reversión de comisiones por anulación de comprobante.
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
  w = await provisionCommissionWorld(request, "HU-COM-04");
  await applyChanges(request, w.adminToken, [
    { scope: "DEFAULT_PRODUCT", value: "10" },
    { scope: "RULE", serviceId: w.service.id, value: "40" },
  ]);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.describe("HU-COM-04 · Devengo al emitir", () => {
  test("una entrada por línea con beneficiario (servicio y producto) con snapshot; sin profesional no genera", async ({
    request,
  }) => {
    const inv = await issueInvoice(request, w.adminToken, [
      { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
      { serviceId: w.product.id, name: w.product.name, professionalId: w.bea.id },
      { serviceId: w.service.id, name: w.service.name, professionalId: null },
    ]);
    const es = await entriesOfInvoice(request, w.adminToken, inv.id, 2);
    const svc = es.find((e) => e.itemKind === "SERVICE")!;
    const prod = es.find((e) => e.itemKind === "PRODUCT")!;
    // Base sin IVA (default): 110.000 con IVA 10 % → 100.000; 40 % → 40.000; producto 10 % → 10.000.
    expect(svc.baseType).toBe("NET_OF_TAX");
    expect(Number(svc.baseAmount)).toBe(100000);
    expect(Number(svc.percentApplied)).toBe(40);
    expect(svc.ruleOrigin).toBe("ITEM");
    expect(Number(svc.commissionAmount)).toBe(40000);
    expect(prod.ruleOrigin).toBe("TENANT_DEFAULT_PRODUCT");
    expect(Number(prod.commissionAmount)).toBe(10000);
    expect(prod.professionalId).toBe(w.bea.id);
  });

  test("la base respeta descuentos de línea y redondea a guaraníes (36.364)", async ({ request }) => {
    const inv = await issueInvoice(request, w.adminToken, [
      { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id, price: 110000, discountPercent: 9.090909 },
    ]);
    const [e] = await entriesOfInvoice(request, w.adminToken, inv.id, 1);
    // Line net ≈ 100.000 → base sin IVA 90.909 → 40 % = 36.364
    expect(Number(e.commissionAmount)).toBeGreaterThanOrEqual(36363);
    expect(Number(e.commissionAmount)).toBeLessThanOrEqual(36364);
  });

  test("el descuento global del comprobante no se prorratea ni reduce la base", async ({ request }) => {
    const inv = await apiPostJson<{ id: number }>(request, w.adminToken, "/api/invoices", {
      clientId: null,
      clientDisplayName: "Descuento global",
      discountType: "FIXED",
      discountValue: 10000,
      lines: [{ serviceId: w.service.id, description: w.service.name, quantity: 1, unitPrice: 110000, professionalId: w.ana.id }],
      payments: [{ method: "CASH", amount: 100000 }],
    });
    const [e] = await entriesOfInvoice(request, w.adminToken, inv.id, 1);
    expect(Number(e.baseAmount)).toBe(100000);
    expect(Number(e.commissionAmount)).toBe(40000);
  });

  test("con la flag apagada para el tenant no se generan entradas (C20)", async ({ request }) => {
    await setTenantFlag(request, w.tenantId, "COMMISSIONS", false);
    try {
      const inv = await issueInvoice(request, w.adminToken, [
        { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
      ]);
      await setTenantFlag(request, w.tenantId, "COMMISSIONS", true);
      // Give the after-commit processing a moment, then confirm nothing was accrued.
      await new Promise((r) => setTimeout(r, 1500));
      expect((await entries(request, w.adminToken)).filter((e) => e.invoiceId === inv.id)).toHaveLength(0);
    } finally {
      await setTenantFlag(request, w.tenantId, "COMMISSIONS", true);
    }
  });
});

test.describe("HU-COM-05 · Reversión por anulación", () => {
  test("anular antes de liquidar revierte con contra-entrada (neto 0) y es idempotente", async ({ request }) => {
    const inv = await issueInvoice(request, w.adminToken, [
      { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
    ]);
    await entriesOfInvoice(request, w.adminToken, inv.id, 1);
    await voidInvoice(request, w.adminToken, inv.id);
    const es = await entriesOfInvoice(request, w.adminToken, inv.id, 2);
    expect(es.map((e) => e.sourceType).sort()).toEqual(["INVOICE_LINE", "REVERSAL"]);
    expect(es.find((e) => e.sourceType === "REVERSAL")!.reasonCode).toBe("VOID");
    expect(sum(es)).toBe(0);
    // Second void is rejected by the invoice module; no duplicate reversal either way.
    const again = await request.post(`${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/invoices/${inv.id}/void`, {
      headers: { Authorization: `Bearer ${w.adminToken}`, "Content-Type": "application/json" },
      data: { voidReason: "otra vez" },
    });
    expect(again.ok()).toBeFalsy();
    expect(await entriesOfInvoice(request, w.adminToken, inv.id, 2)).toHaveLength(2);
  });

  test("anular con la liquidación aprobada genera un ajuste negativo para la próxima", async ({ request }) => {
    const solo = await provisionCommissionWorld(request, "HU-COM-05");
    await applyChanges(request, solo.adminToken, [{ scope: "RULE", serviceId: solo.service.id, value: "40" }]);
    const inv = await issueInvoice(request, solo.adminToken, [
      { serviceId: solo.service.id, name: solo.service.name, professionalId: solo.ana.id },
    ]);
    await entriesOfInvoice(request, solo.adminToken, inv.id, 1);
    const [settlement] = await generateSettlements(request, solo.adminToken, [solo.ana.id]);
    await apiPostJson(request, solo.adminToken, `/api/commissions/settlements/${settlement.id}/approve`, {});

    await voidInvoice(request, solo.adminToken, inv.id);
    const es = await entriesOfInvoice(request, solo.adminToken, inv.id, 2);
    const reversal = es.find((e) => e.sourceType === "REVERSAL")!;
    expect(Number(reversal.commissionAmount)).toBe(-40000);
    expect(reversal.settlementId).toBeNull(); // goes to the next settlement
    const detail = await (
      await request.get(`${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/commissions/settlements/${settlement.id}`, {
        headers: { Authorization: `Bearer ${solo.adminToken}` },
      })
    ).json();
    expect(Number(detail.settlement.totalAmount)).toBe(40000); // approved settlement untouched
  });
});
