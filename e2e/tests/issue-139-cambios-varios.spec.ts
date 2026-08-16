import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  type SeededSalon,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { pickServiceLine } from "../fixtures/invoice";
import { pickSearchableOption, setControlledInputValue } from "../fixtures/ui";

type ServiceRecordSeed = { id: number; status: string };

/** Creates an open ficha de servicio with a tip for one professional, via the API. */
async function createServiceRecordApi(
  request: APIRequestContext,
  token: string,
  body: {
    clientId: number;
    lines: Array<{ serviceId: number; professionalId: number; unitPrice?: number }>;
    tips?: Array<{ professionalId: number; amount: number }>;
  },
): Promise<ServiceRecordSeed> {
  return apiPostJson<ServiceRecordSeed>(request, token, "/api/service-records", {
    clientId: body.clientId,
    lines: body.lines.map((l) => ({
      serviceId: l.serviceId,
      professionalId: l.professionalId,
      quantity: 1,
      unitPrice: l.unitPrice ?? 50000,
    })),
    tips: body.tips ?? [],
  });
}

/** Filters the ficha de servicio "History" tab and returns the first matching row. */
async function findServiceRecordHistoryRow(page: Page, query: string) {
  await page.goto("/app/service-records");
  await page.getByRole("tab", { name: "History" }).click();
  await page.locator("#service-record-history-text-filter").fill(query);
  return page.locator("tbody tr").filter({ hasText: query }).first();
}

test.describe("Issue #139 · Cambios varios en sistema", () => {
  test("AC1 · Fichas de servicio aparece en Gestión, no en Finanzas", async ({ page }) => {
    await loginAsDemo(page);
    const sidebar = page.locator('[data-tour="nav-sidebar"]');
    const links = sidebar.getByRole("link");
    const labels = await links.allTextContents();
    const clientsIdx = labels.findIndex((l) => l.includes("Clients"));
    const serviceRecordsIdx = labels.findIndex((l) => l.includes("Service records"));
    const billingIdx = labels.findIndex((l) => l.includes("Billing"));
    expect(clientsIdx).toBeGreaterThanOrEqual(0);
    expect(serviceRecordsIdx).toBeGreaterThanOrEqual(0);
    expect(billingIdx).toBeGreaterThanOrEqual(0);
    // Now grouped under Management (right after Clients), ahead of the whole Finance section.
    expect(serviceRecordsIdx).toBe(clientsIdx + 1);
    expect(serviceRecordsIdx).toBeLessThan(billingIdx);
  });

  test("AC2 · RUC duplicado muestra el mensaje de advertencia esperado", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const ruc = `800${Date.now()}-6`;
    await seedClient(request, token, `E2E139 RUC Dup A ${Date.now()}`, undefined, ruc);

    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(`E2E139 RUC Dup B ${Date.now()}`);
    await dlg.getByLabel("Document number").fill(ruc);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("A client with the same RUC already exists.", { exact: true }),
    ).toBeVisible();
  });

  test("AC3 · crear cliente con éxito muestra un mensaje verde", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(`E2E139 Success ${Date.now()}`);
    await dlg.getByRole("button", { name: "Save" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Client created" });
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toHaveClass(/emerald/);
  });

  test("AC4+AC5 · la propina se muestra en rojo y no se incluye en Pendiente ni en el Monto por defecto", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed: SeededSalon = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E139 Tips ${Date.now()}`);
    await createServiceRecordApi(request, token, {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, unitPrice: 50000 }],
      tips: [{ professionalId: seed.professionalId, amount: 4000 }],
    });

    await loginAsDemo(page);
    const row = await findServiceRecordHistoryRow(page, client.fullName);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "View" }).click();
    await page.getByRole("button", { name: "Generate invoice" }).click();

    await expect(page).toHaveURL(/\/app\/billing/);
    await expect(page.getByRole("heading", { name: "Issue Invoice" })).toBeVisible();
    await expect(page.locator("#line-price-0")).toHaveValue("50.000");

    // AC4: the tip label reads "Tip (non-invoiceable)" and renders in red.
    const tipLabel = page.getByText("Tip (non-invoiceable)", { exact: true });
    await expect(tipLabel).toBeVisible();
    await expect(tipLabel).toHaveClass(/text-red-600/);
    await expect(page.locator("#billing-tips-amount")).toHaveText("4.000");

    // AC5: the default Efectivo (CASH) amount and "Remaining" both exclude the tip —
    // they cover only the 50.000 fiscal total, not 54.000 (total + tip).
    await expect(page.locator("#pay-amount-0")).toHaveValue("50.000");
    const remainingRow = page.getByText("Remaining", { exact: true }).locator("xpath=..");
    await expect(remainingRow.getByText("0", { exact: true })).toBeVisible();
  });

  test("AC6 · el selector de método de pago bloquea tipos ya usados por otra fila", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill(`E2E139 AC6 ${Date.now()}`);
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("10000");

    // Row 0 defaults to CASH. Adding a second row must not default it to CASH again
    // (already used) — it should pick the next unused method, and CASH must now be
    // disabled in row 1's dropdown.
    await page.getByRole("button", { name: "Add payment method" }).click();
    await expect(page.locator("#pay-method-1")).not.toHaveValue("CASH");
    await expect(page.locator("#pay-method-1 option[value='CASH']")).toBeDisabled();
    await expect(page.locator("#pay-method-0 option[value='CASH']")).toBeEnabled();

    // Once every method type is in use, the "Add payment method" button disables itself.
    await page.getByRole("button", { name: "Add payment method" }).click();
    await page.getByRole("button", { name: "Add payment method" }).click();
    await page.getByRole("button", { name: "Add payment method" }).click();
    await expect(page.getByRole("button", { name: "Add payment method" })).toBeDisabled();
  });

  test("AC7 · el campo de nombre de cliente en Facturación se llama Nombre o Razón social", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await expect(page.getByLabel("Client name / business name")).toBeVisible();
  });

  test("AC8 · Historial de facturación muestra el cliente seleccionado, no el nombre editado", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E139 Ac8 Client ${Date.now()}`);
    const editedName = `E2E139 EDITED NAME ${Date.now()}`;

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 10));
    await page.getByRole("button", { name: client.fullName }).click();
    await expect(page.locator("#client-display-name")).toHaveValue(client.fullName);
    // Editing the free-text name after selecting the client must not affect what the
    // history table shows for CLIENTE — it must keep showing the linked client.
    await page.locator("#client-display-name").fill(editedName);
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("10000");

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

    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(editedName);
    const row = page.locator("tbody tr").first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(client.fullName);
    await expect(row).not.toContainText(editedName);
  });

  test("AC9 · Historial de retiros de propinas muestra fecha y hora", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E139 Withdraw ${Date.now()}`);
    // Close the ficha into an invoice so the tip counts toward the withdrawable balance
    // (Propinas only reports/accumulates CLOSED-record tips).
    const record = await createServiceRecordApi(request, token, {
      clientId: client.id,
      lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, unitPrice: 40000 }],
      tips: [{ professionalId: seed.professionalId, amount: 8000 }],
    });
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
          unitPrice: 40000,
          discountType: null,
          discountValue: null,
        },
      ],
      payments: [{ method: "CASH", amount: 40000 }],
      serviceRecordId: record.id,
      tipsAmount: 8000,
    });

    await loginAsDemo(page);
    await page.goto("/app/propinas");
    await page.getByRole("tab", { name: "Tip withdrawal" }).click();
    await expect(page.getByRole("tab", { name: "Tip withdrawal", selected: true })).toBeVisible();

    await pickSearchableOption(
      page,
      "Professional",
      seed.professionalFullName.slice(0, 10),
      new RegExp(seed.professionalFullName),
    );
    await expect(page.getByTestId("propinas-balance")).toHaveText("Gs. 8.000", { timeout: 15_000 });

    const amountInput = page.locator("#propinas-withdrawal-amount");
    await setControlledInputValue(amountInput, "8000");
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByText("Withdrawal completed successfully.")).toBeVisible({
      timeout: 15_000,
    });

    const historyRow = page
      .getByTestId("propinas-withdrawal-history-table")
      .locator("tbody tr")
      .filter({ hasText: seed.professionalFullName })
      .first();
    await expect(historyRow).toBeVisible({ timeout: 15_000 });
    // A time component (HH:mm), not just a bare date, must be shown for the withdrawal.
    await expect(historyRow).toContainText(/\d{1,2}:\d{2}/);
  });
});
