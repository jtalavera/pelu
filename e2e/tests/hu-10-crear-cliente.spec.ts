import { expect, test } from "@playwright/test";
import { loginAsDemoApi, seedClient } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-10 · Crear cliente", () => {
  test("HU-10 · 1 guardar cliente con nombre obligatorio", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    const name = `E2E Client ${Date.now()}`;
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    await dlg.getByRole("button", { name: "Save" }).click();
    // Search by name so the new client is on page 1 regardless of total count (server-side pagination).
    await page.getByPlaceholder(/Search by name, phone, or RUC/i).fill(name);
    // Names are stored in UPPERCASE (issue #155 AC3), regardless of the case typed here.
    await expect(page.getByText(name.toUpperCase(), { exact: true }).first()).toBeVisible();
  });

  test("HU-10 · 2 RUC inválido muestra mensaje de validación", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill("E2E RUC bad");
    await dlg.getByTestId("client-more-toggle").click();
    await dlg.getByLabel("Document number").fill("123");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("Invalid RUC. Use digits, one hyphen, and digits (e.g. 80000005-6).", {
        exact: true,
      }),
    ).toBeVisible();
  });

  test("HU-10 · 3 el teléfono no es único: un segundo cliente puede usar el mismo número", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const phone = `0981${String(Date.now()).slice(-6)}`;
    const firstName = `E2E Dup ${Date.now()}`;
    await seedClient(request, token, firstName, phone);

    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");
    const secondName = `E2E Other ${Date.now()}`;
    await dlg.getByLabel("Full name").fill(secondName);
    await dlg.getByLabel("Phone").fill(phone);
    await dlg.getByRole("button", { name: "Save" }).click();

    // It saves (no «already exists» error) and both clients are listed. The form may store the phone
    // formatted («0981 123 456») while the seeded one is raw digits, so each is looked up by name.
    await expect(dlg).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/already exists/i)).toHaveCount(0);
    const search = page.getByPlaceholder(/Search by name, phone, or RUC/i);
    await search.fill(secondName);
    await expect(page.getByText(secondName.toUpperCase(), { exact: true }).first()).toBeVisible();
    await search.fill(firstName);
    await expect(page.getByText(firstName.toUpperCase(), { exact: true }).first()).toBeVisible();
  });

  test("HU-10 · 4 nueva cliente aparece al buscarla en el directorio", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const name = `E2E Find ${Date.now()}`;
    await seedClient(request, token, name);

    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByPlaceholder(/Search by name, phone, or RUC/i).fill(name.slice(0, 6));
    // Names are stored in UPPERCASE (issue #155 AC3), regardless of the case typed here.
    await expect(page.getByText(name.toUpperCase(), { exact: true }).first()).toBeVisible();
  });
});
