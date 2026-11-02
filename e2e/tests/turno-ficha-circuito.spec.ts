import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  apiGetJson,
  apiPostJson,
  authHeaders,
  createAppointmentApi,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  type SeededSalon,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { PASSWORD, professionalWithAccess } from "../fixtures/commissions";

/**
 * Circuito turno ↔ ficha de servicio.
 *  - En el Inicio, un turno sin ficha ofrece «Crear o asignar ficha»; con ficha, «Ir a la ficha».
 *  - Crear o asignar pasa el turno a En curso; la ficha muestra a qué turno pertenece.
 *  - Cobrar la ficha completa ficha y turno; cancelar el turno suelta la ficha abierta.
 *  - Un turno tiene una sola ficha; una profesional solo opera sus turnos.
 */
test.describe.configure({ mode: "serial" });

type Appt = { id: number; status: string; serviceRecordId: number | null };
type Ficha = {
  id: number;
  status: string;
  appointmentId: number | null;
  clientId: number;
  lines: { serviceId: number; professionalId: number | null; quantity: number; unitPrice: string | number | null }[];
};

async function seedTurno(
  request: APIRequestContext,
  token: string,
  seed: SeededSalon,
  clientId: number,
): Promise<{ id: number }> {
  // Later today (local time), so the turno shows up in Inicio's list.
  const slot = new Date();
  slot.setHours(Math.min(23, slot.getHours() + 1), 0, 0, 0);
  return createAppointmentApi(request, token, {
    clientId,
    professionalId: seed.professionalId,
    serviceId: seed.serviceId,
    startAt: slot.toISOString(),
  });
}

async function setStatus(request: APIRequestContext, token: string, id: number, status: string) {
  const res = await request.patch(`${API_BASE}/api/appointments/${id}/status`, {
    headers: authHeaders(token),
    data: { status, cancelReason: status === "CANCELLED" ? "E2E" : null },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function getAppt(request: APIRequestContext, token: string, id: number): Promise<Appt> {
  return apiGetJson<Appt>(request, token, `/api/appointments/${id}`);
}

async function openFicha(request: APIRequestContext, token: string, clientId: number, seed: SeededSalon) {
  return apiPostJson<Ficha>(request, token, "/api/service-records", {
    clientId,
    lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 1, unitPrice: 50_000 }],
    tips: [],
  });
}

async function chargeFicha(request: APIRequestContext, token: string, clientId: number, ficha: Ficha, seed: SeededSalon) {
  await apiPostJson(request, token, "/api/invoices", {
    clientId,
    clientDisplayName: null,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [
      { serviceId: seed.serviceId, description: "E2E turno-ficha", quantity: 1, unitPrice: 50_000, discountType: null, discountValue: null },
    ],
    payments: [{ method: "CASH", amount: 50_000 }],
    serviceRecordId: ficha.id,
    tipsAmount: 0,
  });
}

async function proToken(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API_BASE}/api/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { accessToken: string }).accessToken;
}

test.describe("Turno y ficha de servicio", () => {
  test("Inicio: «Crear o asignar ficha» crea la ficha del turno, lo pasa a En curso y cambia a «Ir a la ficha»", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E TF Crear ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    const turno = await seedTurno(request, admin, seed, client.id);

    await loginAsDemo(page);
    const row = page.getByTestId("dashboard-appointment-row").filter({ hasText: clientName });
    await expect(row).toContainText("Pending");
    await expect(row.getByTestId("dashboard-appointment-ficha-go")).toHaveCount(0);
    await row.getByTestId("dashboard-appointment-ficha-create-or-assign").click();

    const modal = page.getByTestId("appointment-ficha-modal");
    await expect(modal.getByTestId("appointment-ficha-create")).toBeVisible();
    await expect(modal.getByTestId("appointment-ficha-no-candidates")).toBeVisible();
    await modal.getByTestId("appointment-ficha-create").click();

    // The new ficha opens, showing the turno it belongs to.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("service-record-appointment")).toBeVisible();
    await dialog.getByTestId("service-record-close").click();

    await expect(row.getByTestId("dashboard-appointment-ficha-go")).toBeVisible();
    await expect(row).toContainText("In progress");
    await expect(row.getByTestId("dashboard-appointment-ficha-create-or-assign")).toHaveCount(0);

    const appt = await getAppt(request, admin, turno.id);
    expect(appt.status).toBe("IN_PROGRESS");
    expect(appt.serviceRecordId).not.toBeNull();
    const ficha = await apiGetJson<Ficha>(request, admin, `/api/service-records/${appt.serviceRecordId}`);
    expect(ficha.appointmentId).toBe(turno.id);
    expect(ficha.clientId).toBe(client.id);
    expect(ficha.lines).toHaveLength(1);
    expect(ficha.lines[0].serviceId).toBe(seed.serviceId);
    expect(ficha.lines[0].professionalId).toBe(seed.professionalId);

    // The ficha card on Inicio says which turno it belongs to.
    const card = page.getByTestId("dashboard-service-record-card").filter({ hasText: clientName });
    await expect(card.getByTestId("dashboard-service-record-appointment-tag")).toContainText("Appointment");

    // «Ir a la ficha» opens it again.
    await row.getByTestId("dashboard-appointment-ficha-go").click();
    await expect(page.getByRole("dialog").getByTestId("service-record-appointment")).toBeVisible();
  });

  test("Inicio: asignar una ficha abierta de la misma clienta (y solo esa) al turno confirmado", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E TF Asignar ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    const other = await seedClient(request, admin, `E2E TF Otra ${Date.now()}`);
    const turno = await seedTurno(request, admin, seed, client.id);
    await setStatus(request, admin, turno.id, "CONFIRMED");
    const mine = await openFicha(request, admin, client.id, seed);
    await openFicha(request, admin, other.id, seed);

    await loginAsDemo(page);
    const row = page.getByTestId("dashboard-appointment-row").filter({ hasText: clientName });
    await expect(row).toContainText("Confirmed");
    await row.getByTestId("dashboard-appointment-ficha-create-or-assign").click();
    const modal = page.getByTestId("appointment-ficha-modal");
    await expect(modal.getByTestId("appointment-ficha-candidate")).toHaveCount(1);
    await modal.getByTestId("appointment-ficha-candidate").click();
    await expect(page.getByRole("dialog").getByTestId("service-record-appointment")).toBeVisible();

    const appt = await getAppt(request, admin, turno.id);
    expect(appt.status).toBe("IN_PROGRESS");
    expect(appt.serviceRecordId).toBe(mine.id);
  });

  test("la ficha muestra su turno y «Ver turno» abre el detalle en la Agenda", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E TF Ver ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    const turno = await seedTurno(request, admin, seed, client.id);
    await apiPostJson(request, admin, `/api/appointments/${turno.id}/service-record`, {});

    await loginAsDemo(page);
    const card = page.getByTestId("dashboard-service-record-card").filter({ hasText: clientName });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.click({ position: { x: 40, y: 20 } });
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("service-record-view-appointment").click();
    await expect(page).toHaveURL(/\/app\/calendar/);
    await expect(page.getByTestId("calendar-appointment-ficha-go")).toBeVisible({ timeout: 20_000 });
  });

  test("cobrar la ficha completa la ficha y el turno", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, admin);
    await ensureActiveFiscalStampForInvoices(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E TF Cobrar ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    const turno = await seedTurno(request, admin, seed, client.id);
    const ficha = await openFicha(request, admin, client.id, seed);
    await apiPostJson(request, admin, `/api/appointments/${turno.id}/service-record/assign`, { serviceRecordId: ficha.id });
    expect((await getAppt(request, admin, turno.id)).status).toBe("IN_PROGRESS");

    await chargeFicha(request, admin, client.id, ficha, seed);
    const appt = await getAppt(request, admin, turno.id);
    expect(appt.status).toBe("COMPLETED");
    expect((await apiGetJson<Ficha>(request, admin, `/api/service-records/${ficha.id}`)).status).toBe("CLOSED");

    await loginAsDemo(page);
    const row = page.getByTestId("dashboard-appointment-row").filter({ hasText: clientName }).first();
    await expect(row).toContainText("Completed");
    await expect(row.getByTestId("dashboard-appointment-ficha-go")).toBeVisible();
  });

  test("Agenda: «Cobrar» de un turno En curso sin ficha crea la ficha y abre Facturación con ella", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E TF Agenda ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    const turno = await seedTurno(request, admin, seed, client.id);
    await setStatus(request, admin, turno.id, "CONFIRMED");
    await setStatus(request, admin, turno.id, "IN_PROGRESS");

    await loginAsDemo(page);
    await page.getByTestId("dashboard-appointment-row").filter({ hasText: clientName }).locator("button").first().click();
    await expect(page).toHaveURL(/\/app\/calendar/);
    await page.getByTestId("calendar-next-step").click();
    await expect(page).toHaveURL(/\/app\/billing/);
    await expect(page.locator("#billing-client-search")).toHaveValue(new RegExp(clientName, "i"));
    const appt = await getAppt(request, admin, turno.id);
    expect(appt.serviceRecordId).not.toBeNull();
  });

  test("cancelar el turno suelta la ficha abierta (queda abierta, sin turno)", async ({ request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const client = await seedClient(request, admin, `E2E TF Cancel ${Date.now()}`);
    const turno = await seedTurno(request, admin, seed, client.id);
    const created = await apiPostJson<Ficha>(request, admin, `/api/appointments/${turno.id}/service-record`, {});
    expect(created.appointmentId).toBe(turno.id);

    await setStatus(request, admin, turno.id, "CANCELLED");
    const ficha = await apiGetJson<Ficha>(request, admin, `/api/service-records/${created.id}`);
    expect(ficha.status).toBe("OPEN");
    expect(ficha.appointmentId).toBeNull();
    expect((await getAppt(request, admin, turno.id)).serviceRecordId).toBeNull();
  });

  test("API: una sola ficha por turno, solo fichas abiertas, de la misma clienta y sin turno", async ({ request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const client = await seedClient(request, admin, `E2E TF Reglas ${Date.now()}`);
    const other = await seedClient(request, admin, `E2E TF Reglas2 ${Date.now()}`);
    const turno = await seedTurno(request, admin, seed, client.id);
    const post = (path: string, data: unknown) =>
      request.post(`${API_BASE}${path}`, { headers: authHeaders(admin), data });

    const otherFicha = await openFicha(request, admin, other.id, seed);
    const mismatch = await post(`/api/appointments/${turno.id}/service-record/assign`, { serviceRecordId: otherFicha.id });
    expect(mismatch.status()).toBe(409);
    expect(await mismatch.text()).toContain("SERVICE_RECORD_CLIENT_MISMATCH");

    expect((await post(`/api/appointments/${turno.id}/service-record`, {})).status()).toBe(201);
    const again = await post(`/api/appointments/${turno.id}/service-record`, {});
    expect(again.status()).toBe(409);
    expect(await again.text()).toContain("APPOINTMENT_ALREADY_HAS_SERVICE_RECORD");

    const second = await seedTurno(request, admin, await seedCategoryServiceProfessional(request, admin), client.id);
    const mine = await openFicha(request, admin, client.id, seed);
    expect((await post(`/api/appointments/${second.id}/service-record/assign`, { serviceRecordId: mine.id })).status()).toBe(200);
    const third = await seedTurno(request, admin, await seedCategoryServiceProfessional(request, admin), client.id);
    const taken = await post(`/api/appointments/${third.id}/service-record/assign`, { serviceRecordId: mine.id });
    expect(taken.status()).toBe(409);
    expect(await taken.text()).toContain("SERVICE_RECORD_ALREADY_LINKED");
  });

  test("API: una profesional opera la ficha de su turno, sin montos, y no la de otra", async ({ request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const pro = await professionalWithAccess(request, admin, `E2E TF Prof ${Date.now()}`);
    const token = await proToken(request, pro.email);
    const client = await seedClient(request, admin, `E2E TF ProCli ${Date.now()}`);

    // A turno of the logged-in professional herself.
    const slot = new Date();
    slot.setHours(Math.min(23, slot.getHours() + 1), 0, 0, 0);
    const own = await createAppointmentApi(request, admin, {
      clientId: client.id,
      professionalId: pro.id,
      serviceId: seed.serviceId,
      startAt: slot.toISOString(),
    });
    const created = await request.post(`${API_BASE}/api/appointments/${own.id}/service-record`, {
      headers: authHeaders(token),
      data: {},
    });
    expect(created.status(), await created.text()).toBe(201);
    const body = (await created.json()) as { totalAmount: unknown; lines: { unitPrice: unknown }[] };
    expect(body.totalAmount).toBeNull();
    expect(body.lines.every((l) => l.unitPrice === null)).toBe(true);

    // Someone else's turno: forbidden.
    const foreign = await seedTurno(request, admin, seed, client.id);
    const denied = await request.post(`${API_BASE}/api/appointments/${foreign.id}/service-record`, {
      headers: authHeaders(token),
      data: {},
    });
    expect(denied.status()).toBe(403);
  });
});
