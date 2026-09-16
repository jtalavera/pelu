import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import {
  apiBaseUrl,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// DEMO_TENANT_ID=1 has SIFEN_ELECTRONIC_INVOICING OFF by default in the e2e profile (see
// hu-33-ajustes-facturacion-electronica.spec.ts's own note) — the "Numeración inutilizada" tab
// (AC-3/AC-4 below) lives on a page that's gated on this flag, so those two tests turn it on
// explicitly. Every test unconditionally turns it back off in afterEach so it never leaks into
// unrelated tests (e.g. this file's own Propinas test creates invoices via the plain API, which
// would otherwise start requiring a SIFEN certificate).
const DEMO_TENANT_ID = 1;
const SIFEN_FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";

/** Picks options from the report tab's professional `MultiSelect` filter, one at a time. */
async function pickMultiSelectOption(
  page: Page,
  accessibleName: string,
  filterText: string,
  optionNamePattern: RegExp,
): Promise<void> {
  const cb = page.getByRole("combobox", { name: accessibleName, exact: true });
  await cb.click();
  await cb.fill(filterText);
  await page
    .getByRole("listbox", { name: accessibleName, exact: true })
    .getByRole("button", { name: optionNamePattern })
    .first()
    .click();
}

// Issue #205 "Ajustes en factura electronica 10_09": covers the ACs that are observable through
// the UI without a live SIFEN round-trip —
//   AC-2 SIFEN message history popup, AC-3 FECHA LIMITE for an already-approved voiding, AC-4 a
//   PENDING voiding superseded by a separately-approved covering range, AC-5 the "Estado en SIFEN"
//   accordion starting closed, and the Propinas report's per-professional visual separator.
// AC-1 (skipping approved voided numbers at emission time) is exercised at the service layer only
// (SifenNumberVoidingServiceTest/InvoiceServiceTest) — it isn't independently observable through
// the UI without seeding a fiscal-stamp counter collision, which real e2e data can't safely fake.

type IssuedInvoice = { id: number };

async function createInvoice(request: APIRequestContext, token: string): Promise<IssuedInvoice> {
  const seed = await seedCategoryServiceProfessional(request, token);
  const client = await seedClient(request, token, `E2E205 ${Date.now()}-${Math.random()}`);
  return apiPostJson<IssuedInvoice>(request, token, "/api/invoices", {
    clientId: client.id,
    clientDisplayName: client.fullName,
    clientRucOverride: null,
    clientIdentityDocumentOverride: null,
    lines: [
      {
        serviceId: seed.serviceId,
        description: seed.serviceFullName,
        quantity: 1,
        unitPrice: 55000,
      },
    ],
    payments: [{ method: "CASH", amount: 55000 }],
  });
}

async function openInvoiceDetail(page: Page, clientFullName: string) {
  await page.goto("/app/billing");
  await page.getByRole("tab", { name: "History" }).click();
  await page.locator("#invoice-history-text-filter").fill(clientFullName);
  const row = page
    .locator("tbody tr[role=\"button\"]")
    .filter({ hasText: clientFullName })
    .filter({ visible: true });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
}

async function openVoidingTab(page: Page) {
  await page.goto("/app/settings/sifen");
  await page.getByRole("tab", { name: "Voided numbering" }).click();
}

/**
 * The "Numeración inutilizada" row renders its range as "FACTURA <n>" with no leading zeros. A
 * bare substring match on the stripped number (e.g. "42") would also match an unrelated row
 * number containing it (e.g. "1042") in this shared demo tenant — anchor on a non-digit boundary
 * on both sides instead.
 */
function invoiceNumberRegex(invoiceNumberFormatted: string): RegExp {
  const bare = invoiceNumberFormatted.replace(/^0+/, "");
  return new RegExp(`FACTURA ${bare}(?!\\d)`);
}

test.describe("Issue #205 · Ajustes en factura electrónica y propinas", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  test.afterEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, false);
  });

  test("AC5 · el acordeón \"Estado en SIFEN\" aparece cerrado al abrir el detalle del comprobante", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const invoice = await createInvoice(request, token);
    const rejectRes = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/simulate-sifen-rejection`,
    );
    expect(rejectRes.ok(), await rejectRes.text()).toBeTruthy();
    const detail = await request.get(`${apiBaseUrl()}/api/invoices/${invoice.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { clientDisplayName } = (await detail.json()) as { clientDisplayName: string };

    await loginAsDemo(page);
    await openInvoiceDetail(page, clientDisplayName);

    // The section (its own <details>/<summary>) is visible, but its body content is collapsed —
    // native <details> keeps the content in the DOM (just hidden), so check visibility, not count.
    await expect(page.getByTestId("sifen-tab-status")).toBeVisible();
    await expect(page.getByText(/SIFEN message/)).toBeHidden();

    await page.getByTestId("sifen-tab-status").locator("summary").click();
    await expect(page.getByText(/SIFEN message/)).toBeVisible();
  });

  test("AC2 · el historial de mensajes SIFEN muestra todas las respuestas registradas", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const invoice = await createInvoice(request, token);
    const rejectRes = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/simulate-sifen-rejection`,
    );
    expect(rejectRes.ok(), await rejectRes.text()).toBeTruthy();
    const entriesRes = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/fabricate-sifen-event-log-entries`,
    );
    expect(entriesRes.ok(), await entriesRes.text()).toBeTruthy();
    const detail = await request.get(`${apiBaseUrl()}/api/invoices/${invoice.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { clientDisplayName } = (await detail.json()) as { clientDisplayName: string };

    await loginAsDemo(page);
    await openInvoiceDetail(page, clientDisplayName);
    await page.getByTestId("sifen-tab-status").locator("summary").click();
    await page.getByTestId("sifen-history-button").click();

    const entries = page.getByTestId("sifen-history-entry");
    await expect(entries).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByText("XML mal formado")).toBeVisible();
    await expect(page.getByText("Evento registrado correctamente")).toBeVisible();
  });

  test("AC3 · una inutilización ya aprobada por SIFEN no muestra cuenta regresiva en Fecha límite", async ({
    page,
    request,
  }) => {
    // Created via the plain API with the flag still off — real SIFEN issuance would additionally
    // require a valid certificate + complete business profile, neither of which this scenario
    // needs: the rejection/approval below are fabricated directly, bypassing real submission.
    const token = await loginAsDemoApi(request);
    const invoice = await createInvoice(request, token);
    const rejectRes = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/simulate-sifen-rejection`,
    );
    expect(rejectRes.ok(), await rejectRes.text()).toBeTruthy();
    const approveRes = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/fabricate-number-voiding-result/true`,
    );
    expect(approveRes.ok(), await approveRes.text()).toBeTruthy();
    const detail = await request.get(`${apiBaseUrl()}/api/invoices/${invoice.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { invoiceNumberFormatted } = (await detail.json()) as {
      invoiceNumberFormatted: string;
    };

    // The "Numeración inutilizada" page itself is gated on the flag — turn it on only now, just
    // to view the page.
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, true);
    await loginAsDemo(page);
    await openVoidingTab(page);
    const row = page
      .getByTestId("sifen-number-voiding-row")
      .filter({ hasText: invoiceNumberRegex(invoiceNumberFormatted) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText("Approved", { exact: true })).toBeVisible();
    // Issue #205 AC-3: no "N days left" countdown once SIFEN has approved it — just a dash.
    await expect(row.getByText(/days? left/)).toHaveCount(0);
  });

  test("AC4 · una inutilización pendiente ya cubierta por otra aprobada aparece resuelta, no pendiente", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const invoice = await createInvoice(request, token);
    const rejectRes = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/simulate-sifen-rejection`,
    );
    expect(rejectRes.ok(), await rejectRes.text()).toBeTruthy();
    const supersedeRes = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/fabricate-superseding-manual-voiding`,
    );
    expect(supersedeRes.ok(), await supersedeRes.text()).toBeTruthy();
    const detail = await request.get(`${apiBaseUrl()}/api/invoices/${invoice.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { invoiceNumberFormatted } = (await detail.json()) as {
      invoiceNumberFormatted: string;
    };

    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, true);
    await loginAsDemo(page);
    await openVoidingTab(page);
    const row = page
      .getByTestId("sifen-number-voiding-row")
      .filter({ hasText: invoiceNumberRegex(invoiceNumberFormatted) })
      .filter({ hasText: "Automatic" });
    await expect(row).toBeVisible({ timeout: 15_000 });
    // The auto-recorded event's own status is still "Pending submission" — but it's covered by a
    // separate approved range, so it's flagged and treated as resolved, not actionable.
    await expect(row.getByText("Pending submission", { exact: true })).toBeVisible();
    await expect(row.getByText("Covered by another voiding")).toBeVisible();
    await expect(row.getByText(/days? left/)).toHaveCount(0);
    await expect(row.getByLabel("Reason")).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Submit to SIFEN" })).toHaveCount(0);
  });

  test("Propinas AC · separador visual entre los registros de cada profesional en el reporte", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const clientA = await seedClient(request, token, `E2E205 PropA ${Date.now()}`);
    const clientB = await seedClient(request, token, `E2E205 PropB ${Date.now()}`);
    const profBRes = await apiPostJson<{ id: number; fullName: string }>(
      request,
      token,
      "/api/professionals",
      { fullName: `E2E205 PropinasB ${Date.now()}`, phone: null, email: null, photoDataUrl: null },
    );

    async function seedTip(clientId: number, professionalId: number, tipAmount: number) {
      const record = await apiPostJson<{ id: number }>(request, token, "/api/service-records", {
        clientId,
        lines: [{ serviceId: seed.serviceId, professionalId, quantity: 1, unitPrice: 50000 }],
        tips: [{ professionalId, amount: tipAmount }],
      });
      await apiPostJson(request, token, "/api/invoices", {
        clientId,
        clientDisplayName: null,
        clientRucOverride: null,
        discountType: null,
        discountValue: null,
        lines: [
          {
            serviceId: seed.serviceId,
            description: "E2E service",
            quantity: 1,
            unitPrice: 50000,
            discountType: null,
            discountValue: null,
          },
        ],
        payments: [{ method: "CASH", amount: 50000 }],
        serviceRecordId: record.id,
        tipsAmount: tipAmount,
      });
    }

    await seedTip(clientA.id, seed.professionalId, 5000);
    await seedTip(clientB.id, profBRes.id, 3000);

    await loginAsDemo(page);
    await page.goto("/app/propinas");
    await pickMultiSelectOption(
      page,
      "Professional",
      seed.professionalFullName.slice(0, 10),
      new RegExp(seed.professionalFullName),
    );
    await pickMultiSelectOption(
      page,
      "Professional",
      profBRes.fullName.slice(0, 10),
      new RegExp(profBRes.fullName),
    );
    await page.getByRole("button", { name: "Search", exact: true }).click();

    const reportRows = page.getByTestId("propinas-report-table").locator("tbody tr");
    const rowA = reportRows.filter({ hasText: clientA.fullName });
    await expect(rowA).toBeVisible({ timeout: 15_000 });

    // The separator header for each professional must sit directly above their first data row.
    const allRows = await reportRows.all();
    const headerAIndex = await findRowIndex(allRows, seed.professionalFullName);
    const dataAIndex = await findRowIndex(allRows, clientA.fullName);
    const headerBIndex = await findRowIndex(allRows, profBRes.fullName, clientB.fullName);
    const dataBIndex = await findRowIndex(allRows, clientB.fullName);

    expect(headerAIndex).toBeGreaterThanOrEqual(0);
    expect(headerBIndex).toBeGreaterThanOrEqual(0);
    expect(headerAIndex).toBeLessThan(dataAIndex);
    expect(headerBIndex).toBeLessThan(dataBIndex);
  });
});

/**
 * Finds the index of the first row containing `text` but not `exclude` — used to distinguish a
 * professional's own separator-header row (name only) from a data row that happens to also
 * contain that professional's name inside another column's text.
 */
async function findRowIndex(
  rows: Locator[],
  text: string,
  exclude?: string,
): Promise<number> {
  for (let i = 0; i < rows.length; i++) {
    const content = await rows[i].textContent();
    if (content?.includes(text) && (!exclude || !content.includes(exclude))) {
      return i;
    }
  }
  return -1;
}
