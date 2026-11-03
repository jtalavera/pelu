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
import { ensureCashSessionOpen, fillPaymentAmount, goToBillingHome } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

/**
 * Circuito turno ↔ ficha de servicio.
 *  - En el Inicio, un turno sin ficha ofrece «Crear o asignar ficha»; con ficha, «Ir a la ficha».
 *  - Crear o asignar pasa el turno a En curso; la ficha muestra a qué turno pertenece.
 *  - Cobrar la ficha completa ficha y turno; cancelar el turno suelta la ficha abierta.
 *  - Un turno tiene una sola ficha; una profesional solo opera sus turnos.
 */
test.describe.configure({ mode: "serial" });

type Appt = { id: number; status: string; serviceRecordId: number | null; invoiceId: number | null };
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
  // A few minutes from now (still today), so the turno shows up in Inicio's list at any hour.
  const slot = new Date(Date.now() + 5 * 60_000);
  slot.setSeconds(0, 0);
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
    // The turno keeps the comprobante it was charged with.
    expect(appt.invoiceId).not.toBeNull();
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

  test("Facturación sin ficha: se ofrece completar el turno de hoy de la clienta y se completa al cobrar", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const client = await seedClient(request, admin, `E2E TF Mostrador ${Date.now()}`);
    const turno = await seedTurno(request, admin, seed, client.id);
    const keep = await seedTurno(request, admin, await seedCategoryServiceProfessional(request, admin), client.id);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await goToBillingHome(page);
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 12));
    await page.getByRole("button", { name: client.fullName }).click();

    const notice = page.getByTestId("billing-open-turno-notice");
    await expect(notice).toBeVisible();
    await expect(page.getByTestId("billing-open-turno-complete")).toBeChecked();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("50000");
    await fillPaymentAmount(page, "50000");
    await clickIssueInvoiceAndExpectSuccess(page);

    await expect.poll(async () => (await getAppt(request, admin, turno.id)).status).toBe("COMPLETED");
    expect((await getAppt(request, admin, turno.id)).invoiceId).not.toBeNull();
    // Only the earliest turno was offered: the other one is untouched.
    expect((await getAppt(request, admin, keep.id)).status).toBe("PENDING");
  });

  test("Facturación sin ficha: si se destilda la casilla, el turno no se toca", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const client = await seedClient(request, admin, `E2E TF Mostrador2 ${Date.now()}`);
    const turno = await seedTurno(request, admin, seed, client.id);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await goToBillingHome(page);
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 12));
    await page.getByRole("button", { name: client.fullName }).click();
    await page.getByTestId("billing-open-turno-complete").uncheck();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("50000");
    await fillPaymentAmount(page, "50000");
    await clickIssueInvoiceAndExpectSuccess(page);

    expect((await getAppt(request, admin, turno.id)).status).toBe("PENDING");
  });

  test("asignar una ficha agrega el servicio del turno si no lo tiene, o pasa la línea a la profesional del turno si ya lo tiene", async ({
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const other = await seedCategoryServiceProfessional(request, admin);
    const svc2 = await apiPostJson<{ id: number }>(request, admin, "/api/services", {
      name: `E2E TF Otro ${Date.now()}`,
      categoryId: seed.categoryId,
      priceMinor: 30_000,
      durationMinutes: 30,
    });
    const client = await seedClient(request, admin, `E2E TF Servicio ${Date.now()}`);

    // 1) The ficha has a different service: the turno's service is added, the existing line is untouched.
    const turnoA = await seedTurno(request, admin, seed, client.id);
    const fichaA = await apiPostJson<Ficha>(request, admin, "/api/service-records", {
      clientId: client.id,
      lines: [{ serviceId: svc2.id, professionalId: other.professionalId, quantity: 2, unitPrice: 30_000 }],
      tips: [],
    });
    await apiPostJson(request, admin, `/api/appointments/${turnoA.id}/service-record/assign`, { serviceRecordId: fichaA.id });
    const a = await apiGetJson<Ficha>(request, admin, `/api/service-records/${fichaA.id}`);
    expect(a.lines).toHaveLength(2);
    const kept = a.lines.find((l) => l.serviceId === svc2.id)!;
    expect(kept.quantity).toBe(2);
    expect(kept.professionalId).toBe(other.professionalId);
    const added = a.lines.find((l) => l.serviceId === seed.serviceId)!;
    expect(added.quantity).toBe(1);
    expect(added.professionalId).toBe(seed.professionalId);

    // 2) The ficha already has the turno's service (under another professional): no duplicate, now hers.
    const turnoB = await seedTurno(request, admin, other, client.id);
    const fichaB = await apiPostJson<Ficha>(request, admin, "/api/service-records", {
      clientId: client.id,
      lines: [{ serviceId: other.serviceId, professionalId: seed.professionalId, quantity: 3, unitPrice: 50_000 }],
      tips: [],
    });
    await apiPostJson(request, admin, `/api/appointments/${turnoB.id}/service-record/assign`, { serviceRecordId: fichaB.id });
    const b = await apiGetJson<Ficha>(request, admin, `/api/service-records/${fichaB.id}`);
    expect(b.lines).toHaveLength(1);
    expect(b.lines[0].serviceId).toBe(other.serviceId);
    expect(b.lines[0].quantity).toBe(3);
    expect(b.lines[0].professionalId).toBe(other.professionalId);
  });

  test("turno de clienta ocasional (sin cliente): la fila ofrece «Cobrar», sin ficha, y el turno se completa al cobrar", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const slot = new Date();
    slot.setTime(Date.now() + 5 * 60_000);
    slot.setSeconds(0, 0);
    const turno = await createAppointmentApi(request, admin, {
      clientId: null,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: slot.toISOString(),
    });

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.goto("/app");
    const row = page
      .getByTestId("dashboard-appointment-row")
      .filter({ hasText: seed.professionalFullName })
      .filter({ hasText: "Occasional" });
    await expect(row.getByTestId("dashboard-appointment-charge")).toBeVisible({ timeout: 20_000 });
    // No registered client: no ficha to create or assign.
    await expect(row.getByTestId("dashboard-appointment-ficha-create-or-assign")).toHaveCount(0);
    await row.getByTestId("dashboard-appointment-charge").click();

    await expect(page).toHaveURL(/\/app\/billing/);
    await page.locator("#line-price-0").fill("50000");
    await fillPaymentAmount(page, "50000");
    await clickIssueInvoiceAndExpectSuccess(page);

    await expect.poll(async () => (await getAppt(request, admin, turno.id)).status).toBe("COMPLETED");
    expect((await getAppt(request, admin, turno.id)).invoiceId).not.toBeNull();
  });

  test("un turno ya cobrado no vuelve a ofrecer «Cobrar»: muestra «Ver comprobante» y abre la factura", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, admin);
    await ensureActiveFiscalStampForInvoices(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E TF Cobrado ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    const turno = await seedTurno(request, admin, seed, client.id);
    const ficha = await apiPostJson<Ficha>(request, admin, `/api/appointments/${turno.id}/service-record`, {});
    await chargeFicha(request, admin, client.id, ficha, seed);
    const charged = await getAppt(request, admin, turno.id);
    expect(charged.status).toBe("COMPLETED");
    expect(charged.invoiceId).not.toBeNull();

    // A completed turno is not on the week grid: it is opened from the Inicio's list.
    await loginAsDemo(page);
    await page
      .getByTestId("dashboard-appointment-row")
      .filter({ hasText: clientName })
      .locator("button")
      .first()
      .click({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/app\/calendar/);
    const next = page.getByTestId("calendar-next-step");
    await expect(next).toHaveText("View invoice");
    await expect(page.getByRole("button", { name: "Charge", exact: true })).toHaveCount(0);
    await next.click();
    await expect(page).toHaveURL(/\/app\/billing/);
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
  });

  test("un turno pasado a «Atendido» sin comprobante sigue ofreciendo «Cobrar»", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E TF Atendido ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    const turno = await seedTurno(request, admin, seed, client.id);
    await setStatus(request, admin, turno.id, "COMPLETED");
    expect((await getAppt(request, admin, turno.id)).invoiceId).toBeNull();

    // A completed turno is not on the week grid: it is opened from the Inicio's list.
    await loginAsDemo(page);
    await page
      .getByTestId("dashboard-appointment-row")
      .filter({ hasText: clientName })
      .locator("button")
      .first()
      .click({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/app\/calendar/);
    await expect(page.getByTestId("calendar-next-step")).toHaveText("Charge");
  });

  test("API: un turno ya cobrado no admite un segundo comprobante", async ({ request }) => {
    const admin = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, admin);
    await ensureActiveFiscalStampForInvoices(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const client = await seedClient(request, admin, `E2E TF Doble ${Date.now()}`);
    const turno = await seedTurno(request, admin, seed, client.id);
    const body = (appointmentId: number) => ({
      clientId: client.id,
      clientDisplayName: null,
      clientRucOverride: null,
      discountType: null,
      discountValue: null,
      lines: [{ serviceId: seed.serviceId, description: "E2E doble", quantity: 1, unitPrice: 50_000, discountType: null, discountValue: null }],
      payments: [{ method: "CASH", amount: 50_000 }],
      serviceRecordId: null,
      tipsAmount: 0,
      appointmentId,
    });
    await apiPostJson(request, admin, "/api/invoices", body(turno.id));
    const again = await request.post(`${API_BASE}/api/invoices`, { headers: authHeaders(admin), data: body(turno.id) });
    expect(again.status()).toBe(409);
    expect(await again.text()).toContain("APPOINTMENT_ALREADY_INVOICED");
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
    slot.setTime(Date.now() + 5 * 60_000);
    slot.setSeconds(0, 0);
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
