import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  API_BASE,
  apiGetJson,
  apiPostJson,
  authHeaders,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  type SeededSalon,
} from "../fixtures/api";
import { DEMO_PASSWORD, loginAs, loginAsDemo } from "../fixtures/auth";
import { PASSWORD, professionalWithAccess } from "../fixtures/commissions";

/**
 * Inicio · fichas de servicio de hoy como tarjetas.
 *  - Admin: las abiertas se destacan (borde ámbar, monto y «Cobrar»); cobradas/anuladas, más discretas.
 *  - Profesional (con clave y en el dispositivo compartido con PIN): el Inicio es su primera pantalla;
 *    ve TODAS las fichas abiertas del día, sin montos, y puede agregar / cambiar / quitar servicios y
 *    cantidades, pero no fija precios ni propinas.
 */
test.describe.configure({ mode: "serial" });

type Line = { id: number; serviceId: number; unitPrice: string | number | null; quantity: number; lineTotal: string | number | null };
type Ficha = {
  id: number;
  status: string;
  totalAmount: string | number | null;
  tipsTotal: string | number | null;
  lines: Line[];
  tips: { professionalId: number; amount: string | number | null }[];
};

async function createFicha(
  request: APIRequestContext,
  token: string,
  clientId: number,
  seed: SeededSalon,
  opts: { unitPrice?: number; quantity?: number; tip?: number } = {},
): Promise<Ficha> {
  return apiPostJson<Ficha>(request, token, "/api/service-records", {
    clientId,
    lines: [
      {
        serviceId: seed.serviceId,
        professionalId: seed.professionalId,
        quantity: opts.quantity ?? 1,
        unitPrice: opts.unitPrice ?? 50_000,
      },
    ],
    tips: opts.tip ? [{ professionalId: seed.professionalId, amount: opts.tip }] : [],
  });
}

async function secondService(request: APIRequestContext, token: string, seed: SeededSalon, price = 30_000) {
  const name = `E2E Svc2 ${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const svc = await apiPostJson<{ id: number }>(request, token, "/api/services", {
    name,
    categoryId: seed.categoryId,
    priceMinor: price,
    durationMinutes: 30,
  });
  return { id: svc.id, name };
}

async function proToken(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API_BASE}/api/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { accessToken: string }).accessToken;
}

function cardOf(page: Page, clientName: string) {
  return page.getByTestId("dashboard-service-record-card").filter({ hasText: clientName });
}

/** The grid shows 12 cards and a "Show more" button: reveal more until the card is on screen. */
async function revealCard(page: Page, clientName: string) {
  const card = cardOf(page, clientName);
  const more = page.getByTestId("dashboard-service-records-more");
  await expect(page.getByTestId("dashboard-service-record-card").first()).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 50 && !(await card.isVisible()) && (await more.isVisible()); i++) await more.click();
  await expect(card).toBeVisible();
  return card;
}

test.describe("Inicio del admin · tarjetas de fichas", () => {
  test("las abiertas muestran monto y «Cobrar»; las anuladas quedan después y sin cobrar", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const ts = Date.now();
    const openClient = await seedClient(request, token, `E2E IF Abierta ${ts}`);
    const voidClient = await seedClient(request, token, `E2E IF Anulada ${ts}`);
    await createFicha(request, token, openClient.id, seed, { unitPrice: 50_000 });
    const toVoid = await createFicha(request, token, voidClient.id, seed);
    await apiPostJson(request, token, `/api/service-records/${toVoid.id}/void`, { voidReason: "E2E tarjetas" });

    await loginAsDemo(page);
    await page.goto("/app");
    await expect(page.getByTestId("dashboard-today-records")).toBeVisible({ timeout: 20_000 });
    // Cards are right on the Inicio (not folded) and every open one is counted in the header pill.
    await expect(page.getByTestId("dashboard-today-records-open-count")).toContainText("open");

    const open = await revealCard(page, openClient.fullName);
    await expect(open).toHaveAttribute("data-status", "OPEN");
    await expect(open).toContainText("50.000");
    await expect(open.getByRole("button", { name: /^Charge/ })).toBeVisible();

    const voided = await revealCard(page, voidClient.fullName);
    // Rows of a compact list: the open one has «Cobrar», the voided one only a quiet status label.
    await expect(voided).toHaveAttribute("data-status", "VOIDED");
    await expect(voided.getByRole("button", { name: /^Charge/ })).toHaveCount(0);

    // Open ones first.
    const statuses = await page.getByTestId("dashboard-service-record-card").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-status")),
    );
    expect(statuses.indexOf("OPEN")).toBeLessThan(statuses.lastIndexOf("VOIDED"));
  });

  test("«Cobrar» abre Facturación con la ficha y tocar la tarjeta abre el detalle", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E IF Cobrar ${Date.now()}`);
    await createFicha(request, token, client.id, seed);

    await loginAsDemo(page);
    await page.goto("/app");
    const card = cardOf(page, client.fullName);
    await expect(card).toBeVisible({ timeout: 20_000 });

    await card.click({ position: { x: 40, y: 20 } });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("service-record-total")).toBeVisible();
    await dialog.getByTestId("service-record-close").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await card.getByRole("button", { name: /^Charge/ }).click();
    await expect(page).toHaveURL(/\/app\/billing/);
    await expect(page.getByText(client.fullName).first()).toBeVisible();
  });
});

test.describe("Inicio de la profesional (con clave)", () => {
  test("entra al Inicio, ve todas las fichas abiertas de hoy sin montos y edita servicios y cantidades", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const extra = await secondService(request, admin, seed, 30_000);
    const pro = await professionalWithAccess(request, admin, `E2E IF Prof ${Date.now()}`);
    const ts = Date.now();
    // Someone else's ficha (another professional): she still sees every open ficha of the day.
    const ownClient = await seedClient(request, admin, `E2E IF Propia ${ts}`);
    const otherClient = await seedClient(request, admin, `E2E IF Ajena ${ts}`);
    const closedClient = await seedClient(request, admin, `E2E IF Anulada ${ts}`);
    const ficha = await createFicha(request, admin, ownClient.id, seed, { unitPrice: 40_000, tip: 5_000 });
    await createFicha(request, admin, otherClient.id, seed);
    const voided = await createFicha(request, admin, closedClient.id, seed);
    await apiPostJson(request, admin, `/api/service-records/${voided.id}/void`, { voidReason: "E2E" });

    await loginAs(page, pro.email, PASSWORD);

    // First screen: the Inicio with the cards.
    await expect(page).toHaveURL(/\/app\/?$/);
    await expect(page.getByTestId("professional-home")).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();

    const own = cardOf(page, ownClient.fullName);
    await expect(own).toBeVisible({ timeout: 20_000 });
    await expect(cardOf(page, otherClient.fullName)).toBeVisible();
    // Only open fichas; and no money anywhere on the cards.
    await expect(cardOf(page, closedClient.fullName)).toHaveCount(0);
    const cardsText = (await page.getByTestId("dashboard-today-records").innerText()).replace(/\s+/g, " ");
    expect(cardsText).not.toMatch(/Gs\.|\d{1,3}(\.\d{3})+/);
    await expect(page.getByRole("button", { name: /^Charge/ })).toHaveCount(0);

    // Open the ficha: services and quantities only.
    await own.click({ position: { x: 40, y: 20 } });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("service-record-line")).toHaveCount(1);
    await expect(dialog.locator("#service-record-line-svc-0")).toHaveCount(0);
    await expect(dialog.getByTestId("service-record-total")).toHaveCount(0);
    await expect(dialog.getByTestId("service-record-tips-toggle")).toHaveCount(0);
    await expect(dialog.getByTestId("service-record-void-open")).toHaveCount(0);
    await expect(dialog.getByTestId("service-record-generate-invoice")).toHaveCount(0);
    await expect(dialog.locator("#service-record-line-price-0")).toHaveCount(0);
    const dialogText = (await dialog.innerText()).replace(/\s+/g, " ");
    expect(dialogText).not.toMatch(/Gs\.|\d{1,3}(\.\d{3})+/);

    // Change the quantity of the existing service to 2 and add another service.
    await dialog.getByTestId("service-record-line-inc").first().click();
    await expect(dialog.getByTestId("service-record-line-qty").first()).toHaveText("2");
    await dialog.getByTestId("service-record-add-line").click();
    await expect(page.getByTestId("service-picker")).toBeVisible();
    await page.getByTestId("service-picker-search").fill(extra.name);
    await page.getByTestId("service-picker-option").filter({ hasText: extra.name }).first().click();
    await expect(page.getByTestId("service-picker")).toHaveCount(0);
    await expect(dialog.getByTestId("service-record-line")).toHaveCount(2);
    await dialog.getByTestId("service-record-submit").click();
    await expect(page.getByTestId("dashboard-record-toast")).toContainText("Changes saved.", { timeout: 15_000 });

    // The salon's record: the kept service keeps its price (40.000 × 2), the new one takes the
    // catalog price (30.000), the tip she could not see or set is untouched.
    const saved = await apiGetJson<Ficha>(request, admin, `/api/service-records/${ficha.id}`);
    expect(saved.lines).toHaveLength(2);
    const kept = saved.lines.find((l) => l.serviceId === seed.serviceId)!;
    const added = saved.lines.find((l) => l.serviceId === extra.id)!;
    expect(kept.quantity).toBe(2);
    expect(Number(kept.unitPrice)).toBe(40_000);
    expect(Number(added.unitPrice)).toBe(30_000);
    expect(Number(saved.totalAmount)).toBe(110_000);
    expect(saved.tips).toHaveLength(1);
    expect(Number(saved.tips[0].amount)).toBe(5_000);

    // Remove the extra service again.
    await own.click({ position: { x: 40, y: 20 } });
    await expect(dialog.getByTestId("service-record-line")).toHaveCount(2);
    await dialog.getByTestId("service-record-line-dec").last().click(); // quantity 1 → 0 removes it
    await expect(dialog.getByTestId("service-record-line")).toHaveCount(1);
    await dialog.getByTestId("service-record-submit").click();
    await expect(page.getByTestId("dashboard-record-toast")).toContainText("Changes saved.", { timeout: 15_000 });
    const after = await apiGetJson<Ficha>(request, admin, `/api/service-records/${ficha.id}`);
    expect(after.lines).toHaveLength(1);
    expect(Number(after.totalAmount)).toBe(80_000);
  });

  test("API: sin montos ni propinas, no crea ni anula, no toca lo que no es abierto de hoy", async ({ request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const extra = await secondService(request, admin, seed, 30_000);
    const pro = await professionalWithAccess(request, admin, `E2E IF ApiProf ${Date.now()}`);
    const token = await proToken(request, pro.email);
    const client = await seedClient(request, admin, `E2E IF Api ${Date.now()}`);
    const ficha = await createFicha(request, admin, client.id, seed, { unitPrice: 40_000, tip: 5_000 });
    const headers = authHeaders(token);

    // List: only open fichas, no amounts.
    const list = await apiGetJson<{ content: { id: number; status: string; totalAmount: unknown }[] }>(
      request,
      token,
      "/api/service-records",
    );
    expect(list.content.length).toBeGreaterThan(0);
    expect(list.content.every((r) => r.status === "OPEN" && r.totalAmount === null)).toBe(true);

    // Detail: no money, no tips.
    const detail = await apiGetJson<Ficha>(request, token, `/api/service-records/${ficha.id}`);
    expect(detail.totalAmount).toBeNull();
    expect(detail.tipsTotal).toBeNull();
    expect(detail.tips).toEqual([]);
    expect(detail.lines.every((l) => l.unitPrice === null && l.lineTotal === null)).toBe(true);

    // Update with prices / tips in the body: both ignored.
    const put = await request.put(`${API_BASE}/api/service-records/${ficha.id}`, {
      headers,
      data: {
        clientId: client.id,
        lines: [
          { serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 3, unitPrice: 1 },
          { serviceId: extra.id, professionalId: seed.professionalId, quantity: 1, unitPrice: 1 },
        ],
        tips: [{ professionalId: seed.professionalId, amount: 999_999 }],
      },
    });
    expect(put.ok(), await put.text()).toBeTruthy();
    const stored = await apiGetJson<Ficha>(request, admin, `/api/service-records/${ficha.id}`);
    expect(Number(stored.lines.find((l) => l.serviceId === seed.serviceId)!.unitPrice)).toBe(40_000);
    expect(Number(stored.lines.find((l) => l.serviceId === extra.id)!.unitPrice)).toBe(30_000);
    expect(Number(stored.totalAmount)).toBe(40_000 * 3 + 30_000);
    expect(Number(stored.tips[0].amount)).toBe(5_000);

    // She cannot create or void.
    const create = await request.post(`${API_BASE}/api/service-records`, {
      headers,
      data: { clientId: client.id, lines: [], tips: [] },
    });
    expect(create.status()).toBe(403);
    const voidRes = await request.post(`${API_BASE}/api/service-records/${ficha.id}/void`, {
      headers,
      data: { voidReason: "no" },
    });
    expect(voidRes.status()).toBe(403);

    // A voided ficha is no longer reachable for her.
    await apiPostJson(request, admin, `/api/service-records/${ficha.id}/void`, { voidReason: "E2E" });
    const gone = await request.get(`${API_BASE}/api/service-records/${ficha.id}`, { headers });
    expect(gone.status()).toBe(409);
    const updateGone = await request.put(`${API_BASE}/api/service-records/${ficha.id}`, {
      headers,
      data: { clientId: client.id, lines: [], tips: [] },
    });
    expect(updateGone.status()).toBe(409);
  });
});

test.describe("Dispositivo compartido con PIN", () => {
  test("la primera pantalla son las tarjetas de las fichas abiertas del día, y se pueden editar sin ver montos", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const extra = await secondService(request, admin, seed, 30_000);
    const pin = String(100000 + Math.floor(Math.random() * 899999));
    const pro = await apiPostJson<{ id: number }>(request, admin, "/api/professionals", {
      fullName: `E2E IF Pin ${Date.now()}`,
      pin,
      email: null,
    });
    const device = await apiPostJson<{
      device: { id: number; name: string };
      deviceToken: string;
      tenantName: string;
    }>(request, admin, "/api/shared-devices", { name: `Tablet IF ${Date.now()}`, password: DEMO_PASSWORD });
    const client = await seedClient(request, admin, `E2E IF Pin Cliente ${Date.now()}`);
    const ficha = await createFicha(request, admin, client.id, seed, { unitPrice: 40_000, tip: 5_000 });

    await page.addInitScript(
      ([key, value]) => {
        localStorage.setItem(key, value);
        localStorage.setItem("cursor_poc.i18n.language", "en");
        localStorage.setItem("femme.tour.seen.calendar", "true");
      },
      [
        "femme.sharedDevice",
        JSON.stringify({
          deviceId: device.device.id,
          name: device.device.name,
          tenantName: device.tenantName,
          token: device.deviceToken,
        }),
      ] as const,
    );
    await page.goto("/device");
    await page.getByTestId(`shared-device-professional-${pro.id}`).click();
    const pad = page.getByTestId("pin-pad");
    for (const d of pin) await pad.getByRole("button", { name: d, exact: true }).click();
    await page.getByTestId("pin-submit").click();

    // First screen: the Inicio with the day's open fichas as cards.
    await expect(page).toHaveURL(/\/app\/?$/);
    await expect(page.getByTestId("professional-home")).toBeVisible();
    const card = cardOf(page, client.fullName);
    await expect(card).toBeVisible({ timeout: 20_000 });
    const text = (await page.getByTestId("dashboard-today-records").innerText()).replace(/\s+/g, " ");
    expect(text).not.toMatch(/Gs\.|\d{1,3}(\.\d{3})+/);

    // Add a service from the card; no prices, no tips.
    await card.click({ position: { x: 40, y: 20 } });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("service-record-tips-toggle")).toHaveCount(0);
    await expect(dialog.getByTestId("service-record-total")).toHaveCount(0);
    await dialog.getByTestId("service-record-add-line").click();
    await expect(page.getByTestId("service-picker")).toBeVisible();
    await page.getByTestId("service-picker-search").fill(extra.name);
    await page.getByTestId("service-picker-option").filter({ hasText: extra.name }).first().click();
    await expect(page.getByTestId("service-picker")).toHaveCount(0);
    await expect(dialog.getByTestId("service-record-line")).toHaveCount(2);
    await dialog.getByTestId("service-record-submit").click();
    await expect(page.getByTestId("dashboard-record-toast")).toContainText("Changes saved.", { timeout: 15_000 });

    const saved = await apiGetJson<Ficha>(request, admin, `/api/service-records/${ficha.id}`);
    expect(saved.lines).toHaveLength(2);
    expect(Number(saved.lines.find((l) => l.serviceId === extra.id)!.unitPrice)).toBe(30_000);
    expect(Number(saved.tips[0].amount)).toBe(5_000);
  });
});
