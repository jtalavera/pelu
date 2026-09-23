import { createRequire } from "node:module";
import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  apiBaseUrl,
  apiPostJson,
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

const nodeRequire = createRequire(import.meta.url);
const pdfParse = nodeRequire("pdf-parse/lib/pdf-parse.js") as (
  data: Buffer,
) => Promise<{ text: string }>;

// Issue #198 "Ajustes mínimos" — three small adjustments:
//   1. In Facturación → "Caja", clicking any row in the "Comprobantes de hoy" table opens the
//      invoice detail (same as the "Historial de comprobantes" table). The "Ver" button is gone.
//   2. In the KuDE PDF the label "Fecha de Inicio de Vigencia" becomes "Inicio de Vigencia".
//   3. Configuración → SIFEN adopts the look & feel of Configuración → Timbrado, and the manual
//      inutilización form mirrors the "Agregar timbrado" form (grid layout + rose primary button).

const DEMO_TENANT_ID = 1;
const FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";
const FIXTURE_CERT_RUC = "12345678-9";

async function enableSifen(request: APIRequestContext, token: string) {
  await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, true);
  await apiPutJson(request, token, "/api/business-profile", {
    businessName: "Peluqueria E2E 198",
    ruc: FIXTURE_CERT_RUC,
    address: "Avda. Mcal. Lopez 1234",
    phone: "0981123456",
    contactEmail: "contacto@e2e-198.test",
    logoDataUrl: null,
    taxpayerType: "INDIVIDUAL",
    economicActivityCode: "96020",
    economicActivityDescription: "Peluqueria y otros tratamientos de belleza",
    sifenDepartmentCode: "12",
    sifenDepartmentName: "CENTRAL",
    sifenCityCode: "5044",
    sifenCityName: "FERNANDO DE LA MORA",
    sifenFantasyName: null,
    kudeFooterMessage: null,
  });
  const certRes = await request.post(
    `${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`,
  );
  expect(certRes.ok(), await certRes.text()).toBeTruthy();
}

async function kudeText(request: APIRequestContext, token: string, invoiceId: number) {
  await request.post(
    `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoiceId}/prepare-as-approved`,
  );
  const res = await request.get(`${apiBaseUrl()}/api/invoices/${invoiceId}/sifen/kude`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const pdf = Buffer.from(await res.body());
  expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  return (await pdfParse(pdf)).text;
}

test.describe("Issue #198 · Ajustes mínimos", () => {
  test("1 · en Caja, hacer click en una fila de 'Comprobantes de hoy' abre el detalle (sin botón Ver)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const inv = await apiPostJson<{ id: number; invoiceNumberFormatted: string }>(
      request,
      token,
      "/api/invoices",
      {
        clientId: null,
        clientDisplayName: `E2E 198 Caja ${Date.now()}`,
        clientRucOverride: null,
        discountType: null,
        discountValue: null,
        lines: [
          {
            serviceId: seed.serviceId,
            description: seed.serviceFullName,
            quantity: 1,
            unitPrice: 12000,
          },
        ],
        payments: [{ method: "CASH", amount: 12000 }],
      },
    );

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "Cash Register" }).click();

    const row = page.getByTestId(`billing-today-row-${inv.id}`);
    await expect(row).toBeVisible({ timeout: 20_000 });

    // The "Ver" button was removed — the whole row is the affordance now.
    await expect(page.getByTestId(`billing-today-view-${inv.id}`)).toHaveCount(0);
    await expect(row).toHaveAttribute("role", "button");

    await row.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(inv.invoiceNumberFormatted);
  });

  test("2 · el KuDE muestra 'Inicio de Vigencia' (no 'Fecha de Inicio de Vigencia')", async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await enableSifen(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: "CLIENTE 198",
      clientRucOverride: "80000005-6",
      clientIdentityDocumentOverride: null,
      email: "cliente198@example.com",
      lines: [
        { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 55000 },
      ],
      payments: [{ method: "CASH", amount: 55000 }],
    });

    const text = await kudeText(request, token, inv.id);

    expect(text).toContain("Inicio de Vigencia");
    expect(text).not.toContain("Fecha de Inicio de Vigencia");
  });

  test.describe("3 · Configuración → SIFEN luce como Configuración → Timbrado", () => {
    test.afterEach(async ({ request }) => {
      await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, false);
    });

    test("los títulos de sección y el botón primario del alta manual coinciden con Timbrado", async ({
      page,
      request,
    }) => {
      const token = await loginAsDemoApi(request);
      await ensureActiveFiscalStampForInvoices(request, token);

      await loginAsDemo(page);

      // Reference: the "Agregar timbrado" form submit button + a section title on the Timbrado page.
      await page.goto("/app/settings/fiscal-stamp");
      const stampSubmit = page
        .getByTestId("fiscal-stamp-create-section")
        .locator('button[type="submit"]');
      await expect(stampSubmit).toBeVisible({ timeout: 20_000 });
      const stampSubmitBg = await stampSubmit.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      const stampTitle = page.getByText("Registered stamps", { exact: true });
      const stampTitleCss = await stampTitle.evaluate((el) => {
        const s = getComputedStyle(el);
        return { textTransform: s.textTransform, fontSize: s.fontSize, letterSpacing: s.letterSpacing };
      });

      // The SIFEN page, "Numeración inutilizada" tab.
      await page.goto("/app/settings/sifen");
      await page.getByRole("tab", { name: "Voided numbering" }).click();

      const manualForm = page.getByTestId("sifen-number-voiding-manual-form");
      await expect(manualForm).toBeVisible();
      // Same three-field grid + a submit button (like "Agregar timbrado").
      await expect(manualForm.locator("#manual-range-from")).toBeVisible();
      await expect(manualForm.locator("#manual-range-to")).toBeVisible();
      await expect(manualForm.locator("#manual-reason")).toBeVisible();

      const manualSubmit = manualForm.locator('button[type="submit"]');
      await expect(manualSubmit).toBeVisible();
      const manualSubmitBg = await manualSubmit.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      expect(manualSubmitBg).toBe(stampSubmitBg);

      const sifenTitle = page.getByText("Register a manual voiding", { exact: true });
      const sifenTitleCss = await sifenTitle.evaluate((el) => {
        const s = getComputedStyle(el);
        return { textTransform: s.textTransform, fontSize: s.fontSize, letterSpacing: s.letterSpacing };
      });
      expect(sifenTitleCss).toEqual(stampTitleCss);

      // And the manual form still works end-to-end via the primary button.
      const base = 7_000_000 + (Date.now() % 700_000);
      await manualForm.locator("#manual-range-from").fill(String(base));
      await manualForm.locator("#manual-range-to").fill(String(base + 2));
      await manualForm.locator("#manual-reason").fill("Rango no utilizado (issue 198 e2e)");
      await manualSubmit.click();
      await expect(page.getByTestId("sifen-number-voiding-manual-success")).toBeVisible();
    });
  });
});
