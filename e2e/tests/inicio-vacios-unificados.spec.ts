import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Inicio · «Turnos de hoy» y «Fichas de servicio de hoy» vacíos: mismo aspecto.
 * Un mensaje corto centrado y un botón primario, con el mismo espaciado, sin recuadro punteado.
 */
test.describe("Inicio · estados vacíos unificados", () => {
  test("Turnos y Fichas sin nada se ven iguales (mensaje, botón y espaciado)", async ({ page }) => {
    // The shared demo tenant may hold turnos / fichas for today (other specs): serve empty lists.
    await page.route("**/api/appointments?**", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/service-records?**", (route) =>
      route.fulfill({ json: { content: [], page: 0, size: 100, totalElements: 0, totalPages: 0 } }),
    );
    await loginAsDemo(page);

    const turnos = page.getByTestId("dashboard-appointments-empty");
    const fichas = page.getByTestId("dashboard-service-records-empty");
    await expect(turnos).toBeVisible({ timeout: 20_000 });
    await expect(fichas).toBeVisible();
    const turnosBtn = page.getByTestId("dashboard-appointments-create-first");
    const fichasBtn = page.getByTestId("dashboard-service-records-create-first");
    await expect(turnosBtn).toBeVisible();
    await expect(fichasBtn).toBeVisible();

    const look = (root: import("@playwright/test").Locator) =>
      root.evaluate((el) => {
        const msg = el.querySelector("p")!;
        const box = msg.parentElement!;
        const cs = (n: Element) => getComputedStyle(n);
        const rect = el.getBoundingClientRect();
        return {
          height: Math.round(rect.height),
          msgFontSize: cs(msg).fontSize,
          msgColor: cs(msg).color,
          align: cs(box).textAlign,
          padding: cs(box).padding,
          dashed: [el, box].some((n) => cs(n).borderStyle.includes("dashed")),
        };
      });
    const [a, b] = [await look(turnos), await look(fichas)];
    expect(b).toEqual(a);
    expect(a.dashed, "sin recuadro punteado").toBe(false);

    const btnLook = async (btn: import("@playwright/test").Locator) => {
      const r = (await btn.boundingBox())!;
      const s = await btn.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, fs: cs.fontSize, radius: cs.borderRadius };
      });
      return { h: Math.round(r.height), ...s };
    };
    expect(await btnLook(fichasBtn)).toEqual(await btnLook(turnosBtn));
    expect((await turnosBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
