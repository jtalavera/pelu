import { expect, test } from "@playwright/test";
import {
  apiBaseUrl,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { pickServiceLine } from "../fixtures/invoice";
import { professionalFormDialog, fillTimeComboboxField } from "../fixtures/ui";

test.describe("Issue #161 · Ajustes varios", () => {
  test("AC1 · el botón Desactivar del detalle de cliente está entre Cancelar y Guardar, alineado a ellos", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E161 Client ${Date.now()}`);

    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);

    const cancelBtn = page.getByTestId("client-edit-cancel");
    const deactivateBtn = page.getByTestId("client-edit-deactivate");
    const saveBtn = page.getByRole("button", { name: "Save", exact: true });

    await expect(cancelBtn).toBeVisible();
    await expect(deactivateBtn).toBeVisible();
    await expect(saveBtn).toBeVisible();

    // Same row, and ordered left-to-right Cancel → Deactivate → Save (desktop viewport, so the
    // action row lays out horizontally rather than stacking).
    const [cancelBox, deactivateBox, saveBox] = await Promise.all([
      cancelBtn.boundingBox(),
      deactivateBtn.boundingBox(),
      saveBtn.boundingBox(),
    ]);
    expect(cancelBox).not.toBeNull();
    expect(deactivateBox).not.toBeNull();
    expect(saveBox).not.toBeNull();
    expect(cancelBox!.y).toBeCloseTo(deactivateBox!.y, 0);
    expect(deactivateBox!.y).toBeCloseTo(saveBox!.y, 0);
    expect(cancelBox!.x).toBeLessThan(deactivateBox!.x);
    expect(deactivateBox!.x).toBeLessThan(saveBox!.x);
  });

  test("AC2 · un error al emitir un comprobante hace scroll hasta el cuadro de mensaje de error", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E161 Billing ${Date.now()}`);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 12));
    await page.getByRole("button", { name: client.fullName }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("50000");
    // Deliberate mismatch — passes client-side validation (a positive amount) but the backend
    // rejects it with PAYMENT_SUM_MISMATCH, landing on the catch/setSubmitError path this AC covers.
    await page.locator("#pay-amount-0").fill("10000");

    const errorBox = page.locator("#invoice-submit-error");
    await expect(errorBox).not.toBeVisible();

    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/invoices") && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByRole("button", { name: "Issue invoice" }).click(),
    ]);
    expect(res.ok()).toBeFalsy();

    await expect(errorBox).toBeVisible({ timeout: 10_000 });
    await expect(errorBox).toBeInViewport();
  });

  test("AC3 · las funciones de SIFEN (revalidar, correo, cancelar, identificar) están en solapas; estado/KuDE quedan informativos", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E161 SIFEN ${Date.now()}-${Math.random()}`);
    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
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
    const prep = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    const row = page.locator("tbody").getByRole("row").filter({ hasText: client.fullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "View" }).click();

    // Estado/KuDE stay informational — visible up top without touching any solapa.
    const section = page.getByTestId("sifen-status-section");
    await expect(section).toBeVisible();
    await expect(section.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByTestId("sifen-kude-download-button")).toBeVisible();

    // All four solapas exist for this invoice (approved, verification URL, client-identification
    // eligible), and the first one (Revalidate) is the default.
    await expect(page.getByTestId("sifen-tab-revalidate")).toBeVisible();
    await expect(page.getByTestId("sifen-tab-email")).toBeVisible();
    await expect(page.getByTestId("sifen-tab-cancel")).toBeVisible();
    await expect(page.getByTestId("sifen-tab-identify")).toBeVisible();

    await expect(page.getByTestId("sifen-revalidate-button")).toBeVisible();
    await expect(page.getByTestId("sifen-identify-client-button")).not.toBeVisible();

    // Switching solapas swaps which function is interactive without losing the others.
    await page.getByTestId("sifen-tab-identify").click();
    await expect(page.getByTestId("sifen-identify-client-button")).toBeVisible();
    await expect(page.getByTestId("sifen-revalidate-button")).not.toBeVisible();

    await page.getByTestId("sifen-tab-cancel").click();
    await expect(page.getByTestId("sifen-cancel-button")).toBeVisible();
    await expect(page.getByTestId("sifen-identify-client-button")).not.toBeVisible();
  });

  test("AC4 · la solapa de Horario del profesional es compacta (cada día ocupa una fila reducida)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const name = `E2E161 Prof ${Date.now()}`;
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = professionalFormDialog(page);
    await dlg.getByLabel("Full name").fill(name);
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();

    const mondayRow = dlg.getByTestId("prof-day-mon-row");
    await expect(mondayRow).toBeVisible();
    const inactiveBox = await mondayRow.boundingBox();
    expect(inactiveBox).not.toBeNull();
    // A day off (checkbox + "Day off" text only) must stay compact.
    expect(inactiveBox!.height).toBeLessThan(50);

    await dlg.getByTestId("prof-day-mon-active").check();
    await fillTimeComboboxField(dlg.locator("#prof-1-start"), "09:00");
    await fillTimeComboboxField(dlg.locator("#prof-1-end"), "17:00");

    const activeBox = await mondayRow.boundingBox();
    expect(activeBox).not.toBeNull();
    // Even with both time pickers showing, the row must not balloon back to the old
    // label-above-input layout (~90-100px+) — a single compact line, touch-target height included.
    expect(activeBox!.height).toBeLessThan(64);
  });
});
