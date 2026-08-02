import { expect, test } from "@playwright/test";
import {
  apiBaseUrl,
  apiGetJson,
  apiPostJson,
  apiPostJsonStatus,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

// See sifen-hu-18-cargar-certificado.spec.ts for the "sifen-hu-<n>-<slug>" naming rationale.
//
// HU-02's other acceptance criteria (AC-01..AC-04, AC-06, AC-08 — CDC/timbrado/emisor/receptor
// document assembly) have no screen of their own: they're covered by
// SifenInvoiceHeaderServiceTest/SifenDocumentXmlServiceTest on the backend, the same "sin pantalla
// propia" pattern already used by HU-01/HU-05/HU-21. AC-05 (the Gs. 7.000.000 client-identification
// threshold) is wired into the real invoicing flow, so it's covered end-to-end below. AC-07
// (department/city on the receiver, once an address is on file) previously had zero UI to exercise
// it — Client.java already had department/city columns, but no form field ever set them — so this
// story also adds the client form's address + department/city picker (backed by
// GET /api/sifen/geographic-localities, the DNIT catalog search) and covers it here.

test.describe.configure({ mode: "serial" });

test.describe("SIFEN HU-02 · Completar datos de identificación/timbrado/emisor/receptor", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  test("HU-02 · AC-05 factura de Gs. 7.000.000 sin identificar al cliente es rechazada (API)", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const { status, text } = await apiPostJsonStatus(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: null,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 7_000_000,
        },
      ],
      payments: [{ method: "CASH", amount: 7_000_000 }],
    });

    expect(status, text).toBe(400);
    expect(text).toContain("SIFEN_CLIENT_IDENTIFICATION_REQUIRED");
  });

  test("HU-02 · AC-05 misma factura con un documento de identidad del cliente es aceptada (API)", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const { status, text } = await apiPostJsonStatus(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: "Cliente Ocasional",
      clientRucOverride: null,
      clientIdentityDocumentOverride: "4123456",
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 7_000_000,
        },
      ],
      payments: [{ method: "CASH", amount: 7_000_000 }],
    });

    expect(status, text).toBe(201);
  });

  test("HU-02 · AC-05 justo debajo del umbral no exige identificar al cliente (API)", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    const { status, text } = await apiPostJsonStatus(request, token, "/api/invoices", {
      clientId: null,
      clientDisplayName: null,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 6_999_999,
        },
      ],
      payments: [{ method: "CASH", amount: 6_999_999 }],
    });

    expect(status, text).toBe(201);
  });

  test("HU-02 · AC-05 la pantalla de facturación exige y luego acepta la identificación (UI)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("7000000");
    await expect(page.locator("#line-price-0")).toHaveValue("7.000.000");
    await page.locator("#pay-amount-0").fill("7000000");

    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(
      page.getByText(
        "Sales of Gs. 7,000,000 or more require identifying the client with a RUC or an identity document.",
      ),
    ).toBeVisible();

    await page.getByLabel("Client identity document (override for this invoice)").fill("4123456");
    await clickIssueInvoiceAndExpectSuccess(page);
  });

  test("HU-02 · AC-07 crear cliente con dirección y localidad persiste departamento/ciudad (UI)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await loginAsDemo(page);

    await page.goto("/app/clients");
    await page.getByRole("button", { name: "New client" }).click();

    const suffix = `${Date.now()}-${Math.random()}`;
    const fullName = `E2E AC07 ${suffix}`;
    await page.getByLabel("Full name").fill(fullName);
    await page.getByLabel("Address").fill("Avda. Mcal. López 456");
    await page.getByLabel("Department and city").fill("Fernando de la Mora");
    await expect(page.getByRole("option", { name: /FERNANDO DE LA MORA \(CENTRAL\)/ })).toBeVisible();
    await page.getByRole("option", { name: /FERNANDO DE LA MORA \(CENTRAL\)/ }).click();
    await expect(page.getByLabel("Department and city")).toHaveValue(
      "FERNANDO DE LA MORA (CENTRAL)",
    );

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "New client" })).toBeVisible();

    const created = await apiGetJson<{
      content: {
        id: number;
        fullName: string;
        address: string | null;
        departmentCode: string | null;
        departmentName: string | null;
        cityCode: string | null;
        cityName: string | null;
      }[];
    }>(request, token, `/api/clients/page?q=${encodeURIComponent(fullName)}&size=1`);
    expect(created.content).toHaveLength(1);
    const client = created.content[0];
    expect(client.address).toBe("Avda. Mcal. López 456");
    expect(client.departmentCode).toBe("12");
    expect(client.departmentName).toBe("CENTRAL");
    expect(client.cityCode).toBe("5044");
    expect(client.cityName).toBe("FERNANDO DE LA MORA");
  });

  test("HU-02 · AC-07 (negativo) dirección sin localidad seleccionada no fabrica departamento/ciudad (API)", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);

    const client = await apiPostJson<{
      address: string | null;
      departmentCode: string | null;
      cityCode: string | null;
    }>(request, token, "/api/clients", {
      fullName: `E2E AC07 sin localidad ${Date.now()}-${Math.random()}`,
      phone: null,
      email: null,
      ruc: null,
      address: "Avda. Mcal. López 456",
      departmentCode: null,
      departmentName: null,
      cityCode: null,
      cityName: null,
    });

    expect(client.address).toBe("Avda. Mcal. López 456");
    expect(client.departmentCode).toBeNull();
    expect(client.cityCode).toBeNull();
  });

  test("HU-02 · AC-07 el picker de localidad busca contra el catálogo real de DNIT (API)", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);

    const res = await request.get(
      `${apiBaseUrl()}/api/sifen/geographic-localities?q=fernando`,
      { headers: authHeaders(token) },
    );
    expect(res.ok(), await res.text()).toBeTruthy();
    const results = (await res.json()) as { departmentName: string; cityName: string }[];
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.some((r) => r.cityName === "FERNANDO DE LA MORA" && r.departmentName === "CENTRAL"),
    ).toBeTruthy();
  });
});
