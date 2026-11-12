import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  apiGetJson,
  apiPostJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { PASSWORD, professionalWithAccess } from "../fixtures/commissions";

/**
 * HU-67 · Resumen e historial en la ficha de la cliente.
 *
 * Only CLOSED service records count. A record is closed by issuing an invoice that references it
 * (InvoiceService auto-close), so the seeding helper below mirrors issue #223's. Records that must
 * fall outside the 12-month window are shifted into the past with the e2e-only
 * `/api/admin/service-record-test-support/{id}/backdate/{daysAgo}` endpoint.
 */
test.describe.configure({ mode: "serial" });

type Line = { serviceId: number; professionalId: number | null; quantity: number; unitPrice: number };

const moneyFmt = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });

async function createRecord(
  request: APIRequestContext,
  token: string,
  clientId: number,
  lines: Line[],
): Promise<{ id: number; totalAmount: number }> {
  return apiPostJson<{ id: number; totalAmount: number }>(request, token, "/api/service-records", {
    clientId,
    lines,
    tips: [],
  });
}

async function closeRecord(
  request: APIRequestContext,
  token: string,
  clientId: number,
  recordId: number,
  lines: Line[],
): Promise<void> {
  const total = lines.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);
  await apiPostJson(request, token, "/api/invoices", {
    clientId,
    clientDisplayName: null,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: lines.map((l) => ({
      serviceId: l.serviceId,
      description: "E2E67 line",
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountType: null,
      discountValue: null,
    })),
    payments: [{ method: "CASH", amount: total }],
    serviceRecordId: recordId,
    tipsAmount: 0,
  });
}

async function closedRecord(
  request: APIRequestContext,
  token: string,
  clientId: number,
  lines: Line[],
): Promise<{ id: number; totalAmount: number }> {
  const rec = await createRecord(request, token, clientId, lines);
  await closeRecord(request, token, clientId, rec.id, lines);
  const fresh = await apiGetJson<{ id: number; status: string; totalAmount: number }>(
    request,
    token,
    `/api/service-records/${rec.id}`,
  );
  expect(fresh.status).toBe("CLOSED");
  return { id: rec.id, totalAmount: Number(fresh.totalAmount) };
}

async function backdate(request: APIRequestContext, token: string, recordId: number, days: number) {
  const res = await request.post(
    `${API_BASE}/api/admin/service-record-test-support/${recordId}/backdate/${days}`,
    { headers: authHeaders(token) },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function seedProfessional(request: APIRequestContext, token: string, fullName: string) {
  return apiPostJson<{ id: number; fullName: string }>(request, token, "/api/professionals", {
    fullName,
    phone: null,
    email: null,
    photoDataUrl: null,
  });
}

async function seedCatalogItem(
  request: APIRequestContext,
  token: string,
  kind: "SERVICE" | "PRODUCT",
  name: string,
  price: number,
): Promise<{ id: number }> {
  const cat = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
    name: `E2E67 Cat ${kind} ${Date.now()}`,
    accentKey: "stone",
    kind,
  });
  return apiPostJson<{ id: number }>(request, token, "/api/services", {
    name,
    categoryId: cat.id,
    priceMinor: price,
    durationMinutes: kind === "PRODUCT" ? 1 : 60,
    kind,
  });
}

test.describe("HU-67 · Resumen e historial en la ficha de la cliente", () => {
  test("AC1, AC4, AC6, AC7, AC9, AC11 · cliente sin historial muestra el Historial con estados vacíos", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E67 Vacia ${Date.now()}`);

    await loginAsDemo(page);
    // Redesign: the summary lives in the "History" tab of the profile.
    await page.goto(`/app/clients/${client.id}?tab=radiography`);
    await expect(page.getByTestId("client-radiography")).toBeVisible();
    await expect(page.getByTestId("client-radiography-visits")).toContainText("0");
    await expect(page.getByTestId("client-radiography-spent")).toContainText("Gs. 0");
    await expect(page.getByTestId("client-radiography-ticket")).toContainText("Gs. 0");
    await expect(page.getByTestId("client-radiography-empty")).toBeVisible();
  });

  test("AC1 · el resumen se ve en celular y en tema oscuro sin scroll horizontal de página", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E67 Mobile ${Date.now()}`);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.addInitScript(() => localStorage.setItem("femme-theme", "dark"));
    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}?tab=radiography`);
    await expect(page.getByTestId("client-radiography")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("AC2, AC3, AC5, AC6, AC7, AC8, AC10, AC12 · habitual con empate, ventana de 12 meses, últimos servicios y productos", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);

    const suffix = Date.now();
    const client = await seedClient(request, token, `E2E67 Habitual ${suffix}`);
    const alpha = await seedProfessional(request, token, `E2E67 Alpha ${suffix}`);
    const bravo = await seedProfessional(request, token, `E2E67 Bravo ${suffix}`);
    const charlie = await seedProfessional(request, token, `E2E67 Charlie ${suffix}`);
    const cutName = `E2E67 Corte ${suffix}`;
    const colorName = `E2E67 Color ${suffix}`;
    const shampooName = `E2E67 Shampoo ${suffix}`;
    const cut = await seedCatalogItem(request, token, "SERVICE", cutName, 100_000);
    const color = await seedCatalogItem(request, token, "SERVICE", colorName, 250_000);
    const shampoo = await seedCatalogItem(request, token, "PRODUCT", shampooName, 45_000);

    // 13 months ago: four services by Charlie — the most overall, but outside the window.
    const old = await closedRecord(request, token, client.id, [
      { serviceId: cut.id, professionalId: charlie.id, quantity: 1, unitPrice: 100_000 },
      { serviceId: cut.id, professionalId: charlie.id, quantity: 1, unitPrice: 100_000 },
      { serviceId: cut.id, professionalId: charlie.id, quantity: 1, unitPrice: 100_000 },
      { serviceId: cut.id, professionalId: charlie.id, quantity: 1, unitPrice: 100_000 },
    ]);
    await backdate(request, token, old.id, 400);

    // Inside the window: one service each for Alpha and Bravo (tie), plus a product.
    const r1 = await closedRecord(request, token, client.id, [
      { serviceId: color.id, professionalId: alpha.id, quantity: 1, unitPrice: 250_000 },
      { serviceId: shampoo.id, professionalId: null, quantity: 2, unitPrice: 45_000 },
    ]);
    await backdate(request, token, r1.id, 30);
    const r2 = await closedRecord(request, token, client.id, [
      { serviceId: cut.id, professionalId: bravo.id, quantity: 1, unitPrice: 100_000 },
    ]);

    // AC12: an OPEN record and a VOIDED record for Alpha must not break the tie.
    await createRecord(request, token, client.id, [
      { serviceId: cut.id, professionalId: alpha.id, quantity: 1, unitPrice: 100_000 },
    ]);
    const toVoid = await createRecord(request, token, client.id, [
      { serviceId: cut.id, professionalId: alpha.id, quantity: 1, unitPrice: 100_000 },
    ]);
    await apiPostJson(request, token, `/api/service-records/${toVoid.id}/void`, {
      voidReason: "E2E67 anulado",
    });

    // AC5: an inactive professional still counts and is labelled.
    const deact = await request.post(`${API_BASE}/api/professionals/${bravo.id}/deactivate`, {
      headers: authHeaders(token),
    });
    expect(deact.ok(), await deact.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}?tab=radiography`);

    // AC2 + AC3: professionals ranking by services performed (closed records only).
    const pros = page.getByTestId("client-radiography-professionals");
    await expect(pros).toContainText(alpha.fullName);
    await expect(pros).toContainText(bravo.fullName);

    // AC7: spent and average ticket count only the two in-window CLOSED records.
    const spent = r1.totalAmount + r2.totalAmount;
    await expect(page.getByTestId("client-radiography-spent")).toContainText(moneyFmt.format(spent));
    await expect(page.getByTestId("client-radiography-ticket")).toContainText(
      moneyFmt.format(Math.round(spent / 2)),
    );
    await expect(page.getByTestId("client-radiography-visits")).toContainText("3");

    // Most frequent services: the services performed, never the product.
    const top = page.getByTestId("client-radiography-services");
    await expect(top).toContainText(cutName);
    await expect(top).toContainText(colorName);
    await expect(top).not.toContainText(shampooName);

    // AC8: last services, newest first, capped at 5 (Charlie's old ones still listed).
    const last = page.getByTestId("client-radiography-last").getByRole("listitem");
    await expect(last).toHaveCount(5);
    await expect(last.nth(0)).toContainText(cutName);
    await expect(last.nth(0)).toContainText(bravo.fullName);
    await expect(last.nth(1)).toContainText(colorName);
    await expect(last.nth(1)).toContainText(alpha.fullName);
    await expect(last.nth(1)).toContainText(moneyFmt.format(250_000));
    for (const i of [2, 3, 4]) {
      await expect(last.nth(i)).toContainText(charlie.fullName);
    }
    await expect(page.getByTestId("client-radiography-last")).not.toContainText(shampooName);
  });

  test("AC13 · el resumen de una cliente inexistente en el tenant responde 404", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const res = await request.get(`${API_BASE}/api/clients/99999999/summary`, {
      headers: authHeaders(token),
    });
    expect(res.status()).toBe(404);
  });

  test("AC14 · el rol profesional no accede al resumen (403)", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E67 Prof ${Date.now()}`);
    const prof = await professionalWithAccess(request, token, `E2E67 ProfAccess ${Date.now()}`);
    const login = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: prof.email, password: PASSWORD },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    const profToken = ((await login.json()) as { accessToken: string }).accessToken;
    const res = await request.get(`${API_BASE}/api/clients/${client.id}/summary`, {
      headers: authHeaders(profToken),
    });
    expect(res.status()).toBe(403);
  });
});
