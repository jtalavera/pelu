import { expect, test } from "@playwright/test";
import {
  apiGetJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

// Explicit document-type selector (RUC / Cédula paraguaya / Pasaporte / Cédula extranjera /
// Carnet de residencia / Tarjeta Diplomática / Otro / Sin identificar), replacing the previous
// implicit "RUC field present vs identity-document field present" detection on both the invoice
// issuance form and the client form.

test.describe("Selector de tipo de documento de identidad", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  test("factura: seleccionar Pasaporte persiste el tipo y el número, no el RUC", async ({
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

    await expect(page.locator("#client-identity-document-type")).toHaveValue("RUC");
    await page.locator("#client-identity-document-type").selectOption("PASAPORTE");
    await page.locator("#client-identity-document-number").fill("AB123456");

    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("9000");
    await page.locator("#pay-amount-0").fill("9000");
    const issued = await clickIssueInvoiceAndExpectSuccess(page);

    const invoice = await apiGetJson<{
      clientRucOverride: string | null;
      clientIdentityDocumentOverride: string | null;
      clientIdentityDocumentTypeOverride: string | null;
    }>(request, token, `/api/invoices/${issued.id}`);
    expect(invoice.clientIdentityDocumentTypeOverride).toBe("PASAPORTE");
    expect(invoice.clientIdentityDocumentOverride).toBe("AB123456");
    expect(invoice.clientRucOverride).toBeNull();
  });

  test("factura: 'Sin identificar' deshabilita el campo de número", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();

    await page.locator("#client-identity-document-type").selectOption("INNOMINADO");
    await expect(page.locator("#client-identity-document-number")).toBeDisabled();

    // Below the Gs. 7.000.000 threshold, an unidentified client is still allowed to issue.
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("9000");
    await page.locator("#pay-amount-0").fill("9000");
    const issued = await clickIssueInvoiceAndExpectSuccess(page);

    const invoice = await apiGetJson<{
      clientRucOverride: string | null;
      clientIdentityDocumentOverride: string | null;
      clientIdentityDocumentTypeOverride: string | null;
    }>(request, token, `/api/invoices/${issued.id}`);
    expect(invoice.clientIdentityDocumentTypeOverride).toBeNull();
    expect(invoice.clientIdentityDocumentOverride).toBeNull();
    expect(invoice.clientRucOverride).toBeNull();
  });

  test("cliente: crear con tipo Cédula paraguaya guarda el tipo y limpia el RUC", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");

    const fullName = `E2E Cedula ${Date.now()}`;
    await dlg.getByLabel("Full name").fill(fullName);
    await expect(dlg.getByLabel("Document type")).toHaveValue("RUC");
    await dlg.getByLabel("Document type").selectOption("CEDULA_PARAGUAYA");
    await dlg.getByLabel("Document number").fill("4123456");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden();

    const created = await apiGetJson<{
      content: {
        id: number;
        fullName: string;
        ruc: string | null;
        identityDocumentNumber: string | null;
        identityDocumentType: string | null;
      }[];
    }>(request, token, `/api/clients/page?q=${encodeURIComponent(fullName)}&size=1`);
    expect(created.content).toHaveLength(1);
    expect(created.content[0].identityDocumentType).toBe("CEDULA_PARAGUAYA");
    expect(created.content[0].identityDocumentNumber).toBe("4123456");
    expect(created.content[0].ruc).toBeNull();
  });

  test("cliente: editar de RUC a Pasaporte reemplaza el tipo y limpia el RUC previo", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const fullName = `E2E Edit Doc ${Date.now()}`;
    const client = await seedClient(request, token, fullName, undefined, "80000005-6");

    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    await expect(page.locator("#detail-identity-document-type")).toHaveValue("RUC");
    await expect(page.locator("#detail-identity-document-number")).toHaveValue("80000005-6");

    await page.locator("#detail-identity-document-type").selectOption("PASAPORTE");
    await page.locator("#detail-identity-document-number").fill("XY987654");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Client updated successfully.")).toBeVisible();

    const updated = await apiGetJson<{
      ruc: string | null;
      identityDocumentNumber: string | null;
      identityDocumentType: string | null;
    }>(request, token, `/api/clients/${client.id}`);
    expect(updated.identityDocumentType).toBe("PASAPORTE");
    expect(updated.identityDocumentNumber).toBe("XY987654");
    expect(updated.ruc).toBeNull();
  });

  test("cliente: la validación de formato de RUC no se aplica a otros tipos de documento", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");

    await dlg.getByLabel("Full name").fill(`E2E Otro ${Date.now()}`);
    await dlg.getByLabel("Document type").selectOption("OTRO");
    await dlg.getByLabel("Document number").fill("not-a-ruc-format");
    await dlg.getByRole("button", { name: "Save" }).click();

    await expect(
      page.getByText("Invalid RUC. Use digits, one hyphen, and digits (e.g. 80000005-6).", {
        exact: true,
      }),
    ).not.toBeVisible();
    await expect(dlg).toBeHidden();
  });
});
