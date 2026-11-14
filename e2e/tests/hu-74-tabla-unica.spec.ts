import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import {
  apiBaseUrl,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { goToBillingHome } from "../fixtures/billing";

// HU-74 · Una sola tabla para todo el sistema (look de Propinas): Hoy y Propinas usan el
// mismo componente `DataTable`; aquí se comprueba que se ven y se comportan igual.

const DEMO_TENANT_ID = 1;
const SIFEN_FLAG = "SIFEN_ELECTRONIC_INVOICING";

type Seed = Awaited<ReturnType<typeof seedCategoryServiceProfessional>>;

async function createInvoice(request: APIRequestContext, token: string, seed: Seed, label: string) {
  const fullName = `${label} ${Date.now()}`;
  const client = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
    fullName,
    phone: null,
    email: null,
    ruc: null,
  });
  const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
    clientId: client.id,
    clientDisplayName: fullName,
    clientRucOverride: null,
    clientIdentityDocumentOverride: null,
    lines: [{ serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 45000 }],
    payments: [{ method: "CASH", amount: 45000 }],
  });
  const res = await request.post(
    `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-with-status/APPROVED`,
  );
  expect(res.ok(), await res.text()).toBeTruthy();
  return invoice;
}

/** What a header looks like on screen: the three screens must match. */
async function headerLook(table: Locator) {
  return table.locator("thead th").first().evaluate((th) => {
    const s = getComputedStyle(th);
    return { fontSize: s.fontSize, textTransform: s.textTransform, color: s.color, fontWeight: s.fontWeight };
  });
}

async function firstRowHeight(table: Locator) {
  return (await table.locator("tbody tr").first().boundingBox())!.height;
}

test.describe("HU-74 · Una sola tabla para todo el sistema", () => {
  let token: string;
  let seed: Seed;
  let invoiceId: number;
  let professionalId: number;

  test.beforeEach(async ({ request }) => {
    token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG, false);
    seed = await seedCategoryServiceProfessional(request, token);
    invoiceId = (await createInvoice(request, token, seed, "E2E HU74")).id;
    const pro = await apiPostJson<{ id: number }>(request, token, "/api/professionals", {
      fullName: `Zzhu74 ${Date.now()}`,
      phone: null,
      email: null,
      photoDataUrl: null,
    });
    professionalId = pro.id;
    await apiPostJson(request, token, "/api/propinas/manual", {
      professionalId,
      amount: 15000,
      tippedAt: new Date(Date.now() - 3_600_000).toISOString(),
      note: null,
    });
  });

  async function openToday(page: Page) {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToBillingHome(page);
    await expect(page.getByTestId(`billing-today-row-${invoiceId}`)).toBeVisible({ timeout: 30_000 });
  }

  test("AC1 · Hoy y Propinas tienen el mismo encabezado, alto de fila y ⋮", async ({ page }) => {
    test.setTimeout(120_000);
    await openToday(page);
    const today = page.locator("table[data-testid=billing-today-table]");
    const todayLook = await headerLook(today);
    expect(todayLook.textTransform).toBe("uppercase");
    expect(todayLook.fontSize).toBe("11px");
    expect(await firstRowHeight(today)).toBeGreaterThanOrEqual(44);
    const todayMenu = page.getByTestId(`billing-today-menu-${invoiceId}-trigger`);
    await expect(todayMenu).toHaveClass(/border-transparent/);
    await expect(todayMenu.locator("svg circle")).toHaveCount(3);

    await page.goto("/app/propinas");
    const propinas = page.getByTestId("propinas-table");
    await expect(propinas).toBeVisible({ timeout: 20_000 });
    expect(await headerLook(propinas)).toEqual(todayLook);
    expect(await firstRowHeight(propinas)).toBeGreaterThanOrEqual(44);
    await expect(propinas.getByTestId("propinas-movement-amount").first()).toBeVisible();
  });

  test("AC2 · la fila se abre con clic o Enter y el ⋮ no la abre", async ({ page }) => {
    test.setTimeout(90_000);
    await openToday(page);
    const row = page.getByTestId(`billing-today-row-${invoiceId}`);

    await page.getByTestId(`billing-today-menu-${invoiceId}-trigger`).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await row.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("AC4 · en el celular Hoy y Propinas se muestran como tarjetas", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 375, height: 800 });
    await openToday(page);
    await expect(page.locator("table[data-testid=billing-today-table]")).toHaveCount(0);
    await expect(page.getByTestId(`billing-today-menu-${invoiceId}-trigger`)).toBeVisible();

    await page.goto("/app/propinas");
    await expect(page.getByTestId("propinas-movements-cards")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("propinas-table")).toHaveCount(0);
  });

  test("AC7 · la tabla ya no ofrece ordenar ni elegir columnas", async ({ page }) => {
    test.setTimeout(90_000);
    await openToday(page);
    const today = page.locator("table[data-testid=billing-today-table]");
    await expect(today.locator("thead button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /columns/i })).toHaveCount(0);
  });
});
