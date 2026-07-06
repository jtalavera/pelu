import { expect, test } from "@playwright/test";
import { loginAsDemoApi, seedClient } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";

test.describe("Issue #93 · Orden en lista de clientes del formulario de comprobantes", () => {
  test("'Crear nuevo cliente' y 'Cliente ocasional' aparecen antes que los clientes reales", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E Orden ${Date.now()}`);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();

    const listbox = page.getByRole("listbox", { name: "Search or select client" });
    await expect(listbox.getByText(client.fullName, { exact: true })).toBeVisible();

    const labels = await listbox.getByRole("button").allTextContents();
    const createNewIdx = labels.findIndex((t) => /create new client/i.test(t));
    const occasionalIdx = labels.findIndex((t) => /occasional client/i.test(t));
    const clientIdx = labels.findIndex((t) => t.includes(client.fullName));

    expect(createNewIdx).toBeGreaterThanOrEqual(0);
    expect(occasionalIdx).toBeGreaterThanOrEqual(0);
    expect(clientIdx).toBeGreaterThan(createNewIdx);
    expect(clientIdx).toBeGreaterThan(occasionalIdx);
  });
});
