import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Ficha de la cliente › pestaña Datos (rediseño minimalista):
 *  1. Encabezado simple: visitas, WhatsApp (solo con teléfono); "Llamar" solo en móviles.
 *  2. Contacto siempre visible; Datos fiscales y Perfil plegados (aria-expanded) y se abren a demanda.
 *  3. Acciones al pie separadas por una línea (Cancelar, Guardar).
 *  4. En móvil no hay scroll horizontal.
 */
function uniq(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/** Phone numbers are unique per tenant, so every run needs a fresh one. */
function uniqPhone(): string {
  const n = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return `(0981) ${n.slice(0, 3)}-${n.slice(3)}`;
}

test.describe("Ficha de la cliente · pestaña Datos legible", () => {
  test("1 · con teléfono el encabezado ofrece WhatsApp y sin él no", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const withPhone = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Datos ${uniq()}`,
      phone: uniqPhone(),
      email: "ana@example.com",
      ruc: null,
    });
    const without = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Datos Vacios ${uniq()}`,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await page.goto(`/app/clients/${withPhone.id}`);
    await expect(page.getByTestId("client-whatsapp")).toBeVisible();
    // "Call" is only offered on phones and tablets (desktop Chromium is not one).
    await expect(page.getByTestId("client-call")).toHaveCount(0);
    await expect(page.locator("#detail-email")).toHaveValue("ana@example.com");
    await page.goto(`/app/clients/${without.id}`);
    await expect(page.getByTestId("client-header-facts")).toBeVisible();
    await expect(page.getByTestId("client-whatsapp")).toHaveCount(0);
  });

  test("2 · Contacto visible y Datos fiscales / Perfil plegados que se abren a demanda", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Datos Paneles ${uniq()}`,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);

    await expect(page.getByTestId("client-section-contact")).toBeVisible();
    await expect(page.locator("#detail-fullname")).toBeVisible();

    for (const name of ["fiscal", "profile"] as const) {
      const toggle = page.getByTestId(`client-section-${name}-toggle`);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
    await page.getByTestId("client-section-fiscal-toggle").click();
    await expect(page.locator("#detail-identity-document-number")).toBeVisible();
  });

  test("3 · acciones al pie separadas por una línea", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const client = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Datos Pie ${uniq()}`,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    const cancel = page.getByTestId("client-edit-cancel");
    const footer = cancel.locator("xpath=..");
    const border = await footer.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
    expect(border).toBeGreaterThanOrEqual(1);
    const c = (await cancel.boundingBox())!;
    const full = (await page.locator("#detail-fullname").boundingBox())!;
    expect(c.y).toBeGreaterThan(full.y + full.height);
    await expect(footer.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  });

  test("móvil · la ficha no tiene scroll horizontal", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const client = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Datos Movil ${uniq()}`,
      phone: uniqPhone(),
      email: null,
      ruc: null,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    await expect(page.locator("#detail-phone")).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});
