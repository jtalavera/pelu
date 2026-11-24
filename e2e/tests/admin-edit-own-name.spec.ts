import { expect, test } from "@playwright/test";
import { API_BASE, loginAsDemoApi } from "../fixtures/api";
import { DEMO_FULL_NAME, loginAsDemo } from "../fixtures/auth";

test.describe.configure({ mode: "serial" });

async function openProfileTab(page: import("@playwright/test").Page) {
  await page.goto("/app");
  await page.getByRole("button", { name: "Open user menu" }).click();
  await page.getByRole("menuitem", { name: "User settings" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await modal.getByRole("tab", { name: "Personal details" }).click();
  return modal;
}

test.describe("Admin sin profesional · editar nombre propio", () => {
  // AC-1 — the admin sees a full-name field prefilled with the current name (no more read-only notice).
  test("1 el modal muestra el nombre completo actual editable", async ({ page }) => {
    await loginAsDemo(page);
    const modal = await openProfileTab(page);
    await expect(modal.getByLabel("Full name")).toHaveValue(DEMO_FULL_NAME);
    await expect(modal.getByRole("button", { name: "Save changes" })).toBeVisible();
  });

  // AC-2 — blank name is rejected with an inline error that includes a format example.
  test("2 nombre vacío muestra error de validación", async ({ page }) => {
    await loginAsDemo(page);
    const modal = await openProfileTab(page);
    await modal.getByLabel("Full name").fill("   ");
    await modal.getByRole("button", { name: "Save changes" }).click();
    await expect(modal.getByRole("alert")).toContainText("for example: Tania Nunez");
  });

  // AC-3 — saving persists the new name (visible after reload) and AC-4 restores it.
  test("3 guardar persiste el nombre y se refleja en la sesión", async ({ page }) => {
    await loginAsDemo(page);
    let modal = await openProfileTab(page);
    await modal.getByLabel("Full name").fill("Tania Nunez E2E");
    await modal.getByRole("button", { name: "Save changes" }).click();
    await expect(modal.getByText("Profile saved successfully").first()).toBeVisible();

    await page.reload();
    modal = await openProfileTab(page);
    await expect(modal.getByLabel("Full name")).toHaveValue("Tania Nunez E2E");

    // restore the demo admin's name for the rest of the suite
    await modal.getByLabel("Full name").fill(DEMO_FULL_NAME);
    await modal.getByRole("button", { name: "Save changes" }).click();
    await expect(modal.getByText("Profile saved successfully").first()).toBeVisible();
  });

  // AC-4 — the API rejects a blank name with a code, never prose.
  test("4 la API responde FULL_NAME_REQUIRED para nombre vacío", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const res = await request.put(`${API_BASE}/api/me/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { fullName: "  " },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain("FULL_NAME_REQUIRED");
  });
});
