import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  loginAsDemoApi,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { unfoldSifen } from "../fixtures/ui";

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

  test("la acción de alta manual va debajo de la lista de numeración inutilizada", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await seedManualVoiding(request, token);

    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await unfoldSifen(page, "numberVoiding");

    // Redesign: the fold label is the section title; the lead paragraph sits above the list and
    // "+ Register a manual voiding" is the last element of the section.
    const section = page.getByTestId("sifen-number-voiding-section");
    const lead = section.locator("p, span").first();
    const firstRow = page.getByTestId("sifen-number-voiding-row").first();
    const open = page.getByTestId("sifen-number-voiding-manual-open");
    await expect(firstRow).toBeVisible();
    await expect(open).toBeVisible();
    await expect(lead).toBeVisible();

    const leadBox = (await lead.boundingBox())!;
    const rowBox = (await firstRow.boundingBox())!;
    const openBox = (await open.boundingBox())!;
    expect(leadBox.y).toBeLessThan(rowBox.y);
    expect(openBox.y).toBeGreaterThan(rowBox.y);
  });
});
