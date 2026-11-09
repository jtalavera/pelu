import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  API_BASE,
  apiGetJson,
  apiPostJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { addFichaLine, openFichaDialog, pickLineService } from "../fixtures/fichas";
import {
  fillPaymentAmount,
  goToBillingHome,
  openLineMoreOptions,
  openMoreOptions,
  pickInvoiceLineProfessional,
  showPaymentAmounts,
} from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, ensurePaymentMethodChosen, pickServiceLine } from "../fixtures/invoice";
import { loginAdminUi, provisionCommissionWorld, type CommissionWorld } from "../fixtures/commissions";

/**
 * Issue #384 · Ajustes varios:
 *  1. «Agenda» en el menú lateral, igual que en el panel principal.
 *  2. Ficha existente: al elegir el servicio de una línea nueva el área queda abierta (se ve el profesional);
 *     solo agregar otro servicio cierra la anterior.
 *  3. Factura: el profesional de un ítem se filtra mientras se escribe.
 *  4. Factura: los pagos deben sumar el monto facturado + la propina.
 *  5. Facturación: «Facturas de hoy» arranca desplegada.
 */

const parseGs = (v: string) => Number(v.replace(/\./g, ""));
const fmtGs = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

test.describe("Issue #384 · Ajustes varios", () => {
  test("AC1 · el menú lateral dice «Agenda» (igual que el panel principal), no «Calendar»", async ({ page }) => {
    await loginAsDemo(page);
    const sidebar = page.locator('[data-tour="nav-sidebar"]');
    await expect(sidebar.getByRole("link", { name: "Agenda", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Calendar", exact: true })).toHaveCount(0);
    // The main panel (Inicio) points to the same screen with the same word.
    await expect(page.getByRole("link", { name: "View agenda →" })).toBeVisible();
    await sidebar.getByRole("link", { name: "Agenda", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/calendar/);
  });

  test("AC2 · en una ficha existente, elegir el servicio deja el área abierta; solo agregar otro servicio cierra el anterior", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed1 = await seedCategoryServiceProfessional(request, token);
    const seed2 = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E384 Ficha ${Date.now()}`);
    await apiPostJson(request, token, "/api/service-records", {
      clientId: client.id,
      lines: [
        { serviceId: seed1.serviceId, professionalId: seed1.professionalId, quantity: 1, unitPrice: 50000 },
      ],
      tips: [],
    });

    await loginAsDemo(page);
    const dlg = await openFichaDialog(page, client.fullName);

    // The existing service is shown folded; adding a line opens the new (blank) one.
    const toggles = dlg.getByTestId("service-record-line-toggle");
    await expect(toggles).toHaveCount(1);
    await expect(toggles.nth(0)).toHaveAttribute("aria-expanded", "false");
    await addFichaLine(dlg);
    await expect(toggles).toHaveCount(2);
    await expect(toggles.nth(1)).toHaveAttribute("aria-expanded", "true");

    // Picking the service keeps the whole area open: the professional field is right there.
    await pickLineService(page, 1, seed2.serviceFullName);
    await expect(toggles.nth(1)).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#service-record-line-svc-1")).toBeVisible();
    await expect(page.locator("#service-record-line-prof-1")).toBeVisible();
    await expect(toggles.nth(0)).toHaveAttribute("aria-expanded", "false");

    // Only adding another service folds the previous one.
    await addFichaLine(dlg);
    await expect(toggles).toHaveCount(3);
    await expect(toggles.nth(1)).toHaveAttribute("aria-expanded", "false");
    await expect(toggles.nth(2)).toHaveAttribute("aria-expanded", "true");
  });

  test.describe("Facturación", () => {
    let w: CommissionWorld;

    test.beforeEach(async ({ request }) => {
      w = await provisionCommissionWorld(request, "Ajustes 384", { commissionsEnabled: false });
    });

    async function openNewInvoice(page: Page) {
      await page.goto("/app/billing");
      await goToBillingHome(page);
      await page.getByRole("button", { name: "New Invoice" }).click();
      await page.getByLabel("Search or select client").click();
      await page.getByRole("button", { name: "Occasional client" }).click();
      await page.getByLabel("Client name / business name").fill("Cliente 384");
    }

    test("AC3 · el profesional de un ítem de la factura se filtra mientras se escribe", async ({ page }) => {
      await loginAdminUi(page, w);
      await openNewInvoice(page);
      await pickServiceLine(page, w.service.name, 0);
      await openLineMoreOptions(page, 0);

      const input = page.locator("#line-professional-0");
      await input.click();
      // Focusing lists every professional…
      const listbox = page.locator("#line-professional-0-listbox");
      await expect(listbox.getByRole("button", { name: w.ana.name })).toBeVisible();
      await expect(listbox.getByRole("button", { name: w.bea.name })).toBeVisible();

      // …and typing narrows the list down to the matches.
      await input.fill("Ana");
      await expect(listbox.getByRole("button", { name: w.ana.name })).toBeVisible();
      await expect(listbox.getByRole("button", { name: w.bea.name })).toHaveCount(0);

      await input.fill("Bea");
      await expect(listbox.getByRole("button", { name: w.bea.name })).toBeVisible();
      await expect(listbox.getByRole("button", { name: w.ana.name })).toHaveCount(0);

      // No match → an explicit "no results" message instead of the full list.
      await input.fill("zzzz-no-existe");
      await expect(listbox.getByText("No professionals found.")).toBeVisible();

      // Picking from the filtered list selects the professional.
      await pickInvoiceLineProfessional(page, 0, w.bea.name);
      await expect(input).toHaveValue(w.bea.name);
    });

    test("AC4 · los pagos deben sumar lo facturado + la propina (UI: monto por defecto, pendiente y emisión)", async ({
      page,
    }) => {
      await loginAdminUi(page, w);
      await openNewInvoice(page);
      await pickServiceLine(page, w.service.name, 0);
      await showPaymentAmounts(page);
      const total = parseGs(await page.locator("#pay-amount-0").inputValue());
      expect(total).toBeGreaterThan(0);

      await openLineMoreOptions(page, 0);
      await pickInvoiceLineProfessional(page, 0, w.ana.name);
      await openMoreOptions(page);
      await page.locator(`#billing-tip-${w.ana.id}`).fill("5000");

      // The amount to collect is the invoiced total plus the tip, and the first payment follows it.
      const withTip = fmtGs(total + 5000);
      await expect(page.getByTestId("billing-amount-to-collect")).toHaveText(withTip);
      await expect(page.locator("#pay-amount-0")).toHaveValue(withTip);
      // Nothing is left to assign (the "Remaining" row, shown for split payments, is settled at 0).
      await expect(page.getByText("Remaining", { exact: true }).locator("xpath=..")).toHaveClass(/text-success/);

      // Paying only the invoiced total (without the tip) leaves the tip as "Remaining"…
      await fillPaymentAmount(page, String(total));
      await expect(page.getByText("Remaining", { exact: true }).locator("xpath=..")).toContainText("5.000");

      // …and the server rejects it with the translated error.
      await ensurePaymentMethodChosen(page);
      await page.getByRole("button", { name: "Issue invoice" }).click();
      await expect(
        page.getByText("The sum of payment amounts must equal the invoice total plus the tip (if any).", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      // Total + tip is accepted; the invoice keeps the tip out of its fiscal total.
      await fillPaymentAmount(page, String(total + 5000));
      const inv = await clickIssueInvoiceAndExpectSuccess(page);
      const issued = await apiGetJson<{
        total: number;
        tipsAmount: number;
        payments: { amount: number }[];
      }>(page.request, w.adminToken, `/api/invoices/${inv.id}`);
      expect(Number(issued.total)).toBe(total);
      expect(Number(issued.tipsAmount)).toBe(5000);
      expect(issued.payments.reduce((s, p) => s + Number(p.amount), 0)).toBe(total + 5000);
    });

    test("AC4 · API: sin propina los pagos igualan el total; con propina, total + propina", async ({ request }) => {
      const body = (amount: number, tip: number | null) => ({
        clientId: null,
        clientDisplayName: "Cliente 384 API",
        clientRucOverride: null,
        discountType: "NONE",
        discountValue: null,
        lines: [
          {
            serviceId: w.service.id,
            description: w.service.name,
            quantity: 1,
            unitPrice: 100000,
            professionalId: w.ana.id,
          },
        ],
        payments: [{ method: "CASH", amount }],
        ...(tip != null ? { tips: [{ professionalId: w.ana.id, amount: tip }], tipsAmount: tip } : {}),
      });
      const post = (data: unknown) =>
        request.post(`${API_BASE}/api/invoices`, { headers: authHeaders(w.adminToken), data });

      // Tip of 8.000 on a 100.000 invoice: 100.000 alone no longer reconciles.
      const missingTip = await post(body(100000, 8000));
      expect(missingTip.status()).toBe(400);
      expect(await missingTip.text()).toContain("PAYMENT_SUM_MISMATCH");

      // Paying more than total + tip doesn't either.
      const tooMuch = await post(body(110000, 8000));
      expect(tooMuch.status()).toBe(400);
      expect(await tooMuch.text()).toContain("PAYMENT_SUM_MISMATCH");

      const ok = await post(body(108000, 8000));
      expect(ok.ok(), await ok.text()).toBeTruthy();

      // Without a tip nothing changes: the payments equal the total.
      const noTip = await post(body(100000, null));
      expect(noTip.ok(), await noTip.text()).toBeTruthy();
      const noTipWrong = await post(body(108000, null));
      expect(noTipWrong.status()).toBe(400);
    });
  });

  test("AC5 · al entrar a Facturación, «Facturas de hoy» se ve desplegada con todas las facturas", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const names = [`E2E384 A ${Date.now()}`, `E2E384 B ${Date.now()}`];
    const ids: number[] = [];
    for (const name of names) {
      ids.push(await issueSimpleInvoice(request, token, seed.serviceId, seed.serviceFullName, name));
    }

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);

    await expect(page.getByTestId("billing-today-toggle")).toHaveAttribute("aria-expanded", "true");
    for (const id of ids) {
      await expect(page.getByTestId(`billing-today-row-${id}`)).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "View full history" })).toBeVisible();
  });
});

async function issueSimpleInvoice(
  request: APIRequestContext,
  token: string,
  serviceId: number,
  description: string,
  clientName: string,
): Promise<number> {
  const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
    clientId: null,
    clientDisplayName: clientName,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [{ serviceId, description, quantity: 1, unitPrice: 30000, discountType: null, discountValue: null }],
    payments: [{ method: "CASH", amount: 30000 }],
  });
  return inv.id;
}
