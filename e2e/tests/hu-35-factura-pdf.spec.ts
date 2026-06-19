import { expect, test } from "@playwright/test";
import {
  apiPostJson,
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

test.describe.configure({ mode: "serial" });

/** PUT the business-profile RUC (null clears it, a valid string like "80000005-6" sets it). */
async function setBusinessRuc(
  request: Parameters<typeof apiPutJson>[0],
  token: string,
  ruc: string | null,
) {
  await apiPutJson(request, token, "/api/business-profile", {
    businessName: "Demo salon",
    ruc,
    address: null,
    phone: null,
    contactEmail: null,
    logoDataUrl: null,
  });
}

/**
 * Issues an invoice via API (no UI) and returns its id and formatted number.
 * Requires the active fiscal stamp and cash session to already be open.
 */
async function issueInvoiceViaApi(
  request: Parameters<typeof apiPostJson>[0],
  token: string,
): Promise<{ id: number; invoiceNumberFormatted: string }> {
  return apiPostJson<{ id: number; invoiceNumberFormatted: string }>(
    request,
    token,
    "/api/invoices",
    {
      clientId: null,
      clientDisplayName: "E2E PDF Test",
      clientRucOverride: null,
      discountType: null,
      discountValue: null,
      lines: [{ serviceId: null, description: "E2E PDF line", quantity: 1, unitPrice: 9000 }],
      payments: [{ method: "CASH", amount: 9000 }],
    },
  );
}

test.describe("HU-35 · Factura en PDF no se genera", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  // ─── AC3: sin RUC, ambos botones "Descargar PDF" muestran error ─────────────

  test("HU-35 · AC3 sin RUC muestra error en alerta de nueva factura emitida", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    // Clear RUC so PDF endpoint returns 409
    await setBusinessRuc(request, token, null);

    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);

    // Issue invoice via UI to get the success alert with "Download PDF" button
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("9000");
    await page.locator("#pay-amount-0").fill("9000");
    await clickIssueInvoiceAndExpectSuccess(page);

    // The success alert appears with "Download PDF" button
    const downloadBtn = page.getByRole("button", { name: "Download PDF" });
    await expect(downloadBtn).toBeVisible({ timeout: 10_000 });

    // Verify no download event is triggered (set up listener before click)
    let downloadFired = false;
    page.once("download", () => {
      downloadFired = true;
    });

    await downloadBtn.click();

    // A destructive alert must appear with the RUC-required message
    await expect(
      page.getByRole("alert").filter({ hasText: "RUC" }),
    ).toBeVisible({ timeout: 10_000 });

    // No file should have been downloaded (no corrupt PDF)
    expect(downloadFired).toBe(false);
  });

  test("HU-35 · AC3 sin RUC muestra error en el diálogo de detalle de comprobante", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    // Clear RUC
    await setBusinessRuc(request, token, null);

    // Issue invoice via API so we have one in history
    const inv = await issueInvoiceViaApi(request, token);
    await loginAsDemo(page);

    // Navigate to invoice history
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();

    // Find the row for this invoice and click "View"
    const invRow = page.getByRole("row").filter({ hasText: inv.invoiceNumberFormatted });
    await expect(invRow).toBeVisible({ timeout: 15_000 });
    await invRow.getByRole("button", { name: "View" }).click();

    // The detail modal opens
    await expect(
      page.getByRole("dialog").filter({ hasText: inv.invoiceNumberFormatted }),
    ).toBeVisible({ timeout: 10_000 });

    // Track download events
    let downloadFired = false;
    page.once("download", () => {
      downloadFired = true;
    });

    // Click "Download PDF" inside the modal
    const downloadBtn = page.getByRole("dialog").getByRole("button", { name: "Download PDF" });
    await expect(downloadBtn).toBeVisible();
    await downloadBtn.click();

    // Destructive alert must appear with the RUC-required message
    await expect(
      page.getByRole("dialog").getByRole("alert").filter({ hasText: "RUC" }),
    ).toBeVisible({ timeout: 10_000 });

    // No corrupt file downloaded
    expect(downloadFired).toBe(false);
  });

  // ─── AC1 & AC2: con RUC válido, el PDF se descarga correctamente ─────────────

  test("HU-35 · AC2 con RUC válido, Download PDF en alerta de nueva factura descarga PDF válido", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token, "80000005-6");

    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);

    // Issue invoice via UI
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("9000");
    await page.locator("#pay-amount-0").fill("9000");
    await clickIssueInvoiceAndExpectSuccess(page);

    // The success alert appears with "Download PDF" button
    const downloadBtn = page.getByRole("button", { name: "Download PDF" });
    await expect(downloadBtn).toBeVisible({ timeout: 10_000 });

    // Capture the download and verify the file is a valid PDF
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      downloadBtn.click(),
    ]);

    const path = await download.path();
    expect(path).not.toBeNull();
    const fs = await import("fs/promises");
    const buf = await fs.readFile(path!);
    // Valid PDF starts with the %PDF magic bytes
    expect(buf.slice(0, 4).toString("latin1")).toBe("%PDF");

    // No error alert should be visible
    await expect(page.getByRole("alert").filter({ hasText: "RUC" })).not.toBeVisible();
  });

  test("HU-35 · AC1 con RUC válido, Download PDF en diálogo de historial descarga PDF válido", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token, "80000005-6");

    // Issue invoice via API
    const inv = await issueInvoiceViaApi(request, token);
    await loginAsDemo(page);

    // Navigate to invoice history
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();

    // Find the row for this invoice and click "View"
    const invRow = page.getByRole("row").filter({ hasText: inv.invoiceNumberFormatted });
    await expect(invRow).toBeVisible({ timeout: 15_000 });
    await invRow.getByRole("button", { name: "View" }).click();

    // The detail modal opens
    await expect(
      page.getByRole("dialog").filter({ hasText: inv.invoiceNumberFormatted }),
    ).toBeVisible({ timeout: 10_000 });

    const downloadBtn = page.getByRole("dialog").getByRole("button", { name: "Download PDF" });
    await expect(downloadBtn).toBeVisible();

    // Capture the download and verify the file is a valid PDF
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      downloadBtn.click(),
    ]);

    const path = await download.path();
    expect(path).not.toBeNull();
    const fs = await import("fs/promises");
    const buf = await fs.readFile(path!);
    // Valid PDF starts with the %PDF magic bytes
    expect(buf.slice(0, 4).toString("latin1")).toBe("%PDF");

    // No error alert should be visible in the dialog
    await expect(
      page.getByRole("dialog").getByRole("alert").filter({ hasText: "RUC" }),
    ).not.toBeVisible();
  });
});
