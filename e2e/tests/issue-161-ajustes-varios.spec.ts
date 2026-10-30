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
import { ensureCashSessionOpen, fillPaymentAmount, goToBillingHome, goToInvoiceHistory, closeInvoicePanel, openInvoicePanel, searchInvoiceHistory } from "../fixtures/billing";
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

    // One panel at a time: each option opens its own section and shows its controls...
    const controls = [
      ["tech", "sifen-tab-status", "sifen-history-button"],
      ["share", "sifen-tab-email", "sifen-kude-send-email-button"],
      ["revalidate", "sifen-tab-revalidate", "sifen-revalidate-button"],
      ["cancel", "sifen-tab-cancel", "sifen-cancel-button"],
      ["identify", "sifen-tab-identify", "sifen-identify-client-confirm-button"],
    ] as const;
    for (const [panel, sectionId, controlId] of controls) {
      await openInvoicePanel(page, panel);
      await expect(page.getByTestId(sectionId)).toBeVisible();
      await expect(page.getByTestId(controlId)).toBeVisible();
      // ...the others are not showing, and the primary action stays available.
      for (const [other, otherSection] of controls) {
        if (other !== panel) await expect(page.getByTestId(otherSection)).toHaveCount(0);
      }
      await expect(page.getByTestId("sifen-kude-download-button")).toBeVisible();
    }
    await expect(page.getByTestId("sifen-status-section").locator("details")).toHaveCount(0);

    // The open option closes with its ✕ ...
    await closeInvoicePanel(page, "identify");
    await expect(page.getByTestId("sifen-tab-identify")).toHaveCount(0);
    // ... or by pressing "⋯" again: the option goes away and the menu is back for the next one.
    await openInvoicePanel(page, "cancel");
    await dialog.getByTestId("invoice-more-actions-button").click();
    await expect(page.getByTestId("sifen-tab-cancel")).toHaveCount(0);
    await expect(dialog.getByTestId("invoice-more-actions-menu")).toBeVisible();
    await dialog.getByTestId("invoice-more-actions-button").click();
    await expect(dialog.getByTestId("invoice-more-actions-menu")).toHaveCount(0);
    // "Share" closes with its own button, too.
    await openInvoicePanel(page, "share");
    await dialog.getByTestId("invoice-share-button").click();
    await expect(page.getByTestId("sifen-tab-email")).toHaveCount(0);
  });

  test("Paneles SIFEN · cada opción abre su propio bloque con su título", async ({
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

    // Each option opens a titled block, one at a time.
    const order = [
      ["share", "sifen-tab-email", "Share KuDE by email or WhatsApp"],
      ["revalidate", "sifen-tab-revalidate", "Revalidate in SIFEN"],
      ["cancel", "sifen-tab-cancel", "Cancel invoice in SIFEN"],
      ["identify", "sifen-tab-identify", "Identify client"],
      ["tech", "sifen-tab-status", "SIFEN status"],
    ] as const;
    for (const [panel, id, title] of order) {
      await openInvoicePanel(page, panel);
      const block = page.getByTestId(id);
      await expect(block.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }
    // The technical detail (opened last) shows the status badge and the control number (CDC).
    await expect(page.getByTestId("sifen-tab-status").getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByTestId("sifen-tab-status").getByText("Control number (CDC)")).toBeVisible();
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
    await dlg.getByTestId("prof-save").click();

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
