import { expect, test, type Page } from "@playwright/test";
import { apiGetJson } from "../../fixtures/api";
import {
  applyChanges,
  assignToGroup,
  createGroup,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  loginAdminUi,
  openCommissions,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-30 · Liquidar: «Descargar CSV» es un ícono junto al total, con el CSV de este período o de períodos anteriores
 * (requirements/user_stories/HU-COM-30-liquidar-descargar-csv.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-30");
  await applyChanges(request, w.adminToken, [{ scope: "DEFAULT_SERVICE", value: "40" }]);
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id, w.service2.id]);
  await applyChanges(request, w.adminToken, [{ scope: "GROUP_RULE", groupId: g.id, professionalId: w.ana.id, value: "40" }]);
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id }]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  await generateSettlements(request, w.adminToken, [w.ana.id]); // a draft in the current period
});

type Overview = { period: { from: string | null; to: string | null } };

/** The period on screen, as the server tells it (YYYY-MM-DD). */
async function currentPeriod(request: Parameters<typeof apiGetJson>[0]) {
  const o = await apiGetJson<Overview>(request, w.adminToken, "/api/commissions/overview");
  return { from: o.period.from!, to: o.period.to! };
}

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const addMonths = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
/** The date as the English UI shows it: MM/DD/YYYY. */
const mdy = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}`;

async function openLiquidar(page: Page) {
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");
  await expect(page.getByTestId("liquidar-tabs")).toBeVisible();
}

async function csvText(download: import("@playwright/test").Download) {
  return Buffer.concat(await (await download.createReadStream()).toArray()).toString("utf8");
}

// ── AC1 · el ícono junto al total ────────────────────────────────────────────────────────────────

test("AC1 · «Descargar CSV» es un ícono de 44 px junto al total (arriba), ya no un botón en una franja al pie", async ({ page }) => {
  await openLiquidar(page);

  const trigger = page.getByTestId("liquidar-csv");
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-label", "Download settlements CSV");
  const box = (await trigger.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  // It sits in the top row, next to «Total … already paid», above the tabs.
  const total = (await page.getByTestId("liquidar-total").boundingBox())!;
  const tabs = (await page.getByTestId("liquidar-tabs").boundingBox())!;
  expect(box.y).toBeLessThan(tabs.y);
  expect(Math.abs(box.y + box.height / 2 - (total.y + total.height / 2))).toBeLessThan(40);
  // No footer strip with a download button any more (nobody here has «no movements» to list either).
  await expect(page.getByTestId("liquidar-table").getByTestId("liquidar-csv")).toHaveCount(0);
});

// ── AC2 · el menú ────────────────────────────────────────────────────────────────────────────────

test("AC2 · al tocarlo ofrece «este período» (con sus fechas) y «períodos anteriores»", async ({ page, request }) => {
  const p = await currentPeriod(request);
  await openLiquidar(page);
  await page.getByTestId("liquidar-csv").click();

  const menu = page.getByTestId("liquidar-csv-menu");
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("liquidar-csv-period")).toContainText("Download CSV of this period");
  await expect(page.getByTestId("liquidar-csv-period")).toContainText(mdy(p.from));
  await expect(page.getByTestId("liquidar-csv-period")).toContainText(mdy(p.to));
  await expect(page.getByTestId("liquidar-csv-previous")).toContainText("Download CSV of earlier periods");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

// ── AC3 · este período ───────────────────────────────────────────────────────────────────────────

test("AC3 · «este período» descarga al instante un CSV con las liquidaciones de ese período y las fechas en el nombre", async ({ page, request }) => {
  const p = await currentPeriod(request);
  await openLiquidar(page);
  await page.getByTestId("liquidar-csv").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("liquidar-csv-period").click()]);

  expect(download.suggestedFilename()).toBe(`liquidaciones_${p.from}_${p.to}.csv`);
  const text = await csvText(download);
  expect(text).toContain("Settlement ID,Professional,Period from");
  expect(text).toContain(w.ana.name);
});

// ── AC4 · períodos anteriores ────────────────────────────────────────────────────────────────────

test("AC4 · «períodos anteriores» pide desde y hasta (con los tres meses anteriores ya puestos) y descarga ese rango", async ({ page, request }) => {
  const p = await currentPeriod(request);
  await openLiquidar(page);
  await page.getByTestId("liquidar-csv").click();
  await page.getByTestId("liquidar-csv-previous").click();

  const dialog = page.getByTestId("liquidar-csv-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#liquidar-csv-from")).toHaveValue(mdy(addMonths(p.from, -3)));
  await expect(page.locator("#liquidar-csv-to")).toHaveValue(mdy(addDays(p.from, -1)));

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("liquidar-csv-confirm").click()]);
  expect(download.suggestedFilename()).toBe(`liquidaciones_${addMonths(p.from, -3)}_${addDays(p.from, -1)}.csv`);
  const text = await csvText(download);
  // The draft belongs to the current period, which is outside that range: only the header comes.
  expect(text).toContain("Settlement ID,Professional,Period from");
  expect(text).not.toContain(w.ana.name);
  await expect(dialog).toHaveCount(0);
});

test("AC5 · si «Desde» es posterior a «Hasta» lo dice, con un ejemplo, y no descarga", async ({ page }) => {
  await openLiquidar(page);
  await page.getByTestId("liquidar-csv").click();
  await page.getByTestId("liquidar-csv-previous").click();
  await expect(page.getByTestId("liquidar-csv-dialog")).toBeVisible();

  // «From» after «To»: pick a day in the calendar of «From» (a later month than «To»).
  await page.locator("#liquidar-csv-from").fill("12/31/2099");
  await page.getByTestId("liquidar-csv-confirm").click();
  await expect(page.locator("#liquidar-csv-error")).toContainText("«From» cannot be later than «To».");
  await expect(page.locator("#liquidar-csv-error")).toContainText("Example:");
  await expect(page.getByTestId("liquidar-csv-dialog")).toBeVisible();
});

// ── AC6 · la API ─────────────────────────────────────────────────────────────────────────────────

test("AC6 · la API filtra el CSV por from/to y sin ellos trae todas las liquidaciones", async ({ request }) => {
  const p = await currentPeriod(request);
  const base = (await import("../../fixtures/api")).API_BASE;
  const get = async (qs: string) =>
    (await request.get(`${base}/api/commissions/settlements.csv?lang=en${qs}`, { headers: { Authorization: `Bearer ${w.adminToken}` } })).text();

  expect(await get("")).toContain(w.ana.name);
  expect(await get(`&from=${p.from}&to=${p.to}`)).toContain(w.ana.name);
  expect(await get(`&from=${addMonths(p.from, -6)}&to=${addDays(p.from, -1)}`)).not.toContain(w.ana.name);
});

// ── AC7 · celular ────────────────────────────────────────────────────────────────────────────────

test("AC7 · en el celular el ícono se ve y el menú no desborda la página", async ({ page }) => {
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");
  await expect(page.getByTestId("liquidar-tabs")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("liquidar-csv").click();
  await expect(page.getByTestId("liquidar-csv-menu")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
