import { expect, test, type Page } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  type SeededSalon,
} from "../fixtures/api";
import { DEMO_EMAIL, DEMO_PASSWORD, loginAs, loginAsDemo } from "../fixtures/auth";
import { setControlledInputValue } from "../fixtures/ui";

test.describe.configure({ mode: "serial" });

type ServiceRecordSeed = { id: number; status: string };

/** Seeds a second professional (distinct from `seedCategoryServiceProfessional`'s). */
async function seedProfessional(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  fullName: string,
): Promise<{ id: number; fullName: string }> {
  const prof = await apiPostJson<{ id: number }>(request, token, "/api/professionals", {
    fullName,
    phone: null,
    email: null,
    photoDataUrl: null,
  });
  return { id: prof.id, fullName };
}

async function createServiceRecordApi(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  body: {
    clientId: number;
    lines: Array<{ serviceId: number; professionalId: number }>;
    tips?: Array<{ professionalId: number; amount: number }>;
  },
): Promise<ServiceRecordSeed> {
  return apiPostJson<ServiceRecordSeed>(request, token, "/api/service-records", {
    clientId: body.clientId,
    lines: body.lines,
    tips: body.tips ?? [],
  });
}

async function pickLineService(page: Page, idx: number, serviceFullName: string): Promise<void> {
  await page.locator(`#service-record-line-svc-${idx}`).fill(serviceFullName.slice(0, 12));
  await page.getByRole("button", { name: serviceFullName, exact: false }).click();
}

async function pickLineProfessional(page: Page, idx: number, fullName: string): Promise<void> {
  const input = page.locator(`#service-record-line-prof-${idx}`);
  await input.click();
  await input.fill(fullName.slice(0, 10));
  await page
    .locator(`#service-record-line-prof-${idx}-listbox`)
    .getByRole("button", { name: fullName, exact: false })
    .click();
}

/** Opens the History tab and filters by free-text query; returns the matching row. */
async function findHistoryRow(page: Page, query: string) {
  await page.goto("/app/service-records");
  await page.getByRole("tab", { name: "History" }).click();
  await page.locator("#service-record-history-text-filter").fill(query);
  return page.locator("tbody tr").filter({ hasText: query }).first();
}

test.describe("Issue #53 · Ficha de servicio", () => {
  let seed: SeededSalon;
  let secondProfessional: { id: number; fullName: string };
  let secondService: { id: number; fullName: string };

  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    seed = await seedCategoryServiceProfessional(request, token);
    secondProfessional = await seedProfessional(request, token, `E2E Prof2 ${Date.now()}`);
    const secondServiceName = `E2E Svc2 ${Date.now()}`;
    const svc = await apiPostJson<{ id: number }>(request, token, "/api/services", {
      name: secondServiceName,
      categoryId: seed.categoryId,
      priceMinor: 30000,
      durationMinutes: 30,
    });
    secondService = { id: svc.id, fullName: secondServiceName };
  });

  test("AC1+AC3+AC9 · crear ficha con varios servicios, profesionales distintos y propinas; editar mientras está abierta", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E Ficha ${Date.now()}`);

    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await expect(page.getByRole("tab", { name: "New record", exact: true })).toBeVisible();

    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 6));
    await page.getByRole("button", { name: client.fullName }).click();

    await pickLineService(page, 0, seed.serviceFullName);
    await pickLineProfessional(page, 0, seed.professionalFullName);

    await page.getByRole("button", { name: "Add service" }).click();
    await pickLineService(page, 1, secondService.fullName);
    await pickLineProfessional(page, 1, secondProfessional.fullName);

    // Total = sum of both service prices (50.000 + 30.000), dot-separator, no decimals.
    await expect(page.getByText(/^80\.000$/)).toBeVisible();

    // Tips section shows one row per distinct professional on the lines.
    const tipInput1 = page.locator(`#service-record-tip-${seed.professionalId}`);
    const tipInput2 = page.locator(`#service-record-tip-${secondProfessional.id}`);
    await setControlledInputValue(tipInput1, "5000");
    await expect(tipInput1).toHaveValue("5.000");
    await setControlledInputValue(tipInput2, "3000");
    await expect(tipInput2).toHaveValue("3.000");

    await page.getByRole("button", { name: "Save record" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Service record created." })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("service-record-status")).toHaveText("Open");

    // AC3: still open → editable. Add a third line and save again.
    await page.getByRole("button", { name: "Add service" }).click();
    await pickLineService(page, 2, seed.serviceFullName);
    await pickLineProfessional(page, 2, seed.professionalFullName);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Changes saved." })).toBeVisible({ timeout: 15_000 });
    // New total = 80.000 + 50.000 = 130.000
    await expect(page.getByText(/^130\.000$/)).toBeVisible();
  });

  test("AC2 · si el cliente no existe, se puede crear uno nuevo desde la ficha", async ({ page }) => {
    const newClientName = `E2E New Client ${Date.now()}`;

    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await page.getByLabel("Search or select client").fill(newClientName);
    await page.getByRole("button", { name: "+ Create new client" }).click();

    await expect(page).toHaveURL(/\/app\/clients/);
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByLabel("Full name")).toHaveValue(newClientName);
    await dlg.getByRole("button", { name: "Save" }).click();

    // Round trip back into the ficha's "New record" tab with the new client selected.
    await expect(page).toHaveURL(/\/app\/service-records/);
    await expect(page.getByLabel("Search or select client")).toHaveValue(newClientName);

    await pickLineService(page, 0, seed.serviceFullName);
    await pickLineProfessional(page, 0, seed.professionalFullName);
    await page.getByRole("button", { name: "Save record" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Service record created." })).toBeVisible({ timeout: 15_000 });
  });

  test("AC4+AC6 · generar comprobante prellena la factura, cierra la ficha y la vuelve inmutable", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E GenInv ${Date.now()}`);
    const record = await createServiceRecordApi(request, token, {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId }],
      tips: [{ professionalId: seed.professionalId, amount: 4000 }],
    });

    await loginAsDemo(page);
    const row = await findHistoryRow(page, client.fullName);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "View" }).click();

    await expect(page.getByTestId("service-record-status")).toHaveText("Open");
    await page.getByRole("button", { name: "Generate invoice" }).click();

    // Lands on Billing → New Invoice, prefilled with the ficha's client, service and tips.
    await expect(page).toHaveURL(/\/app\/billing/);
    await expect(page.getByRole("heading", { name: "Issue Invoice" })).toBeVisible();
    await expect(page.getByText(client.fullName)).toBeVisible();
    await expect(page.locator("#line-price-0")).toHaveValue("50.000");
    await expect(page.locator("#billing-tips-amount")).toHaveValue("4.000");
    // Payment auto-fills to cover total + tips = 54.000.
    await expect(page.locator("#pay-amount-0")).toHaveValue("54.000");

    const [res] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/invoices") &&
          r.request().method() === "POST" &&
          !r.url().includes("/void"),
      ),
      page.getByRole("button", { name: "Issue invoice" }).click(),
    ]);
    expect(res.ok(), await res.text()).toBeTruthy();
    await expect(page.getByRole("alert").filter({ hasText: "Invoice issued" })).toBeVisible({
      timeout: 15_000,
    });

    // The ficha auto-closed and can no longer be modified.
    const row2 = await findHistoryRow(page, client.fullName);
    await expect(row2).toBeVisible({ timeout: 15_000 });
    await row2.getByRole("button", { name: "View" }).click();
    await expect(page.getByTestId("service-record-status")).toHaveText("Closed");
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Void record" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Generate invoice" })).toHaveCount(0);

    // Backend also rejects a direct modification attempt.
    const putRes = await request.put(`${API_BASE}/api/service-records/${record.id}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: {
        clientId: client.id,
        lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId }],
        tips: [],
      },
    });
    expect(putRes.status()).toBe(409);
    const body = (await putRes.json()) as { error?: string };
    expect(body.error).toBe("SERVICE_RECORD_NOT_OPEN");
  });

  test("AC5 · anular una ficha abierta la vuelve inmutable", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E Void ${Date.now()}`);
    const record = await createServiceRecordApi(request, token, {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId }],
    });

    await loginAsDemo(page);
    const row = await findHistoryRow(page, client.fullName);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "View" }).click();
    await page.getByRole("button", { name: "Void record" }).click();
    await page.getByLabel("Reason").fill("Cliente se retiró antes de comenzar");
    await page.getByRole("button", { name: "Confirm void" }).click();
    await expect(page.getByTestId("service-record-status")).toHaveText("Voided", { timeout: 15_000 });
    await expect(page.getByText(/Cliente se retiró antes de comenzar/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

    const putRes = await request.put(`${API_BASE}/api/service-records/${record.id}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: {
        clientId: client.id,
        lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId }],
        tips: [],
      },
    });
    expect(putRes.status()).toBe(409);
  });

  test("AC7 · el dashboard muestra las fichas de hoy ordenadas de más nueva a más vieja", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const olderClient = await seedClient(request, token, `E2E Older ${Date.now()}`);
    await createServiceRecordApi(request, token, {
      clientId: olderClient.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId }],
    });
    await new Promise((r) => setTimeout(r, 1100));
    const newerClient = await seedClient(request, token, `E2E Newer ${Date.now()}`);
    await createServiceRecordApi(request, token, {
      clientId: newerClient.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId }],
    });

    await loginAsDemo(page);
    await page.goto("/app");
    await expect(page.getByText("Today's service records")).toBeVisible();
    await expect(page.getByText(newerClient.fullName)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(olderClient.fullName)).toBeVisible();

    const cards = page.locator("button", { hasText: /E2E (Newer|Older)/ });
    const firstCardText = await cards.first().innerText();
    expect(firstCardText).toContain(newerClient.fullName);
  });

  test("AC8 · historial de fichas con filtros de búsqueda", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E History ${Date.now()}`);
    await createServiceRecordApi(request, token, {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId }],
    });

    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await page.getByRole("tab", { name: "History" }).click();

    const row = page.locator("tbody tr").filter({ hasText: client.fullName });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Status filter to a non-matching status hides the row.
    await page.getByLabel("Status").selectOption("VOIDED");
    await expect(row).toHaveCount(0);
    await page.getByLabel("Status").selectOption("");
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Rows-per-page selector offers the 10/25/50 convention.
    const pageSizeSelect = page.getByLabel("Rows per page:");
    await expect(pageSizeSelect.locator("option")).toHaveCount(3);
    await pageSizeSelect.selectOption("25");
    await expect(row).toBeVisible({ timeout: 15_000 });
  });

  test("Acceso restringido · el ítem de navegación no aparece para profesionales", async ({ page }) => {
    const adminRes = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    });
    const { accessToken } = (await adminRes.json()) as { accessToken: string };
    const email = `hu53prof${Date.now()}@test.com`;
    const createRes = await fetch(`${API_BASE}/api/professionals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ fullName: `E2E Prof Access ${Date.now()}`, email }),
    });
    const created = (await createRes.json()) as { id: number };
    const grantRes = await fetch(`${API_BASE}/api/professionals/${created.id}/grant-access`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const { rawToken } = (await grantRes.json()) as { rawToken: string };
    const password = "ValidPass1!";
    await fetch(`${API_BASE}/api/auth/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawToken, password, confirmPassword: password }),
    });

    await loginAs(page, email, password);
    await expect(page).toHaveURL(/\/app\/calendar/);
    await expect(page.getByRole("link", { name: "Service records" })).toHaveCount(0);
  });
});
