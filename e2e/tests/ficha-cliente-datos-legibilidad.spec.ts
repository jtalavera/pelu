import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Ficha de la cliente › pestaña Datos, reorganizada para lectura rápida:
 *  1. Arriba, un resumen de solo lectura con lo más importante (teléfono, email, documento);
 *     teléfono y email son enlaces para llamar / escribir; lo que falta se marca "Not set".
 *  2. Cada bloque (Contacto, Datos fiscales, Perfil) es un panel con título y aclaración;
 *     Contacto se destaca respecto de los otros.
 *  3. Barra de acciones al pie, separada por una línea; Desactivar en rojo (el orden
 *     Cancelar → Desactivar → Guardar lo fija issue-161).
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
  test("1 · el resumen destaca teléfono, email y documento con enlaces", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const phoneNumber = uniqPhone();
    const client = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Datos ${uniq()}`,
      phone: phoneNumber,
      email: "ana@example.com",
      ruc: null,
      identityDocumentType: "CEDULA_PARAGUAYA",
      identityDocumentNumber: "4567890",
    });
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);

    const keyInfo = page.getByTestId("client-key-info");
    await expect(keyInfo).toBeVisible();
    const phone = page.getByTestId("client-key-info-phone");
    await expect(phone).toContainText("Phone");
    await expect(phone.getByRole("link", { name: `Call ${phoneNumber}` })).toHaveAttribute(
      "href",
      `tel:${phoneNumber.replace(/\D/g, "")}`,
    );
    const email = page.getByTestId("client-key-info-email");
    await expect(email.getByRole("link", { name: "Email ana@example.com" })).toHaveAttribute(
      "href",
      "mailto:ana@example.com",
    );
    const doc = page.getByTestId("client-key-info-document");
    await expect(doc).toContainText("4567890");
    await expect(doc).toContainText("Paraguayan national ID");

    // The summary values are larger than the form text so they stand out.
    const valueSize = await phone
      .locator("dd")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const inputSize = await page
      .locator("#detail-phone")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(valueSize).toBeGreaterThan(inputSize);

    // It sits above the Contact section.
    const keyBox = (await keyInfo.boundingBox())!;
    const contactBox = (await page.getByRole("region", { name: "Contact" }).boundingBox())!;
    expect(keyBox.y + keyBox.height).toBeLessThanOrEqual(contactBox.y);
  });

  test("1 · datos faltantes se muestran como 'Not set'", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const client = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Datos Vacios ${uniq()}`,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    await expect(page.getByTestId("client-key-info-phone")).toContainText("Not set");
    await expect(page.getByTestId("client-key-info-email")).toContainText("Not set");
    await expect(page.getByTestId("client-key-info-phone").getByRole("link")).toHaveCount(0);
  });

  test("2 + 3 · secciones en paneles con aclaración, Contacto destacado y acciones al pie", async ({
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

    const contact = page.getByRole("region", { name: "Contact" });
    const fiscal = page.getByRole("region", { name: "Tax details" });
    const profile = page.getByRole("region", { name: "Profile" });
    await expect(contact).toContainText("Name and how to reach them.");
    await expect(fiscal).toContainText("Used to issue the electronic invoice.");
    await expect(profile).toContainText("Birthday and how they found us.");

    const panel = (el: Element) => {
      const cs = getComputedStyle(el);
      return {
        bg: cs.backgroundColor,
        border: cs.borderTopColor,
        borderWidth: parseFloat(cs.borderTopWidth),
        radius: parseFloat(cs.borderTopLeftRadius),
      };
    };
    const c = await contact.evaluate(panel);
    const f = await fiscal.evaluate(panel);
    const p = await profile.evaluate(panel);
    for (const s of [c, f, p]) {
      expect(s.borderWidth).toBeGreaterThanOrEqual(1);
      expect(s.radius).toBeGreaterThanOrEqual(8);
    }
    expect(c.bg).not.toBe(f.bg);
    expect(c.border).not.toBe(f.border);
    expect(f.bg).toBe(p.bg);

    // Footer: separated from the form by a top border, below the last section; Deactivate in red.
    const deactivate = page.getByTestId("client-edit-deactivate");
    const footer = deactivate.locator("xpath=../..");
    const footerBorder = await footer.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
    expect(footerBorder).toBeGreaterThanOrEqual(1);
    const d = (await deactivate.boundingBox())!;
    const profileBox = (await profile.boundingBox())!;
    expect(d.y).toBeGreaterThan(profileBox.y + profileBox.height);
    const deactivateColor = await deactivate.evaluate((el) => getComputedStyle(el).color);
    const dangerColor = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "text-danger";
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(deactivateColor).toBe(dangerColor);
  });

  test("móvil · el resumen pasa a una columna y no hay scroll horizontal", async ({
    page,
    request,
  }) => {
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
    const phone = (await page.getByTestId("client-key-info-phone").boundingBox())!;
    const email = (await page.getByTestId("client-key-info-email").boundingBox())!;
    expect(email.y).toBeGreaterThan(phone.y + phone.height - 1);
    expect(Math.abs(email.x - phone.x)).toBeLessThanOrEqual(1);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});
