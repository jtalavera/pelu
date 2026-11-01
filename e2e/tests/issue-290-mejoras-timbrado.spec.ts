import { expect, test, type Page } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  isoDateLocal,
  listFiscalStamps,
  loginAsDemoApi,
  seedClient,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { stampRowAction } from "../fixtures/ui";

/**
 * Issue #290 — Mejoras a creación y edición de timbrado:
 *  1. the start of validity is saved exactly as picked (not one day earlier);
 *  2. the page shows the stored date (not one day earlier);
 *  3. while the stamp has no invoices every field can be edited (once it has, only the optional
 *     end of validity, the "to" number and — forward only — the starting number);
 *  4. "fin de vigencia" and "número hasta" are optional.
 *
 * The browser runs in Paraguay's timezone (UTC-3): west of UTC is where a "YYYY-MM-DD" parsed as
 * UTC midnight shows up as the previous day.
 */
test.use({ timezoneId: "America/Asuncion" });
test.describe.configure({ mode: "serial" });

function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDateLocal(d);
}

/** Same formatting as the stamps table (`Intl` medium date, en-US), from a plain calendar date. */
function displayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(y, m - 1, d));
}

function uniqueStampNumber(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-7)}`;
}

async function openFiscalStampPage(page: Page) {
  await loginAsDemo(page);
  await page.goto("/app/settings/fiscal-stamp");
  await expect(page.getByTestId("fiscal-stamp-add")).toBeVisible({ timeout: 30_000 });
}

async function fillCreateForm(
  page: Page,
  f: { stampNumber: string; validFrom: string; validUntil?: string; rangeFrom: string; rangeTo?: string; initial: string },
) {
  await page.getByTestId("fiscal-stamp-add").click();
  await page.getByLabel("Stamp number", { exact: true }).fill(f.stampNumber);
  await page.getByLabel("Validity start", { exact: true }).fill(f.validFrom);
  if (f.validUntil) await page.getByLabel("Validity end", { exact: true }).fill(f.validUntil);
  await page.getByLabel("Number from", { exact: true }).fill(f.rangeFrom);
  if (f.rangeTo) await page.getByLabel("Number to", { exact: true }).fill(f.rangeTo);
  await page.getByLabel("Starting invoice number", { exact: true }).fill(f.initial);
  await page.getByTestId("fiscal-stamp-create-submit").click();
}

test.describe("Issue #290 · Mejoras a creación y edición de timbrado", () => {
  let openEndedStampId: number | null = null;

  test.afterAll(async ({ request }) => {
    // The open-ended stamp from item 4 is left active by the test; hand the tenant back a regular
    // stamp so later specs start from the usual state.
    const token = await loginAsDemoApi(request);
    if (openEndedStampId !== null) {
      await request.post(`${API_BASE}/api/fiscal-stamps/${openEndedStampId}/deactivate`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    await ensureActiveFiscalStampForInvoices(request, token);
  });

  test("Items 1-2 · la fecha de inicio de vigencia se guarda y se muestra exactamente como se eligió", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const stampNumber = uniqueStampNumber("2");
    const validFrom = daysFromToday(-9);
    const validUntil = daysFromToday(365);

    await openFiscalStampPage(page);
    await fillCreateForm(page, {
      stampNumber,
      validFrom,
      validUntil,
      rangeFrom: "1",
      rangeTo: "100",
      initial: "1",
    });
    await expect(page.getByText("Your changes were saved.")).toBeVisible();

    // Item 1: the backend stores (and returns) the exact calendar date picked in the UI.
    const created = (await listFiscalStamps(request, token)).find((s) => s.stampNumber === stampNumber);
    expect(created).toBeTruthy();
    expect(created!.validFrom).toBe(validFrom);
    expect(created!.validUntil).toBe(validUntil);

    // Item 2: the table shows that same day, not the previous one.
    const row = page.getByTestId(`fiscal-stamp-row-${created!.id}`);
    await expect(row).toContainText(displayDate(validFrom));
    await expect(row).toContainText(displayDate(validUntil));
    await expect(row).not.toContainText(displayDate(daysFromToday(-10)));

    // The edit dialog is pre-filled with the stored date, and saving it untouched keeps it.
    await stampRowAction(page, row, /^Edit/);
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByLabel("Validity start", { exact: true })).toHaveValue(validFrom);
    await expect(dlg.getByLabel("Validity end", { exact: true })).toHaveValue(validUntil);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toHaveCount(0);
    const afterSave = (await listFiscalStamps(request, token)).find((s) => s.id === created!.id);
    expect(afterSave!.validFrom).toBe(validFrom);
    expect(afterSave!.validUntil).toBe(validUntil);
  });

  test("Item 3 · sin facturas asociadas se puede editar cualquier campo del timbrado", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const created = await apiPostJson<{ id: number }>(request, token, "/api/fiscal-stamps", {
      stampNumber: uniqueStampNumber("4"),
      validFrom: daysFromToday(-5),
      validUntil: daysFromToday(200),
      rangeFrom: 1,
      rangeTo: 100,
      initialEmissionNumber: 1,
    });

    await openFiscalStampPage(page);
    const row = page.getByTestId(`fiscal-stamp-row-${created.id}`);
    await stampRowAction(page, row, /^Edit/);
    const dlg = page.getByRole("dialog");

    const newStampNumber = uniqueStampNumber("5");
    const newFrom = daysFromToday(-3);
    const newUntil = daysFromToday(400);
    const edits: [string, string][] = [
      ["Stamp number", newStampNumber],
      ["Validity start", newFrom],
      ["Validity end", newUntil],
      ["Number from", "200"],
      ["Number to", "300"],
      ["Starting invoice number", "250"],
      ["Establishment", "4"],
      ["Expedition point", "5"],
    ];
    for (const [label, value] of edits) {
      const input = dlg.getByLabel(label, { exact: true });
      await expect(input).toBeEditable();
      await input.fill(value);
    }
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toHaveCount(0);

    const edited = (await listFiscalStamps(request, token)).find((s) => s.id === created.id);
    expect(edited).toMatchObject({
      stampNumber: newStampNumber,
      validFrom: newFrom,
      validUntil: newUntil,
      rangeFrom: 200,
      rangeTo: 300,
      nextEmissionNumber: 250,
      establishment: 4,
      expeditionPoint: 5,
    });
    await expect(row).toContainText(newStampNumber);
    await expect(row).toContainText(displayDate(newFrom));
    await expect(row).toContainText("004-005-");
  });

  test("Item 4 · fin de vigencia y número hasta son opcionales; el timbrado se activa y factura", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const stampNumber = uniqueStampNumber("6");

    await openFiscalStampPage(page);
    await page.getByTestId("fiscal-stamp-add").click();
    await expect(page.getByText("Optional — not required for electronic invoicing.")).toHaveCount(2);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await fillCreateForm(page, {
      stampNumber,
      validFrom: daysFromToday(-1),
      rangeFrom: "1",
      initial: "1",
    });
    await expect(page.getByText("Your changes were saved.")).toBeVisible();

    const created = (await listFiscalStamps(request, token)).find((s) => s.stampNumber === stampNumber);
    expect(created).toBeTruthy();
    openEndedStampId = created!.id;
    expect(created!.validUntil).toBeNull();
    expect(created!.rangeTo).toBeNull();

    const row = page.getByTestId(`fiscal-stamp-row-${created!.id}`);
    await expect(row).toContainText("– —");
    await stampRowAction(page, row, /^Activate$/);
    await expect(row.getByText("Active", { exact: true })).toBeVisible();

    // A comprobante can be issued against a stamp with no end of validity / upper number.
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E I290 ${Date.now()}`);
    const invoice = await apiPostJson<{ invoiceNumber: number }>(request, token, "/api/invoices", {
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
    expect(invoice.invoiceNumber).toBe(1);
  });

  test("Item 3 · con facturas asociadas solo se editan fin de vigencia, número hasta y número de inicio", async ({
    page,
    request,
  }) => {
    test.skip(openEndedStampId === null, "depends on the item 4 test's invoiced stamp");
    const token = await loginAsDemoApi(request);
    const before = (await listFiscalStamps(request, token)).find((s) => s.id === openEndedStampId);
    expect(before!.hasInvoices).toBe(true);

    await openFiscalStampPage(page);
    const row = page.getByTestId(`fiscal-stamp-row-${openEndedStampId}`);
    await stampRowAction(page, row, /^Edit/);
    const dlg = page.getByRole("dialog");
    for (const locked of ["Stamp number", "Validity start", "Number from", "Establishment", "Expedition point"]) {
      await expect(dlg.getByLabel(locked, { exact: true })).toBeDisabled();
    }
    await expect(dlg.getByText("This stamp already has invoices, so this field is fixed.").first()).toBeVisible();

    const newUntil = daysFromToday(500);
    await dlg.getByLabel("Validity end", { exact: true }).fill(newUntil);
    await dlg.getByLabel("Number to", { exact: true }).fill("5000");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toHaveCount(0);

    const after = (await listFiscalStamps(request, token)).find((s) => s.id === openEndedStampId);
    expect(after!.validUntil).toBe(newUntil);
    expect(after!.rangeTo).toBe(5000);
    expect(after!.stampNumber).toBe(before!.stampNumber);
    expect(after!.validFrom).toBe(before!.validFrom);
    await expect(row).toContainText(displayDate(newUntil));

  });
});
