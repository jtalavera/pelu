import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  loginAsDemoApi,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

const DEMO_TENANT_ID = 1;
const SIFEN_FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";

// Issue #196 — "Ajustes Configuración → SIFEN":
//   In Configuración → SIFEN → "Numeración inutilizada", the section title
//   ("Voided document numbers" / "Numeración inutilizada") and its lead paragraph must sit
//   just above the voided-numbers table — NOT above the "Register a manual voiding" title.

async function seedManualVoiding(request: APIRequestContext, token: string) {
  await ensureActiveFiscalStampForInvoices(request, token);
  const from = 7_000_000 + (Date.now() % 800_000);
  await apiPostJson(request, token, "/api/sifen/number-voiding", {
    rangeFrom: from,
    rangeTo: from + 2,
    reason: "Rango no utilizado (issue 196 e2e)",
  });
}

test.describe("Issue #196 · Configuración → SIFEN, reorden del título", () => {
  // Configuración → SIFEN is itself gated on this tenant flag — self-contained rather than
  // relying on some earlier spec having left it on.
  test.beforeEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, true);
  });
  test.afterEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, false);
  });

  test("el título 'Numeración inutilizada' va debajo del alta manual y encima de la tabla", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await seedManualVoiding(request, token);

    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await page.getByRole("tab", { name: "Voided numbering" }).click();

    const section = page.getByTestId("sifen-number-voiding-section");
    const manualTitle = section.getByText("Register a manual voiding", { exact: true });
    const sectionTitle = section.getByText("Voided document numbers", { exact: true });
    const firstRow = page.getByTestId("sifen-number-voiding-row").first();

    await expect(manualTitle).toBeVisible();
    await expect(sectionTitle).toBeVisible();
    await expect(firstRow).toBeVisible();

    const manualBox = await manualTitle.boundingBox();
    const titleBox = await sectionTitle.boundingBox();
    const rowBox = await firstRow.boundingBox();
    expect(manualBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(rowBox).not.toBeNull();

    // Section title sits below the manual-voiding title…
    expect(titleBox!.y).toBeGreaterThan(manualBox!.y);
    // …and above the table.
    expect(titleBox!.y).toBeLessThan(rowBox!.y);
  });
});
