import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  loginAsDemoApi,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

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
  test("AC1 · la pantalla se organiza en las solapas 'Certificado' y 'Numeración inutilizada'", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");

    const certTab = page.getByRole("tab", { name: "Certificate" });
    const voidingTab = page.getByRole("tab", { name: "Voided numbering" });
    await expect(certTab).toBeVisible();
    await expect(voidingTab).toBeVisible();

    // "Certificado" is the default active solapa: upload + list visible, voiding table hidden.
    await expect(certTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-list-section")).toBeVisible();
    await expect(page.getByTestId("sifen-number-voiding-section")).toBeHidden();

    // Switching to "Numeración inutilizada" hides the certificate content and shows the voiding one.
    await voidingTab.click();
    await expect(voidingTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("sifen-number-voiding-section")).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeHidden();
  });

  test("AC1 · en 'Numeración inutilizada' el formulario de alta manual va antes de la tabla", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await seedManualVoidings(request, token, 1);

    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await page.getByRole("tab", { name: "Voided numbering" }).click();

    const form = page.getByTestId("sifen-number-voiding-manual-form");
    const firstRow = page.getByTestId("sifen-number-voiding-row").first();
    await expect(form).toBeVisible();
    await expect(firstRow).toBeVisible();

    const formBox = await form.boundingBox();
    const rowBox = await firstRow.boundingBox();
    expect(formBox).not.toBeNull();
    expect(rowBox).not.toBeNull();
    // The manual-registration option sits above the table.
    expect(formBox!.y).toBeLessThan(rowBox!.y);
  });

  test("AC2 · la tabla de numeración inutilizada está paginada como el historial de comprobantes", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await seedManualVoidings(request, token, 11);

    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await page.getByRole("tab", { name: "Voided numbering" }).click();

    const section = page.getByTestId("sifen-number-voiding-section");
    await expect(section.getByRole("table")).toBeVisible();

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
