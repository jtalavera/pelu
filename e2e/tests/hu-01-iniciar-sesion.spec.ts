import { expect, test } from "@playwright/test";
import { DEMO_EMAIL, DEMO_PASSWORD, loginAsDemo } from "../fixtures/auth";

test.describe("HU-01 · Iniciar sesión", () => {
  test("muestra el formulario de login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("credenciales incorrectas muestran mensaje genérico", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(DEMO_EMAIL);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
  });

  test("login exitoso redirige al panel", async ({ page }) => {
    await loginAsDemo(page);
    await expect(page.getByText("Appointments today", { exact: true }).first()).toBeVisible();
  });

  test("enlace a recuperación de contraseña", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
  });

  test("HU-01 · 5 envío de solicitud de recuperación muestra mensaje de confirmación", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("admin@demo.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(
      page.getByText(
        "If an account exists, check the server logs for the reset link (development).",
        { exact: true },
      ),
    ).toBeVisible();
  });
});
