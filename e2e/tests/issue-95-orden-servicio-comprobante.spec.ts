import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";

test.describe("Issue #95 · Orden de servicio en formulario de comprobantes", () => {
  test("los ítems de 'Servicios profesionales' aparecen primero, en carga inicial y en búsqueda", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const suffix = Date.now();

    // Alphabetically-earlier category ("A...") so a naive alpha sort would list it first.
    const catEarly = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
      name: `A2E Cat ${suffix}`,
      accentKey: "stone",
    });
    const earlyServiceName = `A2E Corte ${suffix}`;
    await apiPostJson(request, token, "/api/services", {
      name: earlyServiceName,
      categoryId: catEarly.id,
      priceMinor: 10000,
      durationMinutes: 30,
    });

    // The priority category — must always sort first regardless of alphabetical order.
    const catPriority = await apiPostJson<{ id: number }>(
      request,
      token,
      "/api/service-categories",
      { name: "Servicios profesionales", accentKey: "rose" },
    );
    const priorityServiceName = `Z2E Corte ${suffix}`;
    await apiPostJson(request, token, "/api/services", {
      name: priorityServiceName,
      categoryId: catPriority.id,
      priceMinor: 20000,
      durationMinutes: 45,
    });

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();

    const input = page.locator("#billing-line-svc-0");
    const listbox = page.locator("#billing-line-svc-0-listbox");

    // Initial load (empty query, focus only).
    await input.click();
    await expect(listbox.getByText(priorityServiceName, { exact: true })).toBeVisible();
    await expect(listbox.getByText(earlyServiceName, { exact: true })).toBeVisible();
    let labels = await listbox.getByRole("button").allTextContents();
    let priorityIdx = labels.findIndex((t) => t.includes(priorityServiceName));
    let earlyIdx = labels.findIndex((t) => t.includes(earlyServiceName));
    expect(priorityIdx).toBeGreaterThanOrEqual(0);
    expect(earlyIdx).toBeGreaterThan(priorityIdx);

    // Search matching both ("Corte" is common to both service names).
    await input.fill("Corte");
    await expect(listbox.getByText(priorityServiceName, { exact: true })).toBeVisible();
    await expect(listbox.getByText(earlyServiceName, { exact: true })).toBeVisible();
    labels = await listbox.getByRole("button").allTextContents();
    priorityIdx = labels.findIndex((t) => t.includes(priorityServiceName));
    earlyIdx = labels.findIndex((t) => t.includes(earlyServiceName));
    expect(priorityIdx).toBeGreaterThanOrEqual(0);
    expect(earlyIdx).toBeGreaterThan(priorityIdx);
  });
});
