import { expect, test } from "@playwright/test";
import { loginAsDemoApi, seedCategoryServiceProfessional, seedClient } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";

test.describe("Issue #157 · Ajustes varios", () => {
  test("AC1 · el mensaje de éxito de edición se muestra dentro del formulario, sin cerrar el modal", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.locator("#services-list-filter").fill(seed.serviceFullName);
    const card = page.getByTestId(`svc-row-${seed.serviceId}`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.click();
    const dlg = page.getByRole("dialog", { name: "Edit service" });
    await dlg.getByRole("button", { name: "Save" }).click();

    // The success message renders inside the edit form itself — the modal must stay open
    // and interactive (not close back to the table with the message shown there instead).
    await expect(dlg.getByRole("alert").filter({ hasText: "Changes saved successfully." })).toBeVisible({
      timeout: 10_000,
    });
    await expect(dlg.getByLabel("Name")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Changes saved successfully." })).toHaveCount(1);
  });

  test("AC2 · el formulario de edición de cliente ya no tiene botón de cerrar (x)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E157 Client ${Date.now()}`);

    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    await expect(page.getByTestId("client-detail-close")).toHaveCount(0);
    // "Back to clients" remains the only way back, and still works.
    await page.getByRole("button", { name: "Back to clients" }).click();
    await expect(page).toHaveURL(/\/app\/clients$/);
  });

  test("AC3 · tildar 'Comprobante sin nominar' vacía Nombre/Número; destildar los restaura", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const ruc = `800${Date.now()}-6`;
    const client = await seedClient(request, token, `E2E157 Billing ${Date.now()}`, undefined, ruc);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 12));
    await page.getByRole("button", { name: client.fullName }).click();

    const nameInput = page.locator("#client-display-name");
    const numberInput = page.locator("#client-identity-document-number");
    const typeSelect = page.locator("#client-identity-document-type");
    const checkbox = page.getByLabel("Unnamed invoice (no client identified)");

    await expect(nameInput).toHaveValue(client.fullName);
    await expect(numberInput).toHaveValue(ruc);
    await expect(typeSelect).toHaveValue("RUC");

    await checkbox.check();
    await expect(nameInput).toHaveValue("");
    await expect(numberInput).toHaveValue("");
    await expect(typeSelect).toHaveValue("INNOMINADO");

    await checkbox.uncheck();
    await expect(nameInput).toHaveValue(client.fullName);
    await expect(numberInput).toHaveValue(ruc);
    await expect(typeSelect).toHaveValue("RUC");
  });
});
