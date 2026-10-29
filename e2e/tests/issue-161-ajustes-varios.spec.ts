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
import { ensureCashSessionOpen, fillPaymentAmount, goToBillingHome, goToInvoiceHistory, openInvoiceSifenTab, searchInvoiceHistory } from "../fixtures/billing";
import { pickServiceLine, ensurePaymentMethodChosen } from "../fixtures/invoice";
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
    await goToBillingHome(page);
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 12));
    await page.getByRole("button", { name: client.fullName }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("50000");
    // Deliberate mismatch — passes client-side validation (a positive amount) but the backend
    // rejects it with PAYMENT_SUM_MISMATCH, landing on the catch/setSubmitError path this AC covers.
    await fillPaymentAmount(page, "10000");

    const errorBox = page.locator("#invoice-submit-error");
    await expect(errorBox).not.toBeVisible();

    await ensurePaymentMethodChosen(page);
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

  test("AC3 · el detalle se divide en solapas Factura / SIFEN; todas las funciones de SIFEN (estado, correo, revalidar, cancelar, identificar) se ven juntas en la solapa SIFEN, sin acordeón", async ({
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
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page
      .locator('[data-testid^="invoice-history-row-"]')
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    // Redesign: the detail is one view — no tabs. The KuDE download is its primary action, "Share"
    // is its own button and every other SIFEN function is behind "⋯" (nothing is open by default).
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("invoice-detail-view")).toBeVisible();
    await expect(dialog.getByRole("tab")).toHaveCount(0);
    await expect(page.getByTestId("sifen-kude-download-button")).toBeVisible();
    await expect(page.getByTestId("invoice-share-button")).toBeVisible();
    await expect(page.getByTestId("sifen-tab-status")).toBeHidden();

    await dialog.getByTestId("invoice-more-actions-button").click();
    for (const id of [
      "invoice-menu-technical-detail",
      "invoice-menu-revalidate",
      "invoice-menu-cancel-sifen",
      "invoice-menu-identify",
    ]) {
      await expect(dialog.getByTestId(id)).toBeVisible();
    }
    await dialog.getByTestId("invoice-more-actions-button").click(); // close the menu

    await openInvoiceSifenTab(page);
    const section = page.getByTestId("sifen-status-section");
    await expect(section.getByText("Approved", { exact: true })).toBeVisible();
    // The primary action stays available while the panels are open.
    await expect(page.getByTestId("sifen-kude-download-button")).toBeVisible();

    // No accordion: every SIFEN section for this invoice (approved, verification URL,
    // client-identification eligible) is laid out at once, its content visible without any click.
    await expect(section.locator("details")).toHaveCount(0);
    for (const id of [
      "sifen-tab-status",
      "sifen-tab-email",
      "sifen-tab-revalidate",
      "sifen-tab-cancel",
      "sifen-tab-identify",
    ]) {
      await expect(section.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId("sifen-history-button")).toBeVisible();
    await expect(page.getByTestId("sifen-kude-send-email-button")).toBeVisible();
    await expect(page.getByTestId("sifen-revalidate-button")).toBeVisible();
    await expect(page.getByTestId("sifen-cancel-button")).toBeVisible();
    await expect(page.getByTestId("sifen-identify-client-confirm-button")).toBeVisible();
  });

  test("Paneles SIFEN · se ordenan compartir → revalidar → cancelar → identificar → detalle técnico (estado), cada uno con su título", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E SIFEN tab ${Date.now()}-${Math.random()}`);
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
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page
      .locator('[data-testid^="invoice-history-row-"]')
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await openInvoiceSifenTab(page);
    const section = page.getByTestId("sifen-status-section");

    // Each section is a titled block: status first (with its badge), then the actions, in this order.
    const order = [
      ["sifen-tab-email", "Share KuDE by email or WhatsApp"],
      ["sifen-tab-revalidate", "Revalidate in SIFEN"],
      ["sifen-tab-cancel", "Cancel invoice in SIFEN"],
      ["sifen-tab-identify", "Identify client"],
      ["sifen-tab-status", "SIFEN status"],
    ] as const;
    let previousY = -1;
    for (const [id, title] of order) {
      const block = section.getByTestId(id);
      await expect(block.getByRole("heading", { name: title, exact: true })).toBeVisible();
      const box = await block.boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.y, `${id} below the previous section`).toBeGreaterThan(previousY);
      previousY = box!.y;
    }
    await expect(section.getByTestId("sifen-tab-status").getByText("Approved", { exact: true })).toBeVisible();
    // The control number (CDC) is shown as a labelled value of the status summary.
    await expect(section.getByTestId("sifen-tab-status").getByText("Control number (CDC)")).toBeVisible();
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
