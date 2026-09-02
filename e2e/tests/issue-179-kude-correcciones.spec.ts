import { createRequire } from "node:module";
import { expect, test, type APIRequestContext } from "@playwright/test";

const nodeRequire = createRequire(import.meta.url);
const pdfParse = nodeRequire("pdf-parse/lib/pdf-parse.js") as (
  data: Buffer,
) => Promise<{ text: string }>;

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

// Issue #179 "Cambios en factura electrónica Parte 2 - CORRECCIÓN" — all three items are KuDE PDF
// layout:
//   1. Tarjeta Diplomática KuDE: Subtotal / Total de la operación / Total en Guaraníes must fall in
//      the "Exentas" column, not "10%".
//   2. Bigger logo box, taken from the address column; the RUC/Timbrado column keeps its size.
//   3. The sale / receiver header grid is packed two-up (more compact).
//
// Per the same convention the sifen-hu-08 spec documents, exact PDF geometry (which column a value
// sits under, column widths, logo box height, two-up row alignment) is verified in
// SifenKudePdfServiceTest via a coordinate-aware content-stream parser — a JUnit assertion is
// strictly better suited than pdf-parse/OCR for that. These e2e tests cover the end-to-end path:
// a real diplomatic invoice's KuDE downloads and shows the exonerated amounts, and a normal KuDE
// still carries every header field after the layout rework.

const DEMO_TENANT_ID = 1;
const FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";
const FIXTURE_CERT_RUC = "12345678-9";

async function enableSifen(
  request: APIRequestContext,
  token: string,
  sifenFantasyName: string | null = null,
) {
  await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, true);
  await apiPutJson(request, token, "/api/business-profile", {
    businessName: "Peluqueria E2E 179",
    ruc: FIXTURE_CERT_RUC,
    address: "Avda. Mcal. Lopez 1234",
    phone: "0981123456",
    contactEmail: "contacto@e2e-179.test",
    logoDataUrl: null,
    taxpayerType: "INDIVIDUAL",
    economicActivityCode: "96020",
    economicActivityDescription: "Peluqueria y otros tratamientos de belleza",
    sifenDepartmentCode: "12",
    sifenDepartmentName: "CENTRAL",
    sifenCityCode: "5044",
    sifenCityName: "FERNANDO DE LA MORA",
    sifenFantasyName,
    kudeFooterMessage: null,
  });
  const certRes = await request.post(
    `${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`,
  );
  expect(certRes.ok(), await certRes.text()).toBeTruthy();
}

async function kudeText(
  request: APIRequestContext,
  token: string,
  invoiceId: number,
  opts: { sample?: boolean } = {},
) {
  await request.post(
    `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoiceId}/prepare-as-approved`,
  );
  const res = await request.get(
    `${apiBaseUrl()}/api/invoices/${invoiceId}/sifen/kude${opts.sample ? "?sample=true" : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
  const pdf = Buffer.from(await res.body());
  expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  return (await pdfParse(pdf)).text;
}

test.describe("Issue #179 · KuDE — correcciones de layout", () => {
  test.afterEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG_KEY, false);
  });

  test("item 1 · a diplomatic KuDE shows the exonerated (net) totals and no IVA", async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await enableSifen(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    // 55.000 IVA-incluido → 50.000 net (exonerado).
    const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: "MISION DIPLOMATICA",
      clientRucOverride: null,
      clientIdentityDocumentOverride: "DIP-0179",
      clientIdentityDocumentTypeOverride: "TARJETA_DIPLOMATICA",
      email: "diplo179@example.com",
      lines: [
        { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 55000 },
      ],
      payments: [{ method: "CASH", amount: 50000 }],
    });

    const text = await kudeText(request, token, inv.id);

    // The totals appear, net of IVA, and the IVA liquidation is zero for a fully exonerated sale.
    expect(text).toContain("Subtotal");
    expect(text).toContain("Total de la operación");
    expect(text).toContain("Total en Guaraníes");
    expect(text).toContain("50.000");
    expect(text).not.toContain("55.000");
    // "Exentas" column header still rendered.
    expect(text).toContain("Exentas");
  });

  test("item 2 & 3 · a normal KuDE keeps every header/sale field after the layout rework", async ({
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
      clientDisplayName: "CLIENTE 179",
      clientRucOverride: "80000005-6",
      clientIdentityDocumentOverride: null,
      email: "cliente179@example.com",
      lines: [
        { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 55000 },
      ],
      payments: [{ method: "CASH", amount: 55000 }],
    });

    const text = await kudeText(request, token, inv.id);

    for (const field of [
      "RUC",
      "Timbrado N",
      "Fecha de Inicio de Vigencia",
      "Factura electrónica",
      "Fecha y hora de Emisión",
      "Condición de Venta",
      "Moneda",
      "Tipo de Operación",
      "RUC del Cliente",
      "Nombre o Razón Social",
    ]) {
      expect(text, `KuDE must still contain "${field}"`).toContain(field);
    }
  });

  test("el nombre de fantasía aparece destacado en el encabezado, con la razón social debajo", async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await enableSifen(request, token, "Peluquería Lucía");
    const seed = await seedCategoryServiceProfessional(request, token);

    const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: "CLIENTE FANTASIA",
      clientRucOverride: "80000005-6",
      clientIdentityDocumentOverride: null,
      email: "fantasia179@example.com",
      lines: [
        { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 55000 },
      ],
      payments: [{ method: "CASH", amount: 55000 }],
    });

    // Production-style sample (e2e runs against SIFEN test env, so only the sample carries the
    // real razón social, not the D105 §10 legend): fantasy name on top, razón social below it.
    const sampleText = await kudeText(request, token, inv.id, { sample: true });
    expect(sampleText).toContain("Peluquería Lucía");
    expect(sampleText).toContain("Peluqueria E2E 179");
    expect(sampleText.indexOf("Peluquería Lucía")).toBeLessThan(
      sampleText.indexOf("Peluqueria E2E 179"),
    );
  });
});
