import { expect, test } from "@playwright/test";
import { API_BASE, apiPostJsonStatus, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";

test.describe("HU-13 · Abrir caja del día", () => {
  test("abrir caja con monto inicial y ver confirmación", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await expect(page.getByText("Manage the daily cash register and issue invoices.")).toBeVisible();
    await page.getByRole("tab", { name: "Cash Register" }).click();
    const openBtn = page.getByRole("button", { name: "Open cash register" });
    if (await openBtn.isVisible()) {
      await page.getByLabel("Initial cash amount").fill("50000");
      await openBtn.click();
      await expect(page.getByText(/^Cash register is open$/)).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByText(/^Cash register is open$/)).toBeVisible();
    }
  });

  test("fixture reutilizable deja sesión abierta para facturación", async ({ page }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await expect(page.getByText("Cash register is open")).toBeVisible();
  });

  test("HU-13 · 2 no emitir factura sin caja abierta", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const current = await request.get(`${API_BASE}/api/cash-sessions/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (current.status() === 200) {
      await request.post(`${API_BASE}/api/cash-sessions/close`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        data: { countedCashAmount: 50_000 },
      });
    }
    const res = await request.post(`${API_BASE}/api/invoices`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: {
        clientId: null,
        clientDisplayName: "E2E API",
        clientRucOverride: null,
        discountType: null,
        discountValue: null,
        lines: [{ serviceId: null, description: "Test", quantity: 1, unitPrice: 1000 }],
        payments: [{ method: "CASH", amount: 1000 }],
      },
    });
    expect([400, 409]).toContain(res.status());
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("CASH_SESSION_NOT_OPEN");
  });

  test("HU-13 · 3 no abrir segunda caja si ya hay una abierta", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const first = await apiPostJsonStatus(request, token, "/api/cash-sessions/open", {
      openingCashAmount: 1000,
    });
    expect(first.status).toBeLessThan(400);
    const second = await apiPostJsonStatus(request, token, "/api/cash-sessions/open", {
      openingCashAmount: 2000,
    });
    expect(second.status).toBeGreaterThanOrEqual(400);
  });
});
