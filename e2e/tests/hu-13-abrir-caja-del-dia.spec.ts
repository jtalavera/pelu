import { expect, test } from "@playwright/test";
import { API_BASE, apiPostJsonStatus, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { goToBillingHome } from "../fixtures/billing";

test.describe("HU-13 · Abrir caja del día", () => {
  test("HU-13 · 1 abrir caja con monto inicial y ver confirmación", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    // Redesign: the screen opens on the billing home — title plus the cash register status chip.
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await goToBillingHome(page);
    const openBtn = page.getByRole("button", { name: "Open cash register" });
    if (await openBtn.isVisible()) {
      await page.getByLabel("Initial cash amount").fill("50000");
      await expect(page.getByLabel("Initial cash amount")).toHaveValue("50.000");
      await openBtn.click();
      await expect(page.getByText(/^Cash register is open$/)).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByText(/^Cash register is open$/)).toBeVisible();
    }
  });

  test("HU-13 · 2 no abrir segunda caja si ya hay una abierta", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const current = await request.get(`${API_BASE}/api/cash-sessions/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (current.status() !== 200) {
      const first = await apiPostJsonStatus(request, token, "/api/cash-sessions/open", {
        openingCashAmount: 1000,
      });
      expect(first.status).toBeLessThan(400);
    }
    const second = await apiPostJsonStatus(request, token, "/api/cash-sessions/open", {
      openingCashAmount: 2000,
    });
    expect(second.status).toBeGreaterThanOrEqual(400);
  });
});
