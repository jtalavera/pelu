import { expect, test } from "@playwright/test";

import { loginAs } from "../../fixtures/auth";
import { pelu, peluLogin } from "../../fixtures/stock/api";
import { STOCK_SPA_BASE } from "../../fixtures/stock/env";
import { getStockWorld } from "../../fixtures/stock/world";

// HU-65 · Entrar a Stock desde Femme (Cambio 8).

test.describe("HU-65 · Entrar a Stock desde Femme", () => {
  test("el admin abre Stock en una pestaña nueva, logueado, con el mismo tema e idioma; Femme sigue abierto", async ({
    page,
    context,
  }) => {
    const world = getStockWorld();
    await loginAs(page, world.s1.adminEmail, world.s1.adminPassword);
    // Dark theme + Spanish in Femme.
    await page.getByRole("button", { name: "ES", exact: true }).click();
    await page.locator('[data-tour="topbar-theme"]').click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    const [stockTab] = await Promise.all([context.waitForEvent("page"), page.getByTestId("nav-stock").click()]);
    await stockTab.waitForURL((u) => u.toString().startsWith(STOCK_SPA_BASE) && !u.pathname.startsWith("/sso"), {
      timeout: 30_000,
    });
    // Signed in (no login screen), same theme, same language, back-to-Femme link.
    await expect(stockTab.getByTestId("back-to-host")).toBeVisible();
    await expect(stockTab.getByTestId("back-to-host")).toContainText("Femme");
    await expect(stockTab.locator("html")).toHaveClass(/dark/);
    expect(await stockTab.evaluate(() => document.documentElement.lang)).toMatch(/^es/);
    // The token never stays in the URL.
    expect(stockTab.url()).not.toContain("token=");
    // Femme is still there, still signed in.
    await expect(page).toHaveURL(/\/app/);
    // The admin enters as Stock administrator.
    await stockTab.getByRole("button", { name: /menú de usuario|User menu/i }).click();
    await expect(stockTab.getByRole("menu")).toContainText(/Administrador|Administrator/);
  });

  test("el profesional ve Stock y entra como operador", async ({ page, context }) => {
    const world = getStockWorld();
    await loginAs(page, world.s1.professionalEmail, world.s1.professionalPassword);
    await expect(page.getByTestId("nav-stock")).toBeVisible();
    const sso = await pelu<{ token: string }>("/api/sso/stock", {
      method: "POST",
      token: await peluLogin(world.s1.professionalEmail, world.s1.professionalPassword),
    });
    expect(sso.status).toBe(200);
    const payload = JSON.parse(Buffer.from(sso.body.token.split(".")[1], "base64url").toString());
    expect([payload.aud].flat()).toContain("control-stock");
    expect(payload).toMatchObject({ role: "PROFESSIONAL", tid: String(world.s1.id) });

    const [stockTab] = await Promise.all([context.waitForEvent("page"), page.getByTestId("nav-stock").click()]);
    await expect(stockTab.getByTestId("back-to-host")).toBeVisible({ timeout: 30_000 });
    // Operator: the user menu says so, and there is no configuration entry.
    await stockTab.getByRole("button", { name: "User menu" }).click();
    await expect(stockTab.getByRole("menu")).toContainText("Operator");
    await expect(stockTab.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });

  test("cerrar sesión en Stock también la cierra en Femme", async ({ page, context }) => {
    const world = getStockWorld();
    await loginAs(page, world.s1.adminEmail, world.s1.adminPassword);
    const [stockTab] = await Promise.all([context.waitForEvent("page"), page.getByTestId("nav-stock").click()]);
    await expect(stockTab.getByTestId("back-to-host")).toBeVisible({ timeout: 30_000 });
    await stockTab.getByRole("button", { name: "User menu" }).click();
    await stockTab.getByRole("menuitem", { name: "Log out" }).click();
    await stockTab.waitForURL(/\/login\?reason=stock_logout/, { timeout: 30_000 });
    await expect(stockTab.getByTestId("login-stock-logout")).toBeVisible();
    // The original Femme tab is signed out too.
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("sin STOCK_MODULE no hay botón y el SSO responde STOCK_MODULE_DISABLED", async ({ page }) => {
    const world = getStockWorld();
    await loginAs(page, world.s3.adminEmail, world.s3.adminPassword);
    await expect(page.getByRole("link", { name: /Calendar/ }).first()).toBeVisible();
    await expect(page.getByTestId("nav-stock")).toHaveCount(0);
    const r = await pelu("/api/sso/stock", {
      method: "POST",
      token: await peluLogin(world.s3.adminEmail, world.s3.adminPassword),
    });
    expect(r.status).toBe(403);
    expect(r.text).toContain("STOCK_MODULE_DISABLED");
  });
});
