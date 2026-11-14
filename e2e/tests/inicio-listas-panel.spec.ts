import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiPostJson,
  createAppointmentApi,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  soonTodaySlot,
  type SeededSalon,
  API_BASE,
  authHeaders,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { revealAppointmentRow, revealFichaCard } from "../fixtures/dashboard";

/**
 * Inicio · las listas de «Turnos de hoy» y «Fichas de servicio de hoy» no crecen sin límite:
 *  - Turnos: lo que falta atender o cobrar queda a la vista (incluidos los completados sin cobrar,
 *    marcados) y solo los COBRADOS (completados con comprobante) se pliegan en «Cobrados (N)».
 *  - Fichas: todas las abiertas a la vista; las cobradas y anuladas, plegadas en «Cobradas y
 *    anuladas (N)», de a 12 con «Más (n)» que pide las siguientes al servidor.
 *  - El buscador abre el pliegue solo cuando lo que coincide está adentro.
 *  (El punto con las fichas abiertas de días anteriores en «Ver historial» se cubre en Vitest: una
 *  ficha no se puede crear con fecha pasada desde la API.)
 */
test.describe.configure({ mode: "serial" });

async function newFicha(request: APIRequestContext, token: string, clientId: number, seed: SeededSalon) {
  return apiPostJson<{ id: number }>(request, token, "/api/service-records", {
    clientId,
    lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 1, unitPrice: 50_000 }],
    tips: [],
  });
}

test.describe("Inicio · listas del panel", () => {
  test("Fichas: las abiertas a la vista, las anuladas plegadas de a 12 con «Más (n)»", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const marker = `E2E Panel ${Date.now()}`;

    const openClient = await seedClient(request, token, `${marker} abierta`);
    await newFicha(request, token, openClient.id, seed);
    // 14 voided fichas, the newest of the day: the first 12 fit one page and 2 need «Más».
    const voidedNames: string[] = [];
    for (let i = 0; i < 14; i++) {
      const c = await seedClient(request, token, `${marker} anulada ${String(i).padStart(2, "0")}`);
      const f = await newFicha(request, token, c.id, seed);
      const res = await request.post(`${API_BASE}/api/service-records/${f.id}/void`, {
        headers: authHeaders(token),
        data: { voidReason: "E2E panel" },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      voidedNames.push(c.fullName);
    }

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    const cards = page.getByTestId("dashboard-service-record-card");
    // The open one is on view with no click; the voided ones are not listed yet.
    await expect(cards.filter({ hasText: openClient.fullName })).toBeVisible({ timeout: 20_000 });
    await expect(cards.filter({ hasText: `${marker} anulada` })).toHaveCount(0);

    const toggle = page.getByTestId("dashboard-service-records-closed-toggle");
    await expect(toggle).toBeVisible();
    const total = Number(await page.getByTestId("dashboard-service-records-closed-count").innerText());
    expect(total).toBeGreaterThanOrEqual(14);

    await toggle.click();
    await expect(page.getByTestId("dashboard-service-records-closed-list")).toBeVisible();
    // 12 per page (the newest first): «Más (n)» says how many are left and loads the next ones.
    const more = page.getByTestId("dashboard-service-records-more");
    await expect(more).toBeVisible();
    await expect(more).toHaveText(/^More \(\d+\)$/);
    const voided = cards.filter({ hasText: `${marker} anulada` });
    await expect(voided).toHaveCount(12);
    // Page through: wait for each page to load (the button is disabled meanwhile, and gone after the last).
    for (let i = 0; i < 40 && (await more.isVisible()); i++) {
      await expect(more).toBeEnabled();
      const before = await more.innerText();
      await more.click();
      await expect
        .poll(async () => (await more.count()) === 0 || ((await more.isEnabled()) && (await more.innerText()) !== before), {
          timeout: 20_000,
        })
        .toBe(true);
    }
    await expect(voided).toHaveCount(14);
    await expect(more).toHaveCount(0);
    expect(voidedNames.length).toBe(14);
  });

  test("Fichas: el buscador abre solo el pliegue cuando lo que coincide es una ficha anulada", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Busca ${Date.now()}`);
    const f = await newFicha(request, token, client.id, seed);
    const res = await request.post(`${API_BASE}/api/service-records/${f.id}/void`, {
      headers: authHeaders(token),
      data: { voidReason: "E2E panel" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    await expect(page.getByTestId("dashboard-service-records-closed-toggle")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("dashboard-service-records-closed-toggle")).toHaveAttribute("aria-expanded", "false");

    await page.locator("#dashboard-records-filter").fill(client.fullName.slice(0, 14));
    const hit = page.getByTestId("dashboard-service-record-card").filter({ hasText: client.fullName });
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("dashboard-service-records-closed-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("dashboard-service-records-older-dot")).toHaveCount(0);
    // The ficha can be reached the usual way too.
    expect(await revealFichaCard(page, client.fullName)).toBeTruthy();
  });

  test("Turnos: lo que falta atender o cobrar queda a la vista (con el completado sin cobrar marcado) y solo los cobrados se pliegan", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    const stamp = Date.now();
    const slot = soonTodaySlot().toISOString();

    const book = async (label: string) => {
      const seed = await seedCategoryServiceProfessional(request, token);
      const client = await seedClient(request, token, `E2E PanelT ${label} ${stamp}`);
      const turno = await createAppointmentApi(request, token, {
        clientId: client.id,
        professionalId: seed.professionalId,
        serviceId: seed.serviceId,
        startAt: slot,
      });
      return { seed, client, turno };
    };
    const setStatus = async (id: number, status: string) => {
      const res = await request.patch(`${API_BASE}/api/appointments/${id}/status`, {
        headers: authHeaders(token),
        data: { status, cancelReason: null },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    };

    const pending = await book("Pend");
    const uncharged = await book("SinCobrar");
    await setStatus(uncharged.turno.id, "COMPLETED");
    const charged = await book("Cobrado");
    const ficha = await apiPostJson<{ id: number }>(request, token, `/api/appointments/${charged.turno.id}/service-record`, {});
    await apiPostJson(request, token, "/api/invoices", {
      clientId: charged.client.id,
      clientDisplayName: null,
      clientRucOverride: null,
      discountType: null,
      discountValue: null,
      lines: [
        { serviceId: charged.seed.serviceId, description: "E2E panel", quantity: 1, unitPrice: 50_000, discountType: null, discountValue: null },
      ],
      payments: [{ method: "CASH", amount: 50_000 }],
      serviceRecordId: ficha.id,
      tipsAmount: 0,
    });

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    const rows = page.getByTestId("dashboard-appointment-row");
    const pendingRow = rows.filter({ hasText: pending.client.fullName.toUpperCase() });
    const unchargedRow = rows.filter({ hasText: uncharged.client.fullName.toUpperCase() });
    const chargedRow = rows.filter({ hasText: charged.client.fullName.toUpperCase() });
    await expect(pendingRow).toBeVisible({ timeout: 20_000 });
    // Completed but not charged yet: still on view, marked.
    await expect(unchargedRow).toBeVisible();
    await expect(unchargedRow.getByTestId("dashboard-appointment-uncharged-tag")).toContainText("not charged");
    // Charged: folded in «Cobrados».
    await expect(chargedRow).toHaveCount(0);
    const toggle = page.getByTestId("dashboard-appointments-charged-toggle");
    await expect(toggle).toBeVisible();
    expect(Number(await page.getByTestId("dashboard-appointments-charged-count").innerText())).toBeGreaterThanOrEqual(1);

    const row = await revealAppointmentRow(page, (all) => all.filter({ hasText: charged.client.fullName.toUpperCase() }));
    await expect(row.getByTestId("dashboard-appointment-charged-tag")).toContainText("Charged");
  });

  test("Turnos: el buscador abre solo «Cobrados» cuando lo que coincide es un turno cobrado", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E PanelB ${Date.now()}`);
    const turno = await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: soonTodaySlot().toISOString(),
    });
    const ficha = await apiPostJson<{ id: number }>(request, token, `/api/appointments/${turno.id}/service-record`, {});
    await apiPostJson(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: null,
      clientRucOverride: null,
      discountType: null,
      discountValue: null,
      lines: [{ serviceId: seed.serviceId, description: "E2E panel", quantity: 1, unitPrice: 50_000, discountType: null, discountValue: null }],
      payments: [{ method: "CASH", amount: 50_000 }],
      serviceRecordId: ficha.id,
      tipsAmount: 0,
    });

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    await expect(page.getByTestId("dashboard-appointments-charged-toggle")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("dashboard-appointments-charged-toggle")).toHaveAttribute("aria-expanded", "false");
    await page.locator("#dashboard-appt-filter").fill(client.fullName.slice(0, 12));
    await expect(
      page.getByTestId("dashboard-appointment-row").filter({ hasText: client.fullName.toUpperCase() }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("dashboard-appointments-charged-toggle")).toHaveAttribute("aria-expanded", "true");
  });
});
