import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi, setTenantFeatureFlag } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";

// When the SIFEN_ELECTRONIC_INVOICING feature flag is off for a tenant, the New Invoice form
// must not show SIFEN-only copy/fields: the issue-date legend about the ±30/±5 day SIFEN
// submission window, and the client email field + its KuDE hint (the KuDE only exists when
// SIFEN is active).

const DEMO_TENANT_ID = 1;
const FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";

async function clearTenantFlag(request: APIRequestContext) {
  const token = await loginPlatformAdminApi(request);
  const res = await request.delete(
    `${apiBaseUrl()}/api/admin/feature-flags/tenants/${DEMO_TENANT_ID}/${FLAG_KEY}`,
    { headers: authHeaders(token) },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function openNewInvoiceForm(page: Page) {
  await page.goto("/app/billing");
  await ensureCashSessionOpen(page);
  await page.getByRole("tab", { name: "Cash Register" }).click();
  await page.getByRole("button", { name: "New Invoice" }).click();
}

test.describe("New Invoice · SIFEN-only hints hidden when the feature flag is off", () => {
  test.afterEach(async ({ request }) => {
    // Restore inherit (global default ON) so sibling SIFEN specs aren't polluted.
    await clearTenantFlag(request);
  });

  test("con el flag SIFEN apagado, no se muestran el mensaje de ventana de fechas ni el campo de email del cliente", async ({
    page,
    request,
  }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, false);

    await loginAsDemo(page);
    await openNewInvoiceForm(page);

    await expect(
      page.getByText(
        "The document may be dated up to 30 days in the past or 5 days in the future relative to its submission to SIFEN.",
      ),
    ).toHaveCount(0);

    await expect(page.locator("#billing-client-email")).toHaveCount(0);
    await expect(page.locator("#billing-client-email-hint")).toHaveCount(0);
  });
});
