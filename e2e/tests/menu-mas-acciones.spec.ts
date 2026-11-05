import { expect, test } from "@playwright/test";
import {
  apiBaseUrl,
  apiPostJson,
  createAppointmentApi,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { goToCatalog } from "../fixtures/catalog";
import { goToInvoiceHistory, searchInvoiceHistory } from "../fixtures/billing";

/**
 * «Más acciones»: el antiguo botón «⋯» ahora es un botón rotulado con flecha que abre un menú
 * flotante (borde, sombra, ícono por opción, hover); las acciones destructivas van al final, en
 * rojo y separadas. Esc o un clic fuera lo cierran.
 */
test.describe.configure({ mode: "serial" });

test.describe("Menú «Más acciones»", () => {
  test("Agenda · detalle del turno: botón rotulado, menú con íconos y «Cancelar turno» en rojo y separado", async ({
    page,
    request,
  }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const client = await seedClient(request, admin, `E2E MasAcc ${Date.now()}`);
    const start = new Date(Date.now() + 24 * 3600_000);
    start.setHours(15, 0, 0, 0);
    await createAppointmentApi(request, admin, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: start.toISOString(),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await page.getByRole("button", { name: new RegExp(client.fullName) }).first().click({ timeout: 20_000 });

    // The trigger reads as a button: on the web it is the round «⋯» (named «More actions»), closed.
    const trigger = page.getByTestId("calendar-more-actions");
    await expect(trigger).toHaveAttribute("aria-label", "More actions");
    await expect(trigger).toContainText("⋯");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("calendar-actions-panel")).toHaveCount(0);

    await trigger.click();
    const menu = page.getByTestId("calendar-actions-panel");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("role", "menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Every option is a real button with an icon; cancel is last, red, after a separator.
    const items = menu.getByRole("menuitem");
    await expect(items.first()).toBeVisible();
    await expect(items.first().locator("svg")).toHaveCount(1);
    await expect(menu.getByRole("separator")).toHaveCount(1);
    const cancel = page.getByTestId("calendar-action-cancel");
    await expect(items.last()).toHaveAttribute("data-testid", "calendar-action-cancel");
    await expect(cancel).toHaveClass(/text-danger/);

    // Keyboard: the first option has focus, ↓ moves, Esc closes and gives focus back to the trigger.
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    // Esc closed the menu only, not the turno's detail.
    await expect(page.getByRole("dialog")).toBeVisible();

    // Outside click closes it too.
    await trigger.click();
    await expect(menu).toBeVisible();
    // The title is clear of the floating menu (the client row sits under it).
    await page.getByRole("dialog").getByRole("heading", { level: 2 }).click();
    await expect(menu).toHaveCount(0);
  });

  test("Servicios · «Más acciones» de la cabecera usa el mismo botón rotulado", async ({ page }) => {
    await loginAsDemo(page);
    await goToCatalog(page);
    const trigger = page.getByTestId("catalog-more-trigger");
    await expect(trigger).toContainText("More actions");
    await trigger.click();
    await expect(page.getByTestId("catalog-more-item-price-list")).toBeVisible();
    await expect(page.getByTestId("catalog-more-item-categories")).toBeVisible();
  });

  test("Detalle del comprobante: todos los botones de la fila miden lo mismo, quedan alineados y el título está centrado con la ×", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Alinea ${Date.now()}-${Math.random()}`);
    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 10000 }],
      payments: [{ method: "CASH", amount: 10000 }],
    });
    const prep = await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`);
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page.locator('[data-testid^="invoice-history-row-"]').filter({ hasText: client.fullName }).filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const dialog = page.getByRole("dialog");
    const more = dialog.getByTestId("invoice-more-actions-button");
    await expect(more).toBeVisible({ timeout: 20_000 });

    // The dialog is as narrow as the others (512 px), no longer 672 px.
    const dlgBox = await dialog.boundingBox();
    expect(dlgBox!.width).toBeLessThanOrEqual(520);

    // Every button of the action area: same height (44 px) and same text size.
    const bar = more.locator("xpath=ancestor::div[contains(@class,'border-t')][1]");
    const buttons = bar.getByRole("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(3);
    const looks = await buttons.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: (el.textContent ?? "").trim(),
          h: Math.round(r.height),
          font: getComputedStyle(el).fontSize,
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
        };
      }),
    );
    for (const l of looks) {
      expect(l.h).toBe(44);
      expect(l.font).toBe("14px");
    }
    // Layout: the download on its own row on top, full width; below it «Cerrar» on the LEFT, then
    // the rest, all in one row.
    const download = looks.find((l) => /KuDE|PDF/i.test(l.label))!;
    const rest = looks.filter((l) => l !== download);
    expect(download).toBeTruthy();
    expect(new Set(rest.map((l) => l.y)).size).toBe(1);
    expect(rest[0].y).toBeGreaterThan(download.y);
    const closeBtn = rest.find((l) => /^Close/.test(l.label))!;
    expect(closeBtn.x).toBe(Math.min(...rest.map((l) => l.x)));
    const barBox = await bar.boundingBox();
    expect(download.w).toBeGreaterThanOrEqual(barBox!.width - 2);

    // The title is vertically centered with the × of the header.
    const title = dialog.getByRole("heading", { level: 2 });
    const close = dialog.getByRole("button", { name: /^Close/ }).first();
    const [t, x] = await Promise.all([title.boundingBox(), close.boundingBox()]);
    expect(Math.abs(t!.y + t!.height / 2 - (x!.y + x!.height / 2))).toBeLessThanOrEqual(2);
  });
});
