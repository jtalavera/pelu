import { expect, test, type APIRequestContext } from "@playwright/test";
import { API_BASE, apiPostJson, authHeaders, createAppointmentApi, seedClient } from "../fixtures/api";
import { issueInvoice, loginAdminUi, provisionCommissionWorld, type CommissionWorld } from "../fixtures/commissions";

/**
 * HU-77 · «Resumen»: la pantalla de inicio del administrador muestra cómo va el salón hoy en cuatro
 * tarjetas (turnos, caja, fichas y facturas) y «Reportes» es la pantalla de gráficos. Mundo propio
 * por test (tenant nuevo, caja abierta con 50.000, comisiones deshabilitadas).
 */
let w: CommissionWorld;

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "Resumen", { commissionsEnabled: false });
});

async function addFicha(request: APIRequestContext, clientName: string, unitPrice: number) {
  const client = await seedClient(request, w.adminToken, clientName);
  const record = await apiPostJson<{ id: number }>(request, w.adminToken, "/api/service-records", {
    clientId: client.id,
    lines: [{ serviceId: w.service.id, professionalId: w.ana.id, quantity: 1, unitPrice }],
    tips: [],
  });
  return { client, record };
}

test("AC1 · el menú del administrador abre en «Resumen»; «Hoy» y «Reportes» son pantallas aparte", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAdminUi(page, w);
  const nav = page.getByRole("complementary", { name: "Main navigation" });
  await expect(page).toHaveURL(/\/app\/?$/);
  await expect(page.getByTestId("resumen-title")).toHaveText("Hello, team!");
  const overview = nav.getByRole("link", { name: "Overview", exact: true });
  const today = nav.getByRole("link", { name: "Today", exact: true });
  await expect(overview).toBeVisible();
  await expect(today).toBeVisible();
  // «Overview» is the first item of the menu, «Today» comes right after it.
  const [o, t] = await Promise.all([overview.boundingBox(), today.boundingBox()]);
  expect(t!.y).toBeGreaterThan(o!.y);

  await today.click();
  await expect(page).toHaveURL(/\/app\/hoy$/);
  await expect(page.getByTestId("dashboard-today-records")).toBeVisible({ timeout: 30_000 });

  await nav.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboards$/);
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Summary", exact: true })).toHaveCount(0);
});

test("AC2 · las cuatro tarjetas llegan juntas (con un esqueleto mientras cargan)", async ({ page }) => {
  test.setTimeout(60_000);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/service-records?*", async (route) => {
    await gate;
    await route.continue();
  });
  await loginAdminUi(page, w);
  await expect(page.getByTestId("resumen-loading")).toBeVisible();
  await page.waitForTimeout(1200);
  // Nothing of the page shows before the slowest answer arrives.
  await expect(page.getByTestId("resumen-appointments")).toHaveCount(0);
  release();
  for (const id of ["resumen-appointments", "resumen-cash", "resumen-fichas", "resumen-invoices"]) {
    await expect(page.getByTestId(id)).toBeVisible({ timeout: 20_000 });
  }
  await expect(page.getByTestId("resumen-loading")).toHaveCount(0);
});

test("AC3 · «Turnos de hoy» cuenta los turnos y lista los próximos", async ({ page, request }) => {
  test.setTimeout(90_000);
  const clientName = `Resumen Turno ${Date.now()}`;
  const client = await seedClient(request, w.adminToken, clientName);
  const slot = new Date(Date.now() + 5 * 60_000);
  slot.setSeconds(0, 0);
  await createAppointmentApi(request, w.adminToken, {
    clientId: client.id,
    professionalId: w.ana.id,
    serviceId: w.service.id,
    startAt: slot.toISOString(),
  });
  await loginAdminUi(page, w);
  await expect(page.getByTestId("resumen-appointments-total")).toHaveText("1", { timeout: 20_000 });
  await expect(page.getByTestId("resumen-appointments-pending")).toHaveText("1 pending");
  await expect(page.getByTestId("resumen-appointments-confirmed")).toHaveText("0 confirmed");
  const row = page.getByTestId("resumen-appointment").filter({ hasText: new RegExp(clientName, "i") });
  await expect(row).toBeVisible();
  await expect(row).toContainText(w.service.name, { ignoreCase: true });
  await page.getByTestId("resumen-view-agenda").click();
  await expect(page).toHaveURL(/\/app\/calendar/);
});

test("AC4 · «Caja del día» suma lo cobrado por forma de pago; cerrada, lo dice y lleva a Caja", async ({ page, request }) => {
  test.setTimeout(90_000);
  await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id }]);
  await loginAdminUi(page, w);
  const total = page.getByTestId("resumen-cash-total");
  await expect(total).toContainText("110.000", { timeout: 20_000 });
  await expect(page.getByTestId("resumen-cash-cash")).toContainText("110.000");
  await expect(page.getByTestId("resumen-cash-card")).toContainText("0");
  await expect(page.getByTestId("resumen-cash-transfer")).toContainText("0");
  await expect(page.getByTestId("resumen-view-cash")).toContainText("Open since");

  const close = await request.post(`${API_BASE}/api/cash-sessions/close`, {
    headers: authHeaders(w.adminToken),
    data: { countedCashAmount: 160_000 },
  });
  expect(close.ok(), await close.text()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("resumen-cash-closed")).toHaveText("Cash register closed", { timeout: 20_000 });
  await expect(page.getByTestId("resumen-cash-total")).toHaveCount(0);
  await page.getByTestId("resumen-view-cash").click();
  await expect(page).toHaveURL(/\/app\/billing/);
});

test("AC5 · «Fichas de hoy» muestra lo que falta cobrar y «Cobrar» abre la factura con esa ficha", async ({ page, request }) => {
  test.setTimeout(90_000);
  const nameA = `Resumen Ficha A ${Date.now()}`;
  const nameB = `Resumen Ficha B ${Date.now()}`;
  await addFicha(request, nameA, 50_000);
  await addFicha(request, nameB, 30_000);
  await loginAdminUi(page, w);

  await expect(page.getByTestId("resumen-fichas-to-collect")).toContainText("80.000", { timeout: 20_000 });
  await expect(page.getByTestId("resumen-fichas-open-count")).toHaveText("2 open records");
  const legend = page.getByTestId("resumen-fichas-legend");
  await expect(legend).toContainText("2 open");
  await expect(legend).toContainText("0 paid");
  await expect(legend).toContainText("0 voided");
  await expect(page.getByTestId("resumen-fichas-bar")).toBeVisible();

  // The oldest open ficha comes first, with its service, professional and how long ago it was opened.
  const rows = page.getByTestId("resumen-ficha");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(nameA, { ignoreCase: true });
  await expect(rows.first()).toContainText(w.service.name, { ignoreCase: true });
  await expect(rows.first()).toContainText(w.ana.name, { ignoreCase: true });
  await expect(rows.first()).toContainText(/ago|just now/);

  const collect = rows.first().getByRole("button", { name: new RegExp(`Collect the record of ${nameA}`, "i") });
  const box = (await collect.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await collect.click();
  await expect(page).toHaveURL(/\/app\/billing/);
  await expect(page.getByText(new RegExp(nameA, "i")).first()).toBeVisible({ timeout: 20_000 });

  await page.goto("/app");
  await page.getByTestId("resumen-fichas-view-all").click();
  await expect(page).toHaveURL(/\/app\/service-records/);
});

test("AC6 · «Factura electrónica» cuenta los comprobantes emitidos hoy", async ({ page, request }) => {
  test.setTimeout(90_000);
  for (let i = 0; i < 2; i++) {
    await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id }]);
  }
  await loginAdminUi(page, w);
  await expect(page.getByTestId("resumen-invoices-total")).toHaveText("2", { timeout: 20_000 });
  await expect(page.getByTestId("resumen-invoices").getByRole("heading")).toHaveText(/Electronic invoices|Invoices/);
  await page.getByTestId("resumen-view-invoices").click();
  await expect(page).toHaveURL(/\/app\/billing/);
});

test("AC7 · «+ Nuevo turno» abre el formulario y «+ Nueva factura» lleva a una factura nueva", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAdminUi(page, w);
  await page.getByTestId("resumen-new-appointment").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByTestId("resumen-new-invoice").click();
  await expect(page).toHaveURL(/\/app\/billing/);
  await expect(page.getByLabel("Search or select client")).toBeVisible({ timeout: 20_000 });
});

test("AC8 · en el celular las tarjetas van una debajo de otra y no hay desplazamiento horizontal", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 800 });
  await loginAdminUi(page, w);
  const ids = ["resumen-appointments", "resumen-cash", "resumen-fichas", "resumen-invoices"];
  for (const id of ids) await expect(page.getByTestId(id)).toBeVisible({ timeout: 20_000 });
  const boxes = await Promise.all(ids.map(async (id) => (await page.getByTestId(id).boundingBox())!));
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
  expect(Math.abs(boxes[0].x - boxes[3].x)).toBeLessThan(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("AC9 · con la interfaz en español todo el Resumen está en español (incluida la alerta fiscal que manda el servidor)", async ({ page }) => {
  test.setTimeout(60_000);
  // The server's alert carries a code and an English fallback: the page must show the translation.
  await page.route("**/api/dashboard", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.fiscalAlerts = [
      {
        severity: "warning",
        messageKey: "sifenVoidingPending",
        message: "You have document-number voidings pending submission to SIFEN.",
      },
    ];
    await route.fulfill({ response: res, json: body });
  });
  await loginAdminUi(page, w);
  // Switch the language from the interface, like a user would.
  await page.locator("[data-tour='topbar-lang']").filter({ visible: true }).first().getByRole("button", { name: /^es$/i }).click();

  await expect(page.getByTestId("resumen-title")).toHaveText("¡Hola, equipo!", { timeout: 20_000 });
  await expect(page.getByTestId("resumen-subtitle")).toContainText("Así va tu salón hoy");
  await expect(page.getByTestId("resumen-new-appointment")).toHaveText("+ Nuevo turno");
  await expect(page.getByTestId("resumen-new-invoice")).toHaveText("+ Nueva factura");
  await expect(page.getByTestId("resumen-page").getByRole("heading", { level: 2 })).toHaveText([
    "Turnos de hoy",
    "Caja del día",
    "Fichas de hoy",
    /Factura electrónica|Comprobantes/,
  ]);
  const alert = page.getByTestId("resumen-fiscal-alert");
  await expect(alert).toContainText("Tenés inutilizaciones de numeración pendientes de reportar a SIFEN");
  await expect(alert).not.toContainText("You have document-number");
  // No English left in the cards (the salon's own names are not translated).
  await expect(page.getByTestId("resumen-page")).not.toContainText(/\b(Hello|pending|confirmed|Collect|All up to date|Open agenda|See all)\b/);
});

test("AC10 · «Caja del día»: si la caja se abrió antes de hoy se muestra la fecha, no solo la hora", async ({ page }) => {
  test.setTimeout(60_000);
  // Today's register: only the time.
  await loginAdminUi(page, w);
  await expect(page.getByTestId("resumen-view-cash")).toHaveText(/^Open since \d{1,2}:\d{2} · Open cash →$/, { timeout: 20_000 });

  // The same register, seen as opened two days ago: the date comes with the time.
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3_600_000).toISOString();
  const sessionDetail = /\/api\/cash-sessions\/\d+$/;
  await page.route(sessionDetail, async (route) => {
    try {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, openedAt: twoDaysAgo } });
    } catch {
      // The page was closed while the (polling) request was in flight.
    }
  });
  await page.reload();
  await expect(page.getByTestId("resumen-view-cash")).toHaveText(/^Open since .*\d{4}.* at \d{1,2}:\d{2} · Open cash →$/, {
    timeout: 20_000,
  });
  await page.unroute(sessionDetail);
});
