import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiGetJson,
  apiPostJson,
  apiPostJsonStatus,
  loginAsDemoApi,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { filterPropinasByProfessional, propinasMovements } from "../fixtures/propinas";

/**
 * Propinas: buscador sobre «Propina acumulada por profesional» (con el total de lo que se ve) y
 * propinas manuales (solo el admin del salón; se pueden editar o anular; todo queda en auditoría).
 */

test.describe.configure({ mode: "serial" });

type Pro = { id: number; fullName: string };

async function seedProfessional(request: APIRequestContext, token: string, fullName: string): Promise<Pro> {
  return apiPostJson<Pro>(request, token, "/api/professionals", {
    fullName,
    phone: null,
    email: null,
    photoDataUrl: null,
  });
}

type ManualTipResult = { tip: { id: number }; newBalance: number };

async function seedManualTip(
  request: APIRequestContext,
  token: string,
  professionalId: number,
  amount: number,
  note: string | null = null,
): Promise<ManualTipResult> {
  return apiPostJson<ManualTipResult>(request, token, "/api/propinas/manual", {
    professionalId,
    amount,
    tippedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    note,
  });
}

async function openPropinas(page: Page): Promise<void> {
  await loginAsDemo(page);
  await page.goto("/app/propinas");
  // One loading state, then everything at once.
  await expect(page.getByTestId("propinas-cards")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("propinas-movements")).toBeVisible();
}

async function searchProfessional(page: Page, text: string): Promise<void> {
  await page.getByTestId("propinas-balances-search-input").fill(text);
  await page.getByTestId("propinas-balances-search-input").press("Enter");
}

test.describe("Buscador de profesionales con total acumulado", () => {
  test("filtra la lista al buscar (Enter o botón) y el total refleja lo que se ve", async ({ page, request }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    const stamp = Date.now();
    const alfa = await seedProfessional(request, token, `Zzbus Alfa ${stamp}`);
    const beta = await seedProfessional(request, token, `Zzbus Beta ${stamp}`);
    await seedManualTip(request, token, alfa.id, 12000);
    await seedManualTip(request, token, beta.id, 5000);

    await openPropinas(page);
    const total = page.getByTestId("propinas-balances-total");
    await expect(total).toContainText(/Total accumulated · \d+ professionals/);

    // Enter in the field searches, ignoring case.
    await searchProfessional(page, `zzbus alfa ${stamp}`);
    await expect(page.getByTestId(`propinas-card-${alfa.id}`)).toBeVisible();
    await expect(page.getByTestId(`propinas-card-${beta.id}`)).toHaveCount(0);
    await expect(total).toContainText(/1 of \d+ professionals/);
    await expect(page.getByTestId("propinas-balances-total-amount")).toHaveText("Gs. 12.000");

    // The button does the same; a broader term shows both and adds their totals.
    await page.getByTestId("propinas-balances-search-input").fill(`zzbus`);
    await page.getByTestId("propinas-balances-search-submit").click();
    await expect(page.getByTestId(`propinas-card-${alfa.id}`)).toBeVisible();
    await expect(page.getByTestId(`propinas-card-${beta.id}`)).toBeVisible();
    await expect(page.getByTestId("propinas-balances-total-amount")).toHaveText("Gs. 17.000");

    // Nobody matches: clear message and a Gs. 0 total.
    await searchProfessional(page, `nadie-${stamp}`);
    await expect(page.getByTestId("propinas-balances-no-match")).toContainText(`nadie-${stamp}`);
    await expect(page.getByTestId("propinas-balances-total-amount")).toHaveText("Gs. 0");

    // Clearing restores the whole list; Movimientos was never affected by the search.
    await page.getByTestId("propinas-balances-search-clear").click();
    await expect(page.getByTestId("propinas-balances-no-match")).toHaveCount(0);
    await expect(total).toContainText(/Total accumulated · \d+ professionals/);
    await expect(page.getByTestId("propinas-movements")).toBeVisible();
  });
});

test.describe("Propina manual (solo admin)", () => {
  test("el «+» de la fila abre el diálogo con la profesional elegida y suma al acumulado", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    const stamp = Date.now();
    const pro = await seedProfessional(request, token, `Zzman Uno ${stamp}`);

    await openPropinas(page);
    await searchProfessional(page, `zzman uno ${stamp}`);
    await expect(page.getByTestId(`propinas-balance-${pro.id}`)).toHaveText("Gs. 0");
    await page.getByTestId(`propinas-add-${pro.id}`).click();

    const dialog = page.getByTestId("propinas-manual-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("propinas-manual-professional")).toHaveValue(String(pro.id));
    await expect(page.getByTestId("propinas-manual-date")).not.toHaveValue("");

    // Validation first: message states the rule and an example, nothing is sent.
    await page.getByTestId("propinas-manual-confirm").click();
    await expect(page.locator("#propinas-manual-amount-err")).toHaveText(
      "The amount must be greater than 0. Example: 20.000",
    );
    await expect(dialog).toBeVisible();

    await page.getByTestId("propinas-manual-amount").fill("20000");
    await page.getByTestId("propinas-manual-note").fill("Propina en efectivo");
    await expect(page.getByTestId("propinas-manual-new-balance-amount")).toHaveText("Gs. 20.000");
    await page.getByTestId("propinas-manual-confirm").click();
    await expect(page.getByTestId("propinas-toast")).toContainText("Manual tip added.");
    await expect(dialog).toHaveCount(0);

    // The accumulated balance grew and the movement is listed; the table stays simple: «Manual tip»,
    // without the note (that is a tooltip) or who loaded it.
    await expect(page.getByTestId(`propinas-balance-${pro.id}`)).toHaveText("Gs. 20.000");
    await filterPropinasByProfessional(page, pro.fullName);
    const row = propinasMovements(page);
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-manual", "true");
    await expect(row.getByTestId("propinas-movement-concept")).toHaveText("Manual tip");
    await expect(row).not.toContainText("Propina en efectivo");
    await expect(row.locator("td[title]")).toHaveAttribute("title", /Propina en efectivo/);
    await expect(row).toContainText("Gs. 20.000");
  });

  test("«Agregar propina» del encabezado pide la profesional y no admite fechas futuras", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    const stamp = Date.now();
    const pro = await seedProfessional(request, token, `Zzman Dos ${stamp}`);

    await openPropinas(page);
    // The button is in the page header (next to the title), not in the Movimientos card.
    await expect(page.locator("div:has(> h1)").getByTestId("propinas-add-manual")).toBeVisible();
    await expect(page.getByTestId("propinas-movements").getByTestId("propinas-add-manual")).toHaveCount(0);
    await page.getByTestId("propinas-add-manual").click();
    await expect(page.getByTestId("propinas-manual-professional")).toHaveValue("");

    await page.getByTestId("propinas-manual-confirm").click();
    await expect(page.locator("#propinas-manual-professional-err")).toHaveText("Select a professional.");

    await page.getByTestId("propinas-manual-professional").selectOption(String(pro.id));
    await page.getByTestId("propinas-manual-amount").fill("8000");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const tomorrowYmd = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(
      tomorrow.getDate(),
    ).padStart(2, "0")}`;
    await page.getByTestId("propinas-manual-date").fill(tomorrowYmd);
    await page.getByTestId("propinas-manual-confirm").click();
    await expect(page.locator("#propinas-manual-date-err")).toContainText("cannot be in the future");

    // Back to today: it goes through.
    const today = new Date();
    const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`;
    await page.getByTestId("propinas-manual-date").fill(todayYmd);
    await page.getByTestId("propinas-manual-confirm").click();
    await expect(page.getByTestId("propinas-toast")).toContainText("Manual tip added.");
    await searchProfessional(page, `zzman dos ${stamp}`);
    await expect(page.getByTestId(`propinas-balance-${pro.id}`)).toHaveText("Gs. 8.000");
  });

  test("se puede editar y anular (con motivo obligatorio); lo anulado queda visible y deja de contar", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await loginAsDemoApi(request);
    const stamp = Date.now();
    const pro = await seedProfessional(request, token, `Zzman Tres ${stamp}`);
    await seedManualTip(request, token, pro.id, 20000, `Nota ${stamp}`);

    await openPropinas(page);
    await searchProfessional(page, `zzman tres ${stamp}`);
    await expect(page.getByTestId(`propinas-balance-${pro.id}`)).toHaveText("Gs. 20.000");
    await filterPropinasByProfessional(page, pro.fullName);
    const row = propinasMovements(page);
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("propinas-movement-concept")).toHaveText("Manual tip");

    // Edit: the professional is fixed, the amount can change.
    await row.getByRole("button").click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByTestId("propinas-manual-professional")).toBeDisabled();
    await expect(page.getByTestId("propinas-manual-amount")).toHaveValue("20.000");
    await page.getByTestId("propinas-manual-amount").fill("30000");
    await expect(page.getByTestId("propinas-manual-new-balance-amount")).toHaveText("Gs. 30.000");
    await page.getByTestId("propinas-manual-confirm").click();
    await expect(page.getByTestId("propinas-toast")).toContainText("Manual tip updated.");
    await expect(page.getByTestId(`propinas-balance-${pro.id}`)).toHaveText("Gs. 30.000");
    await expect(row).toContainText("Gs. 30.000");

    // Void: the reason is mandatory.
    await row.getByRole("button").click();
    await page.getByRole("menuitem", { name: "Void" }).click();
    await page.getByTestId("propinas-void-confirm").click();
    await expect(page.locator("#propinas-void-reason-err")).toHaveText(
      "Enter the reason for voiding. Example: Amount entered wrong",
    );
    await page.getByTestId("propinas-void-reason").fill("Monto mal cargado");
    await page.getByTestId("propinas-void-confirm").click();
    await expect(page.getByTestId("propinas-toast")).toContainText("Manual tip voided.");

    // It no longer counts, but stays listed as «Voided» with who and why, and has no actions left.
    await expect(page.getByTestId(`propinas-balance-${pro.id}`)).toHaveText("Gs. 0");
    const voided = propinasMovements(page);
    await expect(voided).toHaveAttribute("data-voided", "true");
    await expect(voided.getByTestId("propinas-voided-tag")).toBeVisible();
    // The table does not show the reason; it is in the tooltip.
    await expect(voided).not.toContainText("Monto mal cargado");
    await expect(voided.locator("td[title]")).toHaveAttribute("title", /Monto mal cargado/);
    await expect(voided.getByRole("button")).toHaveCount(0);
  });

  test("el API valida con códigos propios y todo queda en auditoría", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const stamp = Date.now();
    const pro = await seedProfessional(request, token, `Zzman Audit ${stamp}`);
    const tippedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const bad = await apiPostJsonStatus(request, token, "/api/propinas/manual", {
      professionalId: pro.id,
      amount: 0,
      tippedAt,
      note: null,
    });
    expect(bad.status).toBe(400);
    expect(bad.text).toContain("MANUAL_TIP_AMOUNT_INVALID");

    const created = await seedManualTip(request, token, pro.id, 4000, "auditar");
    const voidNoReason = await apiPostJsonStatus(
      request,
      token,
      `/api/propinas/manual/${created.tip.id}/void`,
      { reason: " " },
    );
    expect(voidNoReason.status).toBe(400);
    expect(voidNoReason.text).toContain("MANUAL_TIP_VOID_REASON_REQUIRED");

    const voided = await apiPostJson<ManualTipResult>(
      request,
      token,
      `/api/propinas/manual/${created.tip.id}/void`,
      { reason: "Prueba de auditoría" },
    );
    expect(voided.newBalance).toBe(0);
    const again = await apiPostJsonStatus(request, token, `/api/propinas/manual/${created.tip.id}/void`, {
      reason: "otra vez",
    });
    expect(again.status).toBe(409);
    expect(again.text).toContain("MANUAL_TIP_ALREADY_VOIDED");

    // The audit trail records who created and who voided it.
    type AuditPage = { content: Array<{ httpMethod: string; operation: string | null; entityId: string | null }> };
    const audit = await apiGetJson<AuditPage>(request, token, "/api/audit?resource=propinas&size=100");
    expect(audit.content.some((r) => r.httpMethod === "POST" && r.operation === "manual")).toBeTruthy();
    expect(
      audit.content.some(
        (r) => r.httpMethod === "POST" && r.operation === "void" && r.entityId === String(created.tip.id),
      ),
    ).toBeTruthy();
  });
});
