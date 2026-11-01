import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
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
import {
  clickExportPdf,
  filterPropinasByProfessional,
  openWithdrawDialog,
  expectBalance,
  propinasMovements,
} from "../fixtures/propinas";

test.describe.configure({ mode: "serial" });

type ServiceRecordSeed = { id: number; status: string };

async function seedProfessional(
  request: APIRequestContext,
  token: string,
  fullName: string,
): Promise<{ id: number; fullName: string }> {
  // Names are stored in UPPERCASE (issue #155 AC3) — return what's actually displayed,
  // not the mixed-case string sent above.
  return apiPostJson<{ id: number; fullName: string }>(request, token, "/api/professionals", {
    fullName,
    phone: null,
    email: null,
    photoDataUrl: null,
  });
}

/**
 * Creates an open ficha de servicio with a tip for one professional, then issues an invoice
 * referencing it so the ficha auto-closes — Propinas only reports/accumulates CLOSED-record tips.
 */
async function seedClosedTip(
  request: APIRequestContext,
  token: string,
  params: {
    clientId: number;
    serviceId: number;
    professionalId: number;
    unitPrice: number;
    tipAmount: number;
  },
): Promise<{ recordId: number; invoiceId: number }> {
  const record = await apiPostJson<ServiceRecordSeed>(request, token, "/api/service-records", {
    clientId: params.clientId,
    lines: [
      {
        serviceId: params.serviceId,
        professionalId: params.professionalId,
        quantity: 1,
        unitPrice: params.unitPrice,
      },
    ],
    tips: [{ professionalId: params.professionalId, amount: params.tipAmount }],
  });
  const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
    clientId: params.clientId,
    clientDisplayName: null,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [
      {
        serviceId: params.serviceId,
        description: "E2E service",
        quantity: 1,
        unitPrice: params.unitPrice,
        discountType: null,
        discountValue: null,
      },
    ],
    payments: [{ method: "CASH", amount: params.unitPrice }],
    serviceRecordId: record.id,
    tipsAmount: params.tipAmount,
  });
  return { recordId: record.id, invoiceId: invoice.id };
}

test.describe("Issue #120 · Propinas", () => {
  let seed: SeededSalon;

  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    seed = await seedCategoryServiceProfessional(request, token);
  });

  test("AC1 · el módulo Propinas aparece en Finanzas y navega correctamente", async ({
    page,
  }) => {
    await loginAsDemo(page);
    const sidebar = page.locator('[data-tour="nav-sidebar"]');
    const links = sidebar.getByRole("link");
    const labels = await links.allTextContents();
    // Issue #139: "Service records" (Ficha de servicio) moved to Management, so Tips
    // (Propinas) no longer sits directly below it — it now follows Billing in Finance.
    const billingIdx = labels.findIndex((l) => l.includes("Billing"));
    const propinasIdx = labels.findIndex((l) => l.includes("Tips"));
    expect(billingIdx).toBeGreaterThanOrEqual(0);
    expect(propinasIdx).toBe(billingIdx + 1);

    await links.nth(propinasIdx).click();
    await expect(page).toHaveURL(/\/app\/propinas/);
    // Redesign: one screen, no tabs.
    await expect(page.getByRole("heading", { name: "Tips", exact: true })).toBeVisible();
    await expect(page.getByTestId("propinas-movements")).toBeVisible();
  });

  test("AC2+AC3+AC4+AC9 · el reporte filtra por fecha y profesional, agrupa con subtotal, total general y formato Gs.", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const clientA = await seedClient(request, token, `E2E PropA ${Date.now()}`);
    const clientB = await seedClient(request, token, `E2E PropB ${Date.now()}`);
    const profB = await seedProfessional(request, token, `E2E PropinasB ${Date.now()}`);

    await seedClosedTip(request, token, {
      clientId: clientA.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 50000,
      tipAmount: 5000,
    });
    await seedClosedTip(request, token, {
      clientId: clientB.id,
      serviceId: seed.serviceId,
      professionalId: profB.id,
      unitPrice: 60000,
      tipAmount: 3000,
    });

    await loginAsDemo(page);
    await page.goto("/app/propinas");
    await expect(page.getByTestId("propinas-movements")).toBeVisible();

    // Movements list every tip with client, professional and a Gs. amount (dot separator, no
    // decimals). Narrow to one professional at a time so other specs' tips never leak in.
    await filterPropinasByProfessional(page, seed.professionalFullName);
    const rowA = propinasMovements(page).filter({ hasText: clientA.fullName });
    await expect(rowA).toHaveCount(1, { timeout: 15_000 });
    await expect(rowA).toContainText("Gs. 5.000");
    await expect(rowA).toContainText(seed.professionalFullName);
    await expect(propinasMovements(page).filter({ hasText: clientB.fullName })).toHaveCount(0);

    await filterPropinasByProfessional(page, profB.fullName);
    const rowB = propinasMovements(page).filter({ hasText: clientB.fullName });
    await expect(rowB).toHaveCount(1);
    await expect(rowB).toContainText("Gs. 3.000");
    await expect(propinasMovements(page).filter({ hasText: clientA.fullName })).toHaveCount(0);
    // The period total follows the filter (this professional's tips only).
    await expect(page.getByTestId("propinas-tips-total")).toHaveText("Gs. 3.000");

    // AC2: a future date range (no tips possible yet) yields an empty list.
    const future = new Date();
    future.setDate(future.getDate() + 3);
    const futureYmd = future.toISOString().slice(0, 10);
    await page.locator("#propinas-filter-from").fill(futureYmd);
    await page.locator("#propinas-filter-to").fill(futureYmd);
    await expect(page.getByTestId("propinas-empty")).toBeVisible({ timeout: 15_000 });
  });

  test("AC5 · exportar PDF descarga el archivo del reporte", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E PropPdf ${Date.now()}`);
    await seedClosedTip(request, token, {
      clientId: client.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 40000,
      tipAmount: 4000,
    });

    await loginAsDemo(page);
    await page.goto("/app/propinas");
    await filterPropinasByProfessional(page, seed.professionalFullName);
    await expect(page.getByText(client.fullName)).toBeVisible({ timeout: 15_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      clickExportPdf(page),
    ]);
    expect(download.suggestedFilename()).toMatch(/^PROPINAS-\d{8}-\d{8}\.pdf$/);

    const path = await download.path();
    expect(path).not.toBeNull();
    const fs = await import("fs/promises");
    const buf = await fs.readFile(path!);
    expect(buf.slice(0, 4).toString("latin1")).toBe("%PDF");
  });

  test("AC6+AC7+AC8+AC9+AC10 · retiro de propina valida el saldo, lo descuenta y queda en el historial", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const withdrawalProf = await seedProfessional(request, token, `E2E PropWithdraw ${Date.now()}`);
    const client = await seedClient(request, token, `E2E PropWithdrawClient ${Date.now()}`);
    await seedClosedTip(request, token, {
      clientId: client.id,
      serviceId: seed.serviceId,
      professionalId: withdrawalProf.id,
      unitPrice: 45000,
      tipAmount: 10000,
    });

    await loginAsDemo(page);
    await page.goto("/app/propinas");

    // AC6: accumulated (CLOSED-only) balance for the professional, in the balances card.
    await expectBalance(page, withdrawalProf.id, "Gs. 10.000");
    await openWithdrawDialog(page, withdrawalProf.id);
    await expect(page.getByTestId("propinas-dialog-balance")).toHaveText("Gs. 10.000");

    // AC7: withdrawing more than the balance is rejected client-side.
    const amountInput = page.locator("#propinas-withdrawal-amount");
    await setControlledInputValue(amountInput, "15000");
    // AC9: masked money input — dot separator, no decimals.
    await expect(amountInput).toHaveValue("15.000");
    await page.getByTestId("propinas-withdraw-confirm").click();
    await expect(page.getByText("The amount cannot exceed the accumulated tip balance.")).toBeVisible();
    await expect(page.getByTestId("propinas-dialog-balance")).toHaveText("Gs. 10.000");

    // AC8: a valid withdrawal deducts from the balance immediately.
    await setControlledInputValue(amountInput, "4000");
    await expect(amountInput).toHaveValue("4.000");
    await page.getByTestId("propinas-withdraw-confirm").click();
    await expect(page.getByTestId("propinas-toast")).toContainText(
      "Withdrawal completed successfully.",
      { timeout: 15_000 },
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectBalance(page, withdrawalProf.id, "Gs. 6.000");

    // AC10: the withdrawal shows up in the movements table (tagged "Withdrawal", minus sign) with
    // the standard paging (5/10/20 rows per page).
    await filterPropinasByProfessional(page, withdrawalProf.fullName);
    const historyRow = propinasMovements(page)
      .filter({ hasText: "Withdrawal" })
      .filter({ hasText: "4.000" });
    await expect(historyRow).toHaveCount(1, { timeout: 15_000 });
    await expect(historyRow).toContainText("−");
    await expect(page.getByLabel("Rows per page:").locator("option")).toHaveCount(3);
  });

  test("Acceso restringido · el ítem de navegación Propinas no aparece para profesionales", async ({
    page,
  }) => {
    const adminRes = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    });
    const { accessToken } = (await adminRes.json()) as { accessToken: string };
    const email = `hu120prof${Date.now()}@test.com`;
    const createRes = await fetch(`${API_BASE}/api/professionals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ fullName: `E2E Prop Access ${Date.now()}`, email }),
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
    await expect(page.getByRole("link", { name: "Tips" })).toHaveCount(0);
  });
});
