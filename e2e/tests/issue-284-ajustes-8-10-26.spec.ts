import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

import {
  API_BASE,
  apiBaseUrl,
  apiGetJson,
  apiPostJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  listFiscalStamps,
  loginAsDemoApi,
  loginPlatformAdminApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { DEMO_EMAIL, loginAs, loginAsDemo, loginAsPlatformAdmin } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { pdfContainsText, pickServiceLine } from "../fixtures/invoice";

// Issue #284 "Ajustes 8-10-26". Ajuste 1 (la categoría del producto viaja a Stock) necesita un
// control-stock real: vive en tests/stock/issue-284-categoria-del-producto-en-stock.spec.ts y en
// las pruebas unitarias (StockPayloadsTest, ServiceCatalogServiceTest).
test.describe.configure({ mode: "serial" });

const DEMO_TENANT_ID = 1;

// ── helpers ──────────────────────────────────────────────────────────────────────────────────

type DashboardTrend = {
  revenueTrend: Array<{ date: string; invoiced: string | number }>;
  revenueTrendLookback: Array<{ date: string; invoiced: string | number }>;
};

async function seedInvoiceOnDay(
  request: APIRequestContext,
  token: string,
  seed: { serviceId: number; serviceFullName: string },
  client: { id: number; fullName: string },
  amount: number,
  daysAgo: number,
): Promise<void> {
  const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
    clientId: client.id,
    clientDisplayName: client.fullName,
    clientRucOverride: null,
    clientIdentityDocumentOverride: null,
    lines: [
      { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: amount },
    ],
    payments: [{ method: "CASH", amount }],
  });
  const res = await request.post(
    `${API_BASE}/api/admin/sifen-test-support/invoices/${inv.id}/backdate-issued-at/${daysAgo * 24 + 2}`,
    { headers: authHeaders(token) },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function openNewInvoiceForm(page: Page) {
  await ensureCashSessionOpen(page);
  await page.getByRole("tab", { name: "Cash Register" }).click();
  await page.getByRole("button", { name: "New Invoice" }).click();
}

function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// ── 2 · gráfico de facturación: los días sin facturación se ven y suman al promedio ──────────

test.describe("Issue #284 · ajuste 2 · días sin facturación en el gráfico", () => {
  test("cada día con facturación 0 tiene su marca en el gráfico y baja el promedio de 7 días", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E284 Zero ${Date.now()}`);
    // Invoices on only two days of the last 30: the rest are days WITHOUT invoicing.
    await seedInvoiceOnDay(request, token, seed, { id: client.id, fullName: "E2E284" }, 120_000, 3);
    await seedInvoiceOnDay(request, token, seed, { id: client.id, fullName: "E2E284" }, 90_000, 12);

    const dashboard = await apiGetJson<DashboardTrend>(request, token, "/api/dashboard");
    const zeroDates = dashboard.revenueTrend
      .filter((p) => Number(p.invoiced) === 0)
      .map((p) => p.date);
    expect(zeroDates.length).toBeGreaterThan(0); // e.g. today and the days around the seeded ones

    await loginAsDemo(page);
    await page.goto("/app/dashboards");
    const chart = page.getByTestId("dashboard-revenue-trend");
    await expect(chart).toBeVisible({ timeout: 20_000 });

    // One visible marker per day with no invoicing, on exactly those days.
    const markers = chart.getByTestId("dashboard-revenue-trend-zero-day");
    await expect(markers).toHaveCount(zeroDates.length);
    const markerDates = await markers.evaluateAll((els) => els.map((e) => e.getAttribute("data-date")));
    expect([...markerDates].sort()).toEqual([...zeroDates].sort());
    await expect(chart.locator(".recharts-legend-wrapper").getByText("No invoicing", { exact: true })).toBeVisible();

    // The zero days count in the 7-day average: the end dot equals the mean of the last 7 days
    // of the series INCLUDING its zeros.
    const series = dashboard.revenueTrend.map((p) => Number(p.invoiced));
    const last7 = series.slice(-7);
    const expectedAverage = last7.reduce((a, b) => a + b, 0) / 7;
    await expect(chart.getByTestId("dashboard-revenue-trend-end-dot")).toContainText(
      `Gs. ${groupThousands(expectedAverage)}`,
    );
  });
});

// ── 3 · método de pago vacío en "Nuevo comprobante" ──────────────────────────────────────────

test.describe("Issue #284 · ajuste 3 · método de pago vacío", () => {
  test("el método de pago arranca vacío y no se puede emitir hasta elegirlo", async ({ page, request }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await openNewInvoiceForm(page);
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("Metodo vacio");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("10000");
    await expect(page.locator("#line-price-0")).toHaveValue("10.000");

    // Empty by default (placeholder), with the rule shown and the submit button disabled.
    const method = page.locator("#pay-method-0");
    await expect(method).toHaveValue("");
    await expect(method.locator("option:checked")).toHaveText("Select a payment method");
    await expect(page.locator("#pay-method-err-0")).toHaveText("Select a payment method.");
    await expect(method).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: "Issue invoice" })).toBeDisabled();

    // Choosing one clears the error and enables the button.
    await method.selectOption("CASH");
    await expect(page.locator("#pay-method-err-0")).toHaveCount(0);
    await expect(method).toHaveAttribute("aria-invalid", "false");
    await expect(page.getByRole("button", { name: "Issue invoice" })).toBeEnabled();

    // A newly added payment row also starts empty; its amount is not enough to issue.
    await page.getByRole("button", { name: "Add payment method" }).click();
    await expect(page.locator("#pay-method-1")).toHaveValue("");
    await page.locator("#pay-amount-0").fill("4000");
    await page.locator("#pay-amount-1").fill("6000");
    await expect(page.locator("#pay-method-err-1")).toHaveText("Select a payment method.");
    await page.locator("#pay-method-1").selectOption("TRANSFER");
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(page.getByText(/issued successfully/i)).toBeVisible();
  });
});

// ── 4 · solapa de "Descargar reporte" con fondo ──────────────────────────────────────────────

test.describe("Issue #284 · ajuste 4 · fondo del menú de Descargar reporte", () => {
  test("el menú del botón Descargar reporte tiene un fondo de color opaco", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.getByTestId("invoice-history-report-button").click();

    const menu = page.getByTestId("invoice-history-report-menu");
    await expect(menu).toBeVisible();
    const background = await menu.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Not transparent: a solid colour, i.e. rgb(...) or rgba(..., 1).
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
    expect(background).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    await expect(menu.getByTestId("invoice-history-report-xlsx")).toBeVisible();
    await expect(menu.getByTestId("invoice-history-report-pdf")).toBeVisible();
  });
});

// ── 5 · número completo del comprobante en el reporte exportado ──────────────────────────────

test.describe("Issue #284 · ajuste 5 · número completo en el reporte", () => {
  test("el Excel y el PDF exportan el número del KuDE: establecimiento-punto-número", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const clientName = `E2E284 REPORTE ${Date.now()}`;
    const client = await seedClient(request, token, clientName);
    const inv = await apiPostJson<{ id: number; invoiceNumberFormatted: string }>(
      request,
      token,
      "/api/invoices",
      {
        clientId: client.id,
        clientDisplayName: clientName,
        lines: [
          { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 30000 },
        ],
        payments: [{ method: "CASH", amount: 30000 }],
      },
    );
    const stamp = (await listFiscalStamps(request, token)).find((s) => s.active)!;
    const pad3 = (n: number) => String(n).padStart(3, "0");
    // Same shape the KuDE prints: 001-001-0000007.
    const expected = `${pad3(stamp.establishment)}-${pad3(stamp.expeditionPoint)}-${inv.invoiceNumberFormatted}`;
    expect(expected).toMatch(/^\d{3}-\d{3}-\d{7}$/);

    const q = `q=${encodeURIComponent(clientName)}`;
    const xlsxRes = await request.get(`${apiBaseUrl()}/api/invoices/report?format=xlsx&${q}`, {
      headers: authHeaders(token),
    });
    expect(xlsxRes.ok(), await xlsxRes.text()).toBeTruthy();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xlsxRes.body()));
    const sheet = wb.worksheets[0];
    const numbers: string[] = [];
    sheet.eachRow((row, i) => {
      if (i > 3) numbers.push(String(row.getCell(1).value));
    });
    expect(numbers).toEqual([expected]);

    const pdfRes = await request.get(`${apiBaseUrl()}/api/invoices/report?format=pdf&${q}`, {
      headers: authHeaders(token),
    });
    expect(pdfRes.ok(), await pdfRes.text()).toBeTruthy();
    expect(pdfContainsText(Buffer.from(await pdfRes.body()), expected)).toBeTruthy();

    // …and the same through the "Descargar reporte" menu in the browser.
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.getByTestId("invoice-history-report-button").click();
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("invoice-history-report-xlsx").click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/^COMPROBANTES-.*\.xlsx$/);
  });
});

// ── 6 · títulos de los gráficos (el texto en español se verifica en src/i18n/chartTitles.test.ts) ──────────────────────────────────────────────────────────────

test.describe("Issue #284 · ajuste 6 · títulos de los gráficos", () => {
  test("los gráficos se llaman «Facturación», «Medios de pago» y «Servicios más facturados»", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/dashboards");
    await expect(page.getByTestId("dashboard-revenue-trend")).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText("Invoicing", { exact: true })).toBeVisible();
    await expect(page.getByText("Payment methods", { exact: true })).toBeVisible();
    await expect(page.getByText("Most invoiced services", { exact: true })).toBeVisible();
    // The old titles are gone.
    await expect(page.getByText("Revenue trend", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Payment method mix", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Top services", { exact: true })).toHaveCount(0);
  });
});

// ── 7 · auditoría: quién hizo qué ────────────────────────────────────────────────────────────

type AuditRow = {
  tenantId: number | null;
  tenantName: string | null;
  userEmail: string | null;
  userRole: string | null;
  httpMethod: string;
  resource: string;
  operation: string | null;
  entityId: string | null;
  statusCode: number;
  createdAt: string;
};
type AuditPage = { content: AuditRow[]; totalElements: number };

test.describe("Issue #284 · ajuste 7 · auditoría", () => {
  test("lo que hace el administrador queda registrado y se ve en Configuración → Auditoría", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    const name = `E2E284 Audit ${Date.now()}`;
    const secretEmail = `secret-${Date.now()}@audit-body.test`;
    await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: name,
      phone: null,
      email: secretEmail,
      ruc: null,
    });

    // API: the row says who (email + role), what (POST clients) and which record (the id).
    const audit = await apiGetJson<AuditPage>(request, token, `/api/audit?resource=clients&size=50`);
    // Newest first: the client created just now is the first row. (A creation has no id in its
    // URL, so its "record" is empty; edits/actions on an existing record carry that id.)
    const mine = audit.content[0];
    expect(mine, JSON.stringify(audit.content.slice(0, 3))).toBeTruthy();
    expect(Date.now() - Date.parse(mine.createdAt)).toBeLessThan(60_000);
    expect(mine).toMatchObject({
      tenantId: DEMO_TENANT_ID,
      userEmail: DEMO_EMAIL,
      userRole: "ADMIN",
      httpMethod: "POST",
      resource: "clients",
      operation: null,
      entityId: null,
      statusCode: 200,
    });
    // Never the request body: the client's e-mail/name sent in the POST is nowhere in the trail.
    expect(JSON.stringify(audit)).not.toContain(secretEmail);
    expect(JSON.stringify(audit)).not.toContain(name);

    // Reads and logins are not audited.
    const all = await apiGetJson<AuditPage>(request, token, `/api/audit?size=100`);
    expect(all.content.every((r) => r.httpMethod !== "GET")).toBeTruthy();
    expect(all.content.some((r) => r.resource === "auth")).toBeFalsy();
    // Newest first.
    const times = all.content.map((r) => Date.parse(r.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    // UI: Configuración → Auditoría shows it as a sentence, filterable by user and "what".
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    await page.getByRole("link", { name: "Audit" }).click();
    await expect(page).toHaveURL(/\/app\/settings\/audit$/);
    await expect(page.getByTestId("audit-table")).toBeVisible({ timeout: 20_000 });

    await page.locator("#audit-user").fill(DEMO_EMAIL);
    await page.locator("#audit-resource").selectOption("clients");
    await page.getByRole("button", { name: "Search" }).click();
    const rows = page.getByTestId("audit-row");
    await expect(rows.first()).toBeVisible();
    await expect(rows.first().getByTestId("audit-row-user")).toHaveText(DEMO_EMAIL);
    await expect(rows.first().getByTestId("audit-row-action")).toHaveText("Created client");
    await expect(rows.first()).toContainText("Administrator");
    for (const r of await rows.all()) {
      await expect(r).toHaveAttribute("data-resource", "clients");
    }

    // A user that matches nothing → empty state; clearing brings the list back.
    await page.locator("#audit-user").fill("nadie@nowhere.test");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByTestId("audit-empty")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId("audit-table")).toBeVisible();
  });

  test("un cambio de estado de un comprobante se registra con su acción propia (anular)", async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E284 Void ${Date.now()}`);
    const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: "E2E284 Void",
      lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 20000 }],
      payments: [{ method: "CASH", amount: 20000 }],
    });
    await apiPostJson(request, token, `/api/invoices/${inv.id}/void`, { voidReason: "E2E284" });

    const audit = await apiGetJson<AuditPage>(request, token, `/api/audit?resource=invoices&size=50`);
    expect(audit.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource: "invoices", operation: "void", entityId: String(inv.id), httpMethod: "POST" }),
        expect.objectContaining({ resource: "invoices", operation: null, entityId: null, httpMethod: "POST" }),
      ]),
    );
  });

  test("el profesional no puede ver la auditoría; filtros inválidos se rechazan", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const email = `audit-pro-${Date.now()}@test.com`;
    const prof = await apiPostJson<{ id: number }>(request, token, "/api/professionals", {
      fullName: `E2E284 Pro ${Date.now()}`,
      email,
    });
    const grant = await apiPostJson<{ rawToken: string }>(request, token, `/api/professionals/${prof.id}/grant-access`, {});
    const activate = await request.post(`${API_BASE}/api/auth/activate`, {
      data: { token: grant.rawToken, password: "ValidPass1!", confirmPassword: "ValidPass1!" },
    });
    expect(activate.ok(), await activate.text()).toBeTruthy();
    const login = await request.post(`${API_BASE}/api/auth/login`, { data: { email, password: "ValidPass1!" } });
    const proToken = ((await login.json()) as { accessToken: string }).accessToken;

    const denied = await request.get(`${API_BASE}/api/audit`, { headers: authHeaders(proToken) });
    expect(denied.status()).toBe(403);
    const anonymous = await request.get(`${API_BASE}/api/audit`);
    expect([401, 403]).toContain(anonymous.status());
    // The salon admin cannot reach the platform-wide trail either.
    const platformDenied = await request.get(`${API_BASE}/api/platform/audit`, { headers: authHeaders(token) });
    expect([401, 403]).toContain(platformDenied.status());

    const bad = await request.get(`${API_BASE}/api/audit?from=2026-10-09&to=2026-10-01`, {
      headers: authHeaders(token),
    });
    expect(bad.status()).toBe(400);
    expect(await bad.text()).toContain("INVALID_DATE_RANGE");
  });

  test("el usuario root ve la auditoría de todos los negocios y sus propias acciones", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const tenantToken = await loginAsDemoApi(request);
    await apiPostJson(request, tenantToken, "/api/clients", {
      fullName: `E2E284 Root ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });
    const rootToken = await loginPlatformAdminApi(request);
    // A root action: it has no tenant.
    const tierName = `E2E284 Tier ${Date.now()}`;
    await apiPostJson(request, rootToken, "/api/platform/tiers", { name: tierName });

    const all = await apiGetJson<AuditPage>(request, rootToken, "/api/platform/audit?size=100");
    expect(all.content.some((r) => r.tenantId === DEMO_TENANT_ID && r.resource === "clients")).toBeTruthy();
    const rootRow = all.content.find((r) => r.userRole === "PLATFORM_ADMIN" && r.resource === "tiers");
    expect(rootRow).toMatchObject({ tenantId: null, tenantName: null, httpMethod: "POST" });

    const onlyDemo = await apiGetJson<AuditPage>(
      request,
      rootToken,
      `/api/platform/audit?tenantId=${DEMO_TENANT_ID}&size=100`,
    );
    expect(onlyDemo.content.length).toBeGreaterThan(0);
    expect(onlyDemo.content.every((r) => r.tenantId === DEMO_TENANT_ID)).toBeTruthy();

    // UI: Plataforma → Auditoría, with the business of each row.
    await loginAsPlatformAdmin(page);
    await page.getByRole("link", { name: "Audit" }).click();
    await expect(page).toHaveURL(/\/platform\/audit$/);
    await expect(page.getByTestId("platform-audit")).toBeVisible();
    await expect(page.getByTestId("audit-table")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("columnheader", { name: "Business" })).toBeVisible();
    await page.locator("#audit-user").fill("platform-admin");
    await page.getByRole("button", { name: "Search" }).click();
    const first = page.getByTestId("audit-row").first();
    await expect(first.getByTestId("audit-row-user")).toContainText("platform-admin");
    await expect(first).toContainText("Platform");
    await expect(first).toContainText("Root user");
  });

  test("un usuario de otro rol no ve la pestaña Auditoría en Configuración", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const email = `audit-tab-${Date.now()}@test.com`;
    const prof = await apiPostJson<{ id: number }>(request, token, "/api/professionals", {
      fullName: `E2E284 Tab ${Date.now()}`,
      email,
    });
    const grant = await apiPostJson<{ rawToken: string }>(request, token, `/api/professionals/${prof.id}/grant-access`, {});
    await request.post(`${API_BASE}/api/auth/activate`, {
      data: { token: grant.rawToken, password: "ValidPass1!", confirmPassword: "ValidPass1!" },
    });
    await loginAs(page, email, "ValidPass1!");
    await page.goto("/app/settings/taxes");
    await expect(page.getByRole("link", { name: "Audit" })).toHaveCount(0);
  });
});
