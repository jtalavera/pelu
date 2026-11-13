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
  soonTodaySlot,
  type SeededSalon,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { filterAgendaByProfessional } from "../fixtures/ui";
import { PASSWORD, professionalWithAccess } from "../fixtures/commissions";
import { ensureCashSessionOpen, fillPaymentAmount, goToBillingHome } from "../fixtures/billing";
import { revealAppointmentRow, revealFichaCard } from "../fixtures/dashboard";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

/**
 * Circuito turno ↔ ficha de servicio.
 *  - En el Inicio, un turno sin ficha ofrece «Crear o asignar ficha»; con ficha, «Ir a la ficha».
 *  - Crear o asignar pasa el turno a En curso; la ficha muestra a qué turno pertenece.
 *  - Cobrar la ficha completa ficha y turno; cancelar el turno suelta la ficha abierta.
 *  - Un turno tiene una sola ficha, pero una ficha puede pertenecer a varios turnos; una profesional
 *    solo opera sus turnos.
 */
test.describe.configure({ mode: "serial" });

type Appt = { id: number; status: string; serviceRecordId: number | null; invoiceId: number | null };
type Ficha = {
  id: number;
  status: string;
  appointmentId: number | null;
  appointments?: { id: number; startAt: string }[];
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
  const slot = soonTodaySlot();
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
    await page.goto("/app/hoy");
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
    await page.goto("/app/hoy");
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

  test("la ficha muestra su turno y «Ver turno» abre el detalle en el lugar, sin ir al Calendario", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E TF Ver ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    const turno = await seedTurno(request, admin, seed, client.id);
    await apiPostJson(request, admin, `/api/appointments/${turno.id}/service-record`, {});

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    const card = page.getByTestId("dashboard-service-record-card").filter({ hasText: clientName });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.click({ position: { x: 40, y: 20 } });
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("service-record-more").click();
    await page.getByTestId("service-record-view-appointment").click();
    // The turno's detail opens on top of the ficha, right here: no trip to the Calendar.
    await expect(page.getByTestId("calendar-appointment-ficha-go")).toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/app\/calendar/);
    await expect(page.getByTestId("service-record-more")).toBeVisible();
  });

  test("desde el detalle del turno, abrir la ficha y «Ver turno» vuelve a ese mismo turno", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E TF Vuelta ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    const turno = await seedTurno(request, admin, seed, client.id);
    await apiPostJson(request, admin, `/api/appointments/${turno.id}/service-record`, {});

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    // The turno's detail opens from the client's name (the first button of the row).
    await page.getByTestId("dashboard-appointment-row").filter({ hasText: clientName }).locator("button").first().click();
    const detail = page.getByRole("dialog").last();
    await detail.getByTestId("calendar-appointment-ficha-go").click();
    await page.getByTestId("service-record-more").click();
    await page.getByTestId("service-record-view-appointment").click();

    // The ficha closes and the turno's detail (already open underneath) is what is left.
    await expect(page.getByTestId("service-record-more")).toHaveCount(0);
    await expect(page.getByTestId("calendar-appointment-ficha-go")).toBeVisible();
    await expect(page).not.toHaveURL(/\/app\/calendar/);
  });

  test("Agenda: un turno completado sigue en la agenda, «Completado» sin comprobante y «Cobrado» con comprobante", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, admin);
    await ensureActiveFiscalStampForInvoices(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);

    // A: completed by hand, never charged.
    const clientA = await seedClient(request, admin, `E2E TF AgA ${Date.now()}`);
    const turnoA = await seedTurno(request, admin, seed, clientA.id);
    await setStatus(request, admin, turnoA.id, "COMPLETED");
    expect((await getAppt(request, admin, turnoA.id)).invoiceId).toBeNull();

    // B: charged through its ficha (comprobante issued). Another professional: same slot as A.
    const seedB = await seedCategoryServiceProfessional(request, admin);
    const clientB = await seedClient(request, admin, `E2E TF AgB ${Date.now()}`);
    const turnoB = await seedTurno(request, admin, seedB, clientB.id);
    const fichaB = await openFicha(request, admin, clientB.id, seedB);
    await apiPostJson(request, admin, `/api/appointments/${turnoB.id}/service-record/assign`, { serviceRecordId: fichaB.id });
    await chargeFicha(request, admin, clientB.id, fichaB, seedB);
    expect((await getAppt(request, admin, turnoB.id)).invoiceId).not.toBeNull();

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    // Day list: both stay, each with its mark.
    const doneA = page.getByTestId(`calendar-done-badge-${turnoA.id}`);
    const doneB = page.getByTestId(`calendar-done-badge-${turnoB.id}`);
    await expect(doneA).toHaveText("✓ Completed", { timeout: 20_000 });
    await expect(doneA).toHaveAttribute("data-charged", "false");
    await expect(doneB).toHaveText("✓ Charged");
    await expect(doneB).toHaveAttribute("data-charged", "true");

    // Tapping it opens the same detail, with the comprobante button in its footer (opens in place).
    await page.getByTestId(`calendar-appt-${turnoB.id}`).click();
    await expect(page.getByTestId("appointment-view-invoice")).toBeVisible();
    await expect(page.getByTestId("calendar-next-step")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Week grid: outlined block with the same mark.
    await page.goto("/app/calendar?view=week");
    // One professional at a time: other tests' turnos of the same hour would otherwise fold into «+N».
    await filterAgendaByProfessional(page, new RegExp(seedB.professionalFullName));
    const blockB = page.getByTestId(`calendar-appt-${turnoB.id}`);
    await expect(blockB).toHaveAttribute("data-done", "charged", { timeout: 20_000 });
    await expect(blockB.getByTestId(`calendar-done-badge-${turnoB.id}`)).toHaveAttribute("aria-label", "Charged");
    // No legend: each icon explains itself on hover.
    await expect(page.getByTestId("calendar-week-legend")).toHaveCount(0);
    await expect(blockB.getByTestId(`calendar-done-badge-${turnoB.id}`)).toHaveAttribute("title", "Charged");
    // Clean card, not filled: the block background is the page surface, not the professional's colour.
    const bg = await blockB.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgb(255, 255, 255)");
    // A (another professional): completed, not charged.
    await filterAgendaByProfessional(page, new RegExp(seed.professionalFullName));
    await expect(page.getByTestId(`calendar-appt-${turnoA.id}`)).toHaveAttribute("data-done", "completed");
    await expect(page.getByTestId(`calendar-done-badge-${turnoA.id}`)).toHaveAttribute("aria-label", "Completed");

  });

  test("Ficha: el turno y el comprobante van en una sola línea discreta, sin caja", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, admin);
    await ensureActiveFiscalStampForInvoices(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E TF Linea ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    const turno = await seedTurno(request, admin, seed, client.id);
    const ficha = await openFicha(request, admin, client.id, seed);
    await apiPostJson(request, admin, `/api/appointments/${turno.id}/service-record/assign`, { serviceRecordId: ficha.id });
    await chargeFicha(request, admin, client.id, ficha, seed);

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    // The charged ficha waits in the folded «Cobradas y anuladas»: open it (and page) until it shows.
    const card = await revealFichaCard(page, new RegExp(clientName, "i"));
    await card.click({ position: { x: 40, y: 20 } });
    const dialog = page.getByRole("dialog");
    const line = dialog.getByTestId("service-record-meta");
    await expect(line).toBeVisible({ timeout: 20_000 });
    await expect(line.getByTestId("service-record-appointment")).toBeVisible();
    await expect(line.getByTestId("service-record-invoice-line")).toBeVisible();
    // One small line: short, small text, no framed box.
    const box = await line.boundingBox();
    expect(box!.height).toBeLessThan(28);
    expect(await line.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(13);
    expect(await line.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
    // Both links stay reachable.
    await expect(line.getByTestId("service-record-view-appointment")).toBeVisible();
    await expect(line.getByTestId("service-record-view-invoice")).toBeVisible();
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
    await page.goto("/app/hoy");
    // Charged: the turno waits in the folded «Cobrados».
    const row = await revealAppointmentRow(page, (rows) => rows.filter({ hasText: clientName }));
    await expect(row).toContainText("Completed");
    await expect(row.getByTestId("dashboard-appointment-ficha-go")).toBeVisible();
  });

  test("Inicio: «Cobrar» de un turno En curso sin ficha crea la ficha y abre Facturación con ella", async ({
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
    await page.goto("/app/hoy");
    await page.getByTestId("dashboard-appointment-row").filter({ hasText: clientName }).locator("button").first().click();
    // The turno opens in place on Inicio (no navigation to the Agenda).
    await expect(page).toHaveURL(/\/app\/?$/);
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
    await page.goto("/app/hoy");
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
    await page.goto("/app/hoy");
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

  test("turno de clienta ocasional: «Crear ficha» (sin asignar) la crea bajo el cliente genérico, lo pasa a En curso y al cobrar se factura como consumidor final", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, admin);
    await ensureActiveFiscalStampForInvoices(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const slot = soonTodaySlot();
    const turno = await createAppointmentApi(request, admin, {
      clientId: null,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: slot.toISOString(),
    });

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    const row = page
      .getByTestId("dashboard-appointment-row")
      .filter({ hasText: seed.professionalFullName })
      .filter({ hasText: "Occasional" });
    // Same circuit as a registered client, but one click: nothing to assign, no direct «Cobrar».
    const create = row.getByTestId("dashboard-appointment-ficha-create-or-assign");
    await expect(create).toHaveText("Create service record", { timeout: 20_000 });
    await expect(row.getByTestId("dashboard-appointment-charge")).toHaveCount(0);
    await create.click();
    await expect(page.getByTestId("appointment-ficha-modal")).toHaveCount(0);

    await expect.poll(async () => (await getAppt(request, admin, turno.id)).serviceRecordId).not.toBeNull();
    const started = await getAppt(request, admin, turno.id);
    expect(started.status).toBe("IN_PROGRESS");
    await expect(row.getByTestId("dashboard-appointment-ficha-go")).toBeVisible({ timeout: 20_000 });

    // The ficha belongs to the tenant's generic client, which never shows in the client list.
    const ficha = await apiGetJson<Ficha>(request, admin, `/api/service-records/${started.serviceRecordId}`);
    expect(ficha.appointmentId).toBe(turno.id);
    const clients = await apiGetJson<unknown>(request, admin, "/api/clients?q=OCASIONAL");
    expect(JSON.stringify(clients)).not.toContain("CLIENTE OCASIONAL");

    // Nothing to assign for an occasional turno: the candidates list stays empty.
    const candidates = await apiGetJson<unknown[]>(request, admin, `/api/appointments/${turno.id}/service-record/candidates`);
    expect(candidates).toHaveLength(0);

    // Charging the ficha completes the turno; the generic client is not the invoice's recipient.
    await chargeFicha(request, admin, ficha.clientId, ficha, seed);
    const charged = await getAppt(request, admin, turno.id);
    expect(charged.status).toBe("COMPLETED");
    expect(charged.invoiceId).not.toBeNull();
    const invoice = await apiGetJson<{ clientId: number | null; clientDisplayName: string }>(
      request,
      admin,
      `/api/invoices/${charged.invoiceId}`,
    );
    expect(invoice.clientId).toBeNull();
    expect(invoice.clientDisplayName).toBe("CONSUMIDOR FINAL");

    // Inicio: the occasional turno only offers «Ir a la ficha» (no «Ver comprobante» on the row);
    // the comprobante is reached from the charged ficha.
    await page.goto("/app/hoy");
    const paidRow = await revealAppointmentRow(page, (rows) =>
      rows.filter({ hasText: seed.professionalFullName }).filter({ hasText: "Occasional" }),
    );
    await expect(paidRow.getByTestId("dashboard-appointment-ficha-go")).toBeVisible({ timeout: 20_000 });
    await expect(paidRow.getByTestId("dashboard-appointment-invoice")).toHaveCount(0);
    await paidRow.getByTestId("dashboard-appointment-ficha-go").click();
    await page.getByTestId("service-record-view-invoice").click();
    // The comprobante opens on top of the ficha: no trip to Facturación.
    await expect(page.getByTestId("invoice-detail-view")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/app\/?$/);
    // Closing it leaves the ficha open underneath.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("invoice-detail-view")).toHaveCount(0);
    await expect(page.getByTestId("service-record-view-invoice")).toBeVisible();
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
    await page.goto("/app/hoy");
    const chargedRow = await revealAppointmentRow(page, (rows) => rows.filter({ hasText: clientName }));
    await chargedRow.locator("button").first().click({ timeout: 20_000 });
    // The turno opens in place on Inicio (no navigation to the Agenda).
    await expect(page).toHaveURL(/\/app\/?$/);
    // Charged: no «Cobrar» nor next step; the comprobante is a footer button next to «Ficha».
    const invoiceBtn = page.getByTestId("appointment-view-invoice");
    await expect(invoiceBtn).toBeVisible();
    await expect(invoiceBtn).toHaveText("Invoice");
    await expect(page.getByTestId("calendar-next-step")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Charge", exact: true })).toHaveCount(0);
    await invoiceBtn.click();
    // «Ver comprobante» opens the comprobante on top of the turno: no trip to Facturación.
    await expect(page.getByTestId("invoice-detail-view")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/app\/?$/);
    // Closing it leaves the turno's detail open underneath.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("invoice-detail-view")).toHaveCount(0);
    await expect(page.getByTestId("appointment-view-invoice")).toBeVisible();
  });

  test("Inicio: un turno cobrado sin ficha ofrece «Ver comprobante» en su fila y lo abre ahí mismo, sin ir a Facturación", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, admin);
    await ensureActiveFiscalStampForInvoices(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E TF Sin Ficha ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    const turno = await seedTurno(request, admin, seed, client.id);
    // Charged from Facturación without a ficha: the comprobante is tied to the turno directly.
    await apiPostJson(request, admin, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: null,
      clientRucOverride: null,
      discountType: null,
      discountValue: null,
      lines: [{ serviceId: seed.serviceId, description: "E2E sin ficha", quantity: 1, unitPrice: 50_000, discountType: null, discountValue: null }],
      payments: [{ method: "CASH", amount: 50_000 }],
      serviceRecordId: null,
      tipsAmount: 0,
      appointmentId: turno.id,
    });
    const charged = await getAppt(request, admin, turno.id);
    expect(charged.status).toBe("COMPLETED");
    expect(charged.invoiceId).not.toBeNull();
    expect(charged.serviceRecordId).toBeNull();

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    const row = await revealAppointmentRow(page, (rows) => rows.filter({ hasText: clientName }));
    // No ficha to go to: the row's only link is the comprobante (and there is no «Cobrar»).
    await expect(row.getByTestId("dashboard-appointment-invoice")).toHaveText("View invoice", { timeout: 20_000 });
    await expect(row.getByTestId("dashboard-appointment-charge")).toHaveCount(0);
    await row.getByTestId("dashboard-appointment-invoice").click();
    await expect(page.getByTestId("invoice-detail-view")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/app\/?$/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("invoice-detail-view")).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  test("detalle del turno: «Cerrar» a la izquierda y ficha y comprobante en el pie (web); dentro de «Más acciones» (celular)", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, admin);
    await ensureActiveFiscalStampForInvoices(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const clientName = `E2E TF Pie ${Date.now()}`;
    const client = await seedClient(request, admin, clientName);
    const turno = await seedTurno(request, admin, seed, client.id);
    const ficha = await openFicha(request, admin, client.id, seed);
    await apiPostJson(request, admin, `/api/appointments/${turno.id}/service-record/assign`, { serviceRecordId: ficha.id });
    await chargeFicha(request, admin, client.id, ficha, seed);

    await loginAsDemo(page);
    await page.goto("/app/hoy");
    const row = await revealAppointmentRow(page, (rows) => rows.filter({ hasText: new RegExp(clientName, "i") }));
    await row.locator("button").first().click({ timeout: 20_000 });
    const dialog = page.getByRole("dialog");

    // Web: the footer reads Cerrar · Ficha · Comprobante · ⋯, left to right, one row.
    const foot = {
      close: dialog.getByRole("button", { name: "Close" }).last(),
      ficha: dialog.getByTestId("calendar-appointment-ficha-go"),
      invoice: dialog.getByTestId("appointment-view-invoice"),
      more: dialog.getByTestId("calendar-more-actions"),
    };
    const box = async (l: typeof foot.close) => (await l.boundingBox())!;
    const [c, f, i, m] = [await box(foot.close), await box(foot.ficha), await box(foot.invoice), await box(foot.more)];
    expect(c.x).toBeLessThan(f.x);
    expect(f.x).toBeLessThan(i.x);
    expect(i.x).toBeLessThan(m.x);
    expect(new Set([c, f, i, m].map((b) => Math.round(b.y))).size).toBe(1);
    // The status moved to the header.
    await expect(dialog.getByRole("heading", { level: 2 })).toContainText("Completed");
    await page.keyboard.press("Escape");

    // Phone: the same dialog keeps «Cerrar» and «Más acciones»; ficha and comprobante are menu options.
    await page.setViewportSize({ width: 390, height: 780 });
    await row.locator("button").first().click();
    const phoneDialog = page.getByRole("dialog");
    await expect(phoneDialog.getByTestId("appointment-view-invoice")).toHaveCount(0);
    await expect(phoneDialog.getByTestId("calendar-appointment-ficha-go")).toHaveCount(0);
    await phoneDialog.getByTestId("calendar-more-actions").click();
    const menu = page.getByTestId("calendar-actions-panel");
    await expect(menu.getByTestId("calendar-action-ficha")).toBeVisible();
    await expect(menu.getByTestId("calendar-action-invoice")).toBeVisible();
    await menu.getByTestId("calendar-action-invoice").click();
    await expect(page.getByTestId("invoice-detail-view")).toBeVisible({ timeout: 20_000 });
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
    await page.goto("/app/hoy");
    await page
      .getByTestId("dashboard-appointment-row")
      .filter({ hasText: clientName })
      .locator("button")
      .first()
      .click({ timeout: 20_000 });
    // The turno opens in place on Inicio (no navigation to the Agenda).
    await expect(page).toHaveURL(/\/app\/?$/);
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

  test("API: una sola ficha por turno (pero una ficha admite varios turnos), solo fichas abiertas y de la misma clienta", async ({ request }) => {
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
    // A ficha that already has a turno can serve another one.
    const third = await seedTurno(request, admin, await seedCategoryServiceProfessional(request, admin), client.id);
    expect((await post(`/api/appointments/${third.id}/service-record/assign`, { serviceRecordId: mine.id })).status()).toBe(200);
    const shared = await apiGetJson<Ficha>(request, admin, `/api/service-records/${mine.id}`);
    expect((shared.appointments ?? []).map((a) => a.id).sort()).toEqual([second.id, third.id].sort());
    expect((await getAppt(request, admin, second.id)).serviceRecordId).toBe(mine.id);
    expect((await getAppt(request, admin, third.id)).serviceRecordId).toBe(mine.id);
    // …but a turno that has a ficha cannot take another one.
    const other2 = await openFicha(request, admin, client.id, seed);
    const second2 = await post(`/api/appointments/${third.id}/service-record/assign`, { serviceRecordId: other2.id });
    expect(second2.status()).toBe(409);
    expect(await second2.text()).toContain("APPOINTMENT_ALREADY_HAS_SERVICE_RECORD");
  });

  test("Una ficha con varios turnos: cobrarla completa todos sus turnos y los marca cobrados", async ({ request }) => {
    const admin = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, admin);
    await ensureActiveFiscalStampForInvoices(request, admin);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const client = await seedClient(request, admin, `E2E TF Varios ${Date.now()}`);
    const first = await seedTurno(request, admin, seed, client.id);
    const second = await seedTurno(request, admin, await seedCategoryServiceProfessional(request, admin), client.id);
    const ficha = await openFicha(request, admin, client.id, seed);
    const post = (path: string, data: unknown) =>
      request.post(`${API_BASE}${path}`, { headers: authHeaders(admin), data });
    expect((await post(`/api/appointments/${first.id}/service-record/assign`, { serviceRecordId: ficha.id })).status()).toBe(200);
    expect((await post(`/api/appointments/${second.id}/service-record/assign`, { serviceRecordId: ficha.id })).status()).toBe(200);
    expect((await getAppt(request, admin, first.id)).status).toBe("IN_PROGRESS");
    expect((await getAppt(request, admin, second.id)).status).toBe("IN_PROGRESS");

    await chargeFicha(request, admin, client.id, ficha, seed);

    const a = await getAppt(request, admin, first.id);
    const b = await getAppt(request, admin, second.id);
    expect(a.status).toBe("COMPLETED");
    expect(b.status).toBe("COMPLETED");
    // Both turnos show the same comprobante ("Cobrado"), so the Agenda offers no «Cobrar» on either.
    expect(a.invoiceId).not.toBeNull();
    expect(b.invoiceId).toBe(a.invoiceId);
    expect((await apiGetJson<Ficha>(request, admin, `/api/service-records/${ficha.id}`)).status).toBe("CLOSED");
  });

  test("API: una profesional opera la ficha de su turno, sin montos, y no la de otra", async ({ request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const pro = await professionalWithAccess(request, admin, `E2E TF Prof ${Date.now()}`);
    const token = await proToken(request, pro.email);
    const client = await seedClient(request, admin, `E2E TF ProCli ${Date.now()}`);

    // A turno of the logged-in professional herself.
    const slot = soonTodaySlot();
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
