import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  type SeededSalon,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { setControlledInputValue } from "../fixtures/ui";

test.describe.configure({ mode: "serial" });

async function getCurrentSessionApi(
  request: APIRequestContext,
  token: string,
): Promise<{ id: number } | null> {
  const res = await request.get(`${API_BASE}/api/cash-sessions/current`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status() !== 200) return null;
  return res.json() as Promise<{ id: number }>;
}

/** Closes whatever session is currently open (if any), so callers start from a clean slate. */
async function closeCurrentSessionIfOpenApi(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const current = await getCurrentSessionApi(request, token);
  if (!current) return;
  const res = await request.post(`${API_BASE}/api/cash-sessions/close`, {
    headers: authHeaders(token),
    data: { countedCashAmount: 0 },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Opens a brand-new session (closing any existing one first) so movement/expected-cash math starts at zero. */
async function openFreshSessionApi(
  request: APIRequestContext,
  token: string,
  openingCashAmount = 0,
): Promise<{ id: number }> {
  await closeCurrentSessionIfOpenApi(request, token);
  const res = await request.post(`${API_BASE}/api/cash-sessions/open`, {
    headers: authHeaders(token),
    data: { openingCashAmount },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json() as Promise<{ id: number }>;
}

async function seedProfessionalWithClosedTip(
  request: APIRequestContext,
  token: string,
  seed: SeededSalon,
  tipAmount: number,
): Promise<{ id: number; fullName: string }> {
  const suffix = Date.now();
  const professional = await apiPostJson<{ id: number; fullName: string }>(
    request,
    token,
    "/api/professionals",
    { fullName: `E2E Caja Prof ${suffix}`, phone: null, email: null, photoDataUrl: null },
  );
  const client = await seedClient(request, token, `E2E Caja Cliente ${suffix}`);
  const record = await apiPostJson<{ id: number }>(request, token, "/api/service-records", {
    clientId: client.id,
    lines: [
      {
        serviceId: seed.serviceId,
        professionalId: professional.id,
        quantity: 1,
        unitPrice: 45_000,
      },
    ],
    tips: [{ professionalId: professional.id, amount: tipAmount }],
  });
  // Issuing an invoice against the record closes the ficha, so Propinas counts the tip.
  await apiPostJson(request, token, "/api/invoices", {
    clientId: client.id,
    clientDisplayName: null,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [
      {
        serviceId: seed.serviceId,
        description: "E2E service",
        quantity: 1,
        unitPrice: 45_000,
        discountType: null,
        discountValue: null,
      },
    ],
    payments: [{ method: "CASH", amount: 45_000 }],
    serviceRecordId: record.id,
    tipsAmount: tipAmount,
  });
  return professional;
}

test.describe("Issue #259 · Historial de Cajas y Movimientos Manuales", () => {
  let seed: SeededSalon;

  test.beforeAll(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    seed = await seedCategoryServiceProfessional(request, token);
  });

  test("AC3+AC4+AC5 · la vista en vivo muestra movimientos manuales y actualiza el efectivo esperado", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await openFreshSessionApi(request, token, 0);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await expect(page.getByText(/^Cash register is open$/)).toBeVisible({ timeout: 15_000 });

    // AC3: zero cash sales, zero movements -> live expected cash starts at 0.
    await expect(page.getByText("No cash movements recorded yet.")).toBeVisible({
      timeout: 15_000,
    });

    const ingresoReason = `E2E ingreso ${Date.now()}`;
    await page.getByRole("button", { name: "Cash in", exact: true }).click();
    await setControlledInputValue(page.locator("#movement-amount"), "20000");
    await expect(page.locator("#movement-amount")).toHaveValue("20.000");
    await page.locator("#movement-reason").fill(ingresoReason);
    const [ingresoRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/cash-sessions/current/movements") &&
          r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Add movement", exact: true }).click(),
    ]);
    expect(ingresoRes.ok(), await ingresoRes.text()).toBeTruthy();

    // AC4: the movement appears live and expected cash increases by its amount (0 -> 20.000).
    await expect(page.getByText(ingresoReason)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Manual cash in")).toBeVisible();
    await expect(page.getByText("Expected cash (live)")).toBeVisible();
    const expectedCash = page.getByTestId("cash-summary-expected-cash");
    await expect(expectedCash).toHaveText("20.000", { timeout: 15_000 });

    const egresoReason = `E2E egreso ${Date.now()}`;
    await page.getByRole("button", { name: "Cash out", exact: true }).click();
    await setControlledInputValue(page.locator("#movement-amount"), "5000");
    await page.locator("#movement-reason").fill(egresoReason);
    const [egresoRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/cash-sessions/current/movements") &&
          r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Add movement", exact: true }).click(),
    ]);
    expect(egresoRes.ok(), await egresoRes.text()).toBeTruthy();

    // AC5: a cash-out movement decreases the live expected cash (20.000 -> 15.000).
    await expect(page.getByText(egresoReason)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Manual cash out")).toBeVisible();
    await expect(expectedCash).toHaveText("15.000", { timeout: 15_000 });
  });

  test("AC6+AC7 · el formulario de movimiento valida monto y motivo", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await getCurrentSessionApi(request, token).then(async (current) => {
      if (!current) await openFreshSessionApi(request, token, 0);
    });

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await expect(page.getByText(/^Cash register is open$/)).toBeVisible({ timeout: 15_000 });

    // AC6: blank amount is rejected client-side, no request is sent.
    await page.locator("#movement-reason").fill("Motivo válido");
    await page.getByRole("button", { name: "Add movement", exact: true }).click();
    await expect(page.getByText("Enter a valid amount greater than 0.")).toBeVisible();

    // AC7: valid amount but blank reason is rejected too.
    await setControlledInputValue(page.locator("#movement-amount"), "1000");
    await page.locator("#movement-reason").fill("");
    await page.getByRole("button", { name: "Add movement", exact: true }).click();
    await expect(page.getByText("Enter a reason for this movement.")).toBeVisible();
  });

  test("AC8+AC9 · sin caja abierta no se puede registrar un movimiento manual", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await closeCurrentSessionIfOpenApi(request, token);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await expect(page.getByText(/^Cash register is closed$/)).toBeVisible({ timeout: 15_000 });

    // AC8: the manual-movement form isn't rendered when there is no open session.
    await expect(page.getByRole("heading", { name: "Register a cash movement" })).toHaveCount(0);

    // AC9: a direct API call is rejected the same way close-session already is.
    const res = await request.post(`${API_BASE}/api/cash-sessions/current/movements`, {
      headers: authHeaders(token),
      data: { type: "MANUAL_IN", amount: 1000, reason: "x" },
    });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("CASH_SESSION_NOT_OPEN");
  });

  test("AC10+AC11 · un retiro de propina afecta la caja solo si hay una abierta", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);

    // AC10: withdrawing tips while a session is open auto-creates a linked TIP_WITHDRAWAL_OUT movement.
    const session = await openFreshSessionApi(request, token, 0);
    const professional = await seedProfessionalWithClosedTip(request, token, seed, 8_000);
    const withdrawRes = await request.post(`${API_BASE}/api/propinas/withdrawals`, {
      headers: authHeaders(token),
      data: { professionalId: professional.id, amount: 3_000 },
    });
    expect(withdrawRes.ok(), await withdrawRes.text()).toBeTruthy();

    const movementsRes = await request.get(
      `${API_BASE}/api/cash-sessions/${session.id}/movements`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(movementsRes.ok(), await movementsRes.text()).toBeTruthy();
    const movements = (await movementsRes.json()) as Array<{
      type: string;
      amount: number | string;
      tipWithdrawalId: number | null;
    }>;
    const linked = movements.find((m) => m.type === "TIP_WITHDRAWAL_OUT");
    expect(linked).toBeTruthy();
    expect(Number(linked!.amount)).toBe(3_000);
    expect(linked!.tipWithdrawalId).not.toBeNull();

    const detailAfterFirst = await request.get(`${API_BASE}/api/cash-sessions/${session.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const detailJsonAfterFirst = (await detailAfterFirst.json()) as {
      expectedCashAmount: number | string;
    };
    // seedProfessionalWithClosedTip also issues a 45.000 CASH invoice (to close the ficha the tip
    // lives on) against this same open session, so expected cash = 45.000 (sales) - 3.000 (retiro).
    expect(Number(detailJsonAfterFirst.expectedCashAmount)).toBe(42_000);

    // AC11: closing the session, then withdrawing again, must NOT add another movement to it —
    // Propinas itself keeps working unaffected (its own 2xx response is enough evidence of that).
    await closeCurrentSessionIfOpenApi(request, token);
    const secondWithdrawRes = await request.post(`${API_BASE}/api/propinas/withdrawals`, {
      headers: authHeaders(token),
      data: { professionalId: professional.id, amount: 2_000 },
    });
    expect(secondWithdrawRes.ok(), await secondWithdrawRes.text()).toBeTruthy();

    const movementsAfterClose = await request.get(
      `${API_BASE}/api/cash-sessions/${session.id}/movements`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const movementsAfterCloseJson = (await movementsAfterClose.json()) as unknown[];
    expect(movementsAfterCloseJson.length).toBe(movements.length);
  });

  test("AC12+AC13 · el efectivo esperado al cerrar suma ventas y movimientos manuales y resta retiros de propina", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const session = await openFreshSessionApi(request, token, 0);

    // 50.000 en ventas de contado.
    const invoiceRes = await request.post(`${API_BASE}/api/invoices`, {
      headers: authHeaders(token),
      data: {
        clientId: null,
        clientDisplayName: "E2E Caja Cliente",
        clientRucOverride: null,
        discountType: null,
        discountValue: null,
        lines: [{ serviceId: null, description: "E2E item", quantity: 1, unitPrice: 50_000 }],
        payments: [{ method: "CASH", amount: 50_000 }],
      },
    });
    expect(invoiceRes.ok(), await invoiceRes.text()).toBeTruthy();

    // +10.000 ingreso manual, -3.000 egreso manual.
    await request.post(`${API_BASE}/api/cash-sessions/current/movements`, {
      headers: authHeaders(token),
      data: { type: "MANUAL_IN", amount: 10_000, reason: "E2E ingreso regresión" },
    });
    await request.post(`${API_BASE}/api/cash-sessions/current/movements`, {
      headers: authHeaders(token),
      data: { type: "MANUAL_OUT", amount: 3_000, reason: "E2E egreso regresión" },
    });

    // -2.000 retiro de propina vinculado. seedProfessionalWithClosedTip also issues its own
    // 45.000 CASH invoice (to close the ficha the tip lives on) against this same session.
    const professional = await seedProfessionalWithClosedTip(request, token, seed, 6_000);
    await request.post(`${API_BASE}/api/propinas/withdrawals`, {
      headers: authHeaders(token),
      data: { professionalId: professional.id, amount: 2_000 },
    });

    // (50.000 + 45.000) ventas + 10.000 ingreso - 3.000 egreso - 2.000 retiro = 100.000
    const closeRes = await request.post(`${API_BASE}/api/cash-sessions/close`, {
      headers: authHeaders(token),
      data: { countedCashAmount: 100_000 },
    });
    expect(closeRes.ok(), await closeRes.text()).toBeTruthy();
    const closeJson = (await closeRes.json()) as {
      id: number;
      expectedCashAmount: number | string;
      cashDifference: number | string;
      movements: unknown[];
    };
    expect(closeJson.id).toBe(session.id);
    expect(Number(closeJson.expectedCashAmount)).toBe(100_000);
    expect(Number(closeJson.cashDifference)).toBe(0);
    // Two manual movements (ingreso + egreso) plus the auto-linked tip-withdrawal cash-out.
    expect(closeJson.movements.length).toBe(3);
  });

  test("AC1+AC2 · el historial de cajas lista la caja cerrada y su detalle incluye movimientos", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await openFreshSessionApi(request, token, 12_000);
    const reason = `E2E historial ${Date.now()}`;
    await request.post(`${API_BASE}/api/cash-sessions/current/movements`, {
      headers: authHeaders(token),
      data: { type: "MANUAL_IN", amount: 7_000, reason },
    });
    await request.post(`${API_BASE}/api/cash-sessions/close`, {
      headers: authHeaders(token),
      data: { countedCashAmount: 19_000 },
    });

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "Cash Sessions Log" }).click();

    // AC1: the just-closed session is the most recent row (sorted newest-opened-first).
    const table = page.locator("table").filter({ hasText: "Opened at" });
    const firstRow = table.locator("tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 15_000 });
    await expect(firstRow.getByText("7.000")).toBeVisible();

    // AC2: opening it shows the full breakdown, including the manual movement.
    await firstRow.click();
    const dialog = page.getByRole("dialog", { name: "Cash register detail" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(reason)).toBeVisible();
    await expect(dialog.getByText("Manual cash in")).toBeVisible();
    await expect(dialog.getByText("Expected cash (system)")).toBeVisible();
    await expect(dialog.getByText("19.000")).toBeVisible();
  });

  test("AC14 · la paginación del historial de cajas ofrece 10/25/50 filas por página", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "Cash Sessions Log" }).click();
    await expect(page.getByText("Cash register history")).toBeVisible({ timeout: 15_000 });

    const pageSizeSelect = page.getByTestId("cash-history-pagination").getByLabel("Rows per page:");
    await expect(pageSizeSelect.locator("option")).toHaveCount(3);
  });
});
