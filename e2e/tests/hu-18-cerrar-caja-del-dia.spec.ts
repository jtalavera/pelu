import { expect, test } from "@playwright/test";
import { API_BASE, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen, openCashPanel } from "../fixtures/billing";
import { setControlledInputValue } from "../fixtures/ui";

test.describe("HU-18 · Cerrar caja del día", () => {
  test("botón para iniciar cierre de caja", async ({ page }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await openCashPanel(page);
    await expect(page.getByRole("button", { name: "Close cash register" })).toBeVisible();
  });

  test("HU-18 · 1 y 2 cierre con arqueo y resumen", async ({ page }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await openCashPanel(page);
    await page.getByRole("button", { name: "Close cash register" }).click();
    await page.getByLabel("How much cash is in the register?").fill("49900");
    await expect(page.getByLabel("How much cash is in the register?")).toHaveValue("49.900");
    const [closeRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/cash-sessions/close") && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByRole("button", { name: "Confirm close" }).click(),
    ]);
    expect(closeRes.ok(), await closeRes.text()).toBeTruthy();
    await expect(page.getByText("Cash register is closed", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Open cash register" })).toBeVisible();
    // Minimalist summary: the verdict first, the numbers one tap away.
    const summary = page.getByTestId("billing-close-result");
    await expect(summary).toContainText("Closed");
    await expect(page.getByTestId("billing-close-verdict")).toHaveText(
      /^(The register balanced|Surplus Gs\. [\d.]+|Short Gs\. [\d.]+)$/,
    );
    await expect(page.getByTestId("billing-close-result-detail")).toHaveCount(0);
    await page.getByTestId("billing-close-result-toggle").click();
    await expect(page.getByTestId("billing-close-result-detail")).toContainText("Counted cash");
    // The summary can be hidden.
    await page.getByTestId("billing-close-result-dismiss").click();
    await expect(summary).toHaveCount(0);
  });

  test("HU-18 · 3 diferencia sobregiro o faltante", async ({ page }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await openCashPanel(page);
    await page.getByRole("button", { name: "Close cash register" }).click();
    await setControlledInputValue(page.getByLabel("How much cash is in the register?"), "999999");
    await expect(page.getByLabel("How much cash is in the register?")).toHaveValue("999.999");
    // While typing, the expected cash and the difference are shown live.
    await expect(page.getByTestId("billing-close-live-diff")).toContainText("Expected");
    await expect(page.getByTestId("billing-close-live-verdict")).toContainText(/Surplus Gs\./);
    const [closeRes2] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/cash-sessions/close") && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByRole("button", { name: "Confirm close" }).click(),
    ]);
    expect(closeRes2.ok(), await closeRes2.text()).toBeTruthy();
    await expect(page.getByText("Cash register is closed", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("billing-close-verdict")).toContainText(/^Surplus Gs\./);
    await expect(page.getByRole("button", { name: "Open cash register" })).toBeVisible();
  });

  test("HU-18 · 5 tras cierre no emitir hasta nueva apertura", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await request.post(`${API_BASE}/api/cash-sessions/open`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { openingCashAmount: 50_000 },
    });
    await request.post(`${API_BASE}/api/cash-sessions/close`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { countedCashAmount: 50_000 },
    });
    const res = await request.post(`${API_BASE}/api/invoices`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: {
        clientId: null,
        clientDisplayName: "Closed",
        clientRucOverride: null,
        discountType: null,
        discountValue: null,
        lines: [{ serviceId: null, description: "X", quantity: 1, unitPrice: 1000 }],
        payments: [{ method: "CASH", amount: 1000 }],
      },
    });
    expect([400, 409]).toContain(res.status());
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("CASH_SESSION_NOT_OPEN");
  });
});
