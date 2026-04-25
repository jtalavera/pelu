import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

const PROFESSIONAL_PHOTO_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";

test.describe("HU-20 · Fixes varios profesionales", () => {
  test("listado con búsqueda inline de profesionales", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await expect(page.getByPlaceholder("Search by name or email…")).toBeVisible();
  });

  test("HU-25 / HU-20 acción al modal: botón More… (detalle profesional)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await apiPostJson(request, token, "/api/professionals", {
      fullName: `E2E MoreBtn ${Date.now()}`,
      phone: null,
      email: null,
      photoDataUrl: null,
    });
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await expect(
      page.getByRole("button", { name: "More…", exact: true }).first(),
    ).toBeVisible();
  });

  test("HU-20 · 1 input de foto usa accept de tipos de imagen", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveAttribute("accept", PROFESSIONAL_PHOTO_ACCEPT);
  });

  test("HU-20 · 2 validación de extensión de archivo rechaza .txt", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill("E2E Bad ext");
    await dlg.locator('input[type="file"]').setInputFiles({
      name: "bad.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(
      page.getByText("Invalid file type. Use .jpg, .jpeg, .png, .webp, or .gif (e.g. ana.png).", {
        exact: true,
      }),
    ).toBeVisible();
  });

  test("HU-20 · 5 time picker en horario usa input type time", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill("E2E Time");
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(dlg.locator("#prof-1-start")).toHaveAttribute("type", "time");
    await expect(dlg.locator("#prof-1-end")).toHaveAttribute("type", "time");
  });
});
