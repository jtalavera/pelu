import { expect, test } from "@playwright/test";
import { API_BASE, authHeaders, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { goToInvoiceHistory } from "../fixtures/billing";
import {
  enableCommissionsGlobally,
  openCommissionsMore,
  restoreCommissionsGlobal,
} from "../fixtures/commissions";

/**
 * Buscadores con fecha:
 *  - «Desde» arranca un mes atrás de la fecha actual;
 *  - el máximo posible es 1 año: ninguna búsqueda devuelve información de más de un año
 *    (un «desde» más viejo se rechaza con 400 DATE_RANGE_TOO_OLD o su equivalente por pantalla).
 */
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const monthAgo = new Date(
  today.getFullYear(),
  today.getMonth() - 1,
  Math.min(today.getDate(), new Date(today.getFullYear(), today.getMonth(), 0).getDate()),
);
const tooOld = new Date(today.getFullYear() - 1, today.getMonth() - 1, today.getDate());
/** How LocalizedDateInput shows a date in English (MM/DD/YYYY). */
const mdy = (d: Date) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
const inYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 2);

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});
test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.describe("Buscadores con fecha · «Desde» un mes atrás y tope de 1 año", () => {
  test("Fichas de servicio: «Desde» arranca un mes atrás y «Hasta» es hoy", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await page.getByTestId("service-records-filters-toggle").click();
    await expect(page.locator("#service-record-filter-from")).toHaveValue(ymd(monthAgo));
    await expect(page.locator("#service-record-filter-to")).toHaveValue(ymd(today));
  });

  test("Fichas de servicio: un «Desde» de más de 1 año se rechaza con el mensaje de 1 año", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await page.getByTestId("service-records-filters-toggle").click();
    await page.locator("#service-record-filter-from").fill(ymd(tooOld));
    await expect(page.getByRole("alert")).toContainText(/1 year|1 año/i);
  });

  test("Facturación · Historial: un «Desde» de más de 1 año se rechaza con el mensaje de 1 año", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);
    await page.getByTestId("invoice-history-filters-toggle").click();
    await page.locator("#invoice-history-from").fill(ymd(tooOld));
    await expect(page.getByRole("alert").filter({ hasText: /1 year/i })).toContainText(
      "The start date cannot be more than 1 year in the past.",
      { timeout: 10_000 },
    );
  });

  test("Comisiones: «Desde» arranca un mes atrás en Movimientos, Vista previa y Reportes", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/commissions");
    // (Generating settlements starts from the current commission period instead, set by the backend.)
    await page.getByRole("tab", { name: "Movements", exact: true }).click();
    await page.getByTestId("movements-filters-toggle").click();
    await expect(page.locator("#mov-from")).toHaveValue(mdy(monthAgo));

    await openCommissionsMore(page, "Preview");
    await expect(page.locator("#preview-from")).toHaveValue(mdy(monthAgo));

    await openCommissionsMore(page, "Reports");
    await expect(page.locator("#report-from")).toHaveValue(mdy(monthAgo));
  });

  test("Auditoría: «Desde» arranca un mes atrás y uno de más de 1 año se rechaza con el mensaje de 1 año", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/audit");
    await page.getByTestId("audit-filters-toggle").click();
    const from = page.locator("#audit-from");
    // Native date input: the value is YYYY-MM-DD.
    await expect(from).toHaveValue(ymd(monthAgo));
    await from.fill(ymd(tooOld));
    await page.getByTestId("audit-search").click();
    await expect(page.getByText("The start date cannot be more than 1 year in the past.")).toBeVisible({ timeout: 10_000 });
  });

  test("API: ninguna búsqueda devuelve información de más de 1 año", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const get = (path: string) => request.get(`${API_BASE}${path}`, { headers: authHeaders(token) });
    const bodyText = async (path: string) => {
      const res = await get(path);
      return { status: res.status(), text: await res.text() };
    };
    const iso = (d: Date) => `${ymd(d)}T00:00:00Z`;
    const to = `${ymd(today)}T23:59:59Z`;

    // «Desde» de más de 1 año → 400 (código por búsqueda).
    for (const [path, code] of [
      [`/api/service-records?from=${iso(tooOld)}&to=${to}`, "SERVICE_RECORD_LIST_RANGE_TOO_OLD"],
      [`/api/invoices?from=${iso(tooOld)}&to=${to}`, "INVOICE_LIST_RANGE_TOO_OLD"],
      [`/api/cash-sessions?from=${iso(tooOld)}&to=${to}`, "DATE_RANGE_TOO_OLD"],
      [`/api/audit?from=${ymd(tooOld)}`, "DATE_RANGE_TOO_OLD"],
      [`/api/propinas/report?from=${iso(tooOld)}&to=${to}`, "DATE_RANGE_TOO_OLD"],
      [`/api/commissions/entries?from=${ymd(tooOld)}&to=${ymd(today)}`, "DATE_RANGE_TOO_OLD"],
      [`/api/commissions/reports?from=${ymd(tooOld)}&to=${ymd(today)}`, "DATE_RANGE_TOO_OLD"],
      [`/api/commissions/settlements?from=${ymd(tooOld)}&to=${ymd(today)}`, "DATE_RANGE_TOO_OLD"],
      [`/api/commissions/lines-without-beneficiary?from=${ymd(tooOld)}&to=${ymd(today)}`, "DATE_RANGE_TOO_OLD"],
    ] as const) {
      const r = await bodyText(path);
      expect(r.status, path).toBe(400);
      expect(r.text, path).toContain(code);
    }

    // Un «desde» dentro del año (con el límite exacto) sí se acepta.
    for (const path of [
      `/api/service-records?from=${iso(inYear)}&to=${to}`,
      `/api/invoices?from=${iso(inYear)}&to=${to}`,
      `/api/cash-sessions?from=${iso(inYear)}&to=${to}`,
      `/api/audit?from=${ymd(inYear)}`,
      `/api/propinas/report?from=${iso(inYear)}&to=${to}`,
      `/api/commissions/entries?from=${ymd(inYear)}&to=${ymd(today)}`,
      `/api/commissions/reports?from=${ymd(inYear)}&to=${ymd(today)}`,
      `/api/commissions/settlements?from=${ymd(inYear)}&to=${ymd(today)}`,
    ]) {
      expect((await get(path)).status(), path).toBe(200);
    }
  });
});
