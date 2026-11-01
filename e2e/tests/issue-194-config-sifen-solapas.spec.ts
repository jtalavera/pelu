import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  loginAsDemoApi,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { openManualVoidingForm, unfoldSifen } from "../fixtures/ui";

const DEMO_TENANT_ID = 1;
const SIFEN_FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";

// Issue #194 — "Ajustes Configuración → SIFEN":
//   1. The screen is split into tabs (same pattern as Facturación's "Caja" / "Historial"):
//      - "Certificado": the upload form + info, and the loaded-certificates table.
//      - "Numeración inutilizada": the "Registrar inutilización manual" option FIRST, then the
//        table with every pending/approved voided-numbering row (unchanged).
//   2. The voided-numbering table is paginated, like the "Historial de comprobantes" table.

async function seedManualVoidings(request: APIRequestContext, token: string, howMany: number) {
  await ensureActiveFiscalStampForInvoices(request, token);
  // A high, unique-per-run base well above any issued invoice number, inside the stamp range.
  const base = 7_000_000 + (Date.now() % 800_000);
  for (let i = 0; i < howMany; i++) {
    const from = base + i * 30;
    await apiPostJson(request, token, "/api/sifen/number-voiding", {
      rangeFrom: from,
      rangeTo: from + 2,
      reason: `Rango no utilizado ${i} (issue 194 e2e)`,
    });
  }
}

test.describe("Issue #194 · Configuración → SIFEN por solapas", () => {
  // Configuración → SIFEN is itself gated on this tenant flag — self-contained rather than
  // relying on some earlier spec having left it on.
  test.beforeEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, true);
  });
  test.afterEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, false);
  });

  test("AC1 · la pantalla se organiza en secciones plegables 'Certificado', 'Código de seguridad (CSC)' y 'Numeración inutilizada'", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");

    // Redesign: the three sections are folds (not tabs).
    const certFold = page.getByTestId("sifen-fold-certificate");
    const cscFold = page.getByTestId("sifen-fold-csc");
    const voidingFold = page.getByTestId("sifen-fold-numberVoiding");
    await expect(certFold).toBeVisible();
    await expect(cscFold).toBeVisible();
    await expect(voidingFold).toBeVisible();

    // "Certificate" is open by default: the (read-only) list is visible — the upload belongs to
    // the platform's root user — and the voiding section is closed.
    await expect(certFold).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("sifen-certificate-list-section")).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-upload-section")).toHaveCount(0);
    await expect(voidingFold).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("sifen-number-voiding-section")).toBeHidden();

    // Opening "Voided numbering" shows the voiding content.
    await voidingFold.click();
    await expect(voidingFold).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("sifen-number-voiding-section")).toBeVisible();
  });

  test("AC1 · en 'Numeración inutilizada' el alta manual se abre desde un enlace bajo la lista y muestra su formulario", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await seedManualVoidings(request, token, 1);

    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await unfoldSifen(page, "numberVoiding");

    // Redesign: the manual-registration option is a link under the list that opens a dialog.
    const open = page.getByTestId("sifen-number-voiding-manual-open");
    const firstRow = page.getByTestId("sifen-number-voiding-row").first();
    await expect(open).toBeVisible();
    await expect(firstRow).toBeVisible();
    const openBox = await open.boundingBox();
    const rowBox = await firstRow.boundingBox();
    expect(openBox!.y).toBeGreaterThan(rowBox!.y);
    const form = await openManualVoidingForm(page);
    await expect(form.locator("#manual-range-from")).toBeVisible();
    await expect(form.locator("#manual-range-to")).toBeVisible();
  });

  test("AC2 · la tabla de numeración inutilizada está paginada como el historial de comprobantes", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await seedManualVoidings(request, token, 11);

    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await unfoldSifen(page, "numberVoiding");

    const section = page.getByTestId("sifen-number-voiding-section");
    await expect(page.getByTestId("sifen-number-voiding-row").first()).toBeVisible();

    // Default page size is 10 — exactly one page's worth of rows shown.
    await expect(page.getByTestId("sifen-number-voiding-row")).toHaveCount(10);

    // Rows-per-page selector with the project-standard options, and a page navigator.
    const pageSize = section.getByRole("combobox");
    await expect(pageSize).toBeVisible();
    await expect(pageSize.locator("option")).toHaveText(["10", "25", "50"]);
    await expect(section.getByText(/1–10 of \d+/)).toBeVisible();
    await expect(section.getByRole("button", { name: "Next" })).toBeEnabled();

    // Raising the page size shows more rows without leaving the screen.
    await pageSize.selectOption("50");
    await expect
      .poll(async () => page.getByTestId("sifen-number-voiding-row").count())
      .toBeGreaterThan(10);
  });
});
