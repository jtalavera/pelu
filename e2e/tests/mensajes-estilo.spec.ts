import { expect, test } from "@playwright/test";

/**
 * Mensajes al usuario (Alert del sistema, estilo A): fondo tenue sin borde, ícono redondo de color y
 * texto en el color normal. El error de login es un aviso real y público que no necesita datos.
 */
test.describe("Mensajes al usuario · estilo del aviso", () => {
  test("un aviso informativo (login tras cerrar sesión desde Stock) se ve suave, con ícono y sin borde", async ({ page }) => {
    // Public page, no data needed: «Stock» sends the user here with ?reason=stock_logout.
    await page.goto("/login?reason=stock_logout");

    const alert = page.getByTestId("login-stock-logout");
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert.getByTestId("alert-icon")).toBeVisible();
    // No border; a tinted (non-transparent) background; the icon is a 24 px round badge.
    const style = await alert.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { border: cs.borderTopWidth, bg: cs.backgroundColor, color: cs.color };
    });
    expect(style.border).toBe("0px");
    expect(style.bg).not.toBe("rgba(0, 0, 0, 0)");
    const iconBox = await alert.getByTestId("alert-icon").boundingBox();
    expect(Math.round(iconBox!.width)).toBe(24);
    expect(Math.round(iconBox!.height)).toBe(24);
    // The text keeps the normal ink colour (not the variant colour, as before).
    const iconBg = await alert.getByTestId("alert-icon").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(style.color).not.toBe(iconBg);
  });
});
