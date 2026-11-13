import { expect, test } from "@playwright/test";
import { API_BASE, authHeaders, loginAsDemoApi, seedCategoryServiceProfessional } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * La ficha de servicio abre rápido: los profesionales del selector vienen de una lista liviana
 * (`/api/professionals/options`: id y nombres, sin foto ni horarios) y se piden junto con la ficha
 * y los servicios frecuentes, no uno tras otro.
 */
test.describe("Ficha de servicio · carga rápida de profesionales", () => {
  test("API: /api/professionals/options trae solo lo que necesita un selector", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const res = await request.get(`${API_BASE}/api/professionals/options`, { headers: authHeaders(token) });
    expect(res.status()).toBe(200);
    const list = (await res.json()) as Array<Record<string, unknown>>;
    const mine = list.find((p) => p.id === seed.professionalId);
    expect(mine, "the seeded professional is in the list").toBeTruthy();
    expect(Object.keys(mine!).sort()).toEqual(["active", "displayName", "fullName", "id", "nickname"]);
    expect(mine).not.toHaveProperty("photoDataUrl");
    expect(mine).not.toHaveProperty("schedules");
  });

  test("al abrir una ficha, los profesionales se piden en paralelo con la ficha", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const created = await request.post(`${API_BASE}/api/service-records`, {
      headers: authHeaders(token),
      data: {
        clientId: null,
        lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 1, unitPrice: 20_000 }],
        tips: [],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    await expect(page.getByTestId("dashboard-service-record-card").first()).toBeVisible({ timeout: 20_000 });
    // Only what is requested from here on counts (Inicio's own load is already done).
    const starts: { record?: number; professionals?: number } = {};
    page.on("request", (r) => {
      const u = new URL(r.url()).pathname;
      if (/^\/api\/service-records\/\d+$/.test(u)) starts.record ??= Date.now();
      if (u === "/api/professionals/options") starts.professionals ??= Date.now();
    });
    await page.getByTestId("dashboard-service-record-card").first().click({ position: { x: 40, y: 20 } });
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect.poll(() => Object.keys(starts).length, { timeout: 15_000 }).toBe(2);
    // The other two requests start with the ficha's, not after it has been answered.
    expect(Math.abs(starts.professionals! - starts.record!)).toBeLessThan(150);
  });
});
