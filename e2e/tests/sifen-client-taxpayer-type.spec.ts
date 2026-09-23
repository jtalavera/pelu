import { expect, test } from "@playwright/test";
import {
  apiGetJson,
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { pickServiceLine } from "../fixtures/invoice";

// SIFEN Manual Técnico V150, campo D205/iTiContRec (tipo de contribuyente del receptor): previously
// always sent as "1" (Persona Física) regardless of the actual client — this covers the fix that
// lets a client's RUC be explicitly marked as Persona Jurídica instead. The XML-level assertion
// (iTiContRec="2" is actually sent) is covered by SifenDocumentXmlServiceTest/
// SifenInvoiceHeaderServiceTest on the backend — same "sin pantalla propia" pattern as
// sifen-hu-02-datos-documento.spec.ts's other AC-01..AC-08 coverage. These tests cover the UI
// round-trip: the field only appears for RUC, and the choice actually persists.

type ClientDto = { id: number; ruc: string | null; taxpayerType: string | null };

test.describe("SIFEN D205 · Tipo de contribuyente (Física/Jurídica)", () => {
  test("client creation: 'Taxpayer type' only appears when document type is RUC, and Company persists", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);

    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");

    const name = `E2E TaxpayerType ${Date.now()}`;
    await dlg.getByLabel("Full name").fill(name);
    await expect(dlg.locator("#client-taxpayer-type")).toBeVisible();

    // Switching away from RUC hides the field (D205 doesn't apply without a RUC).
    await dlg.locator("#client-identity-document-type").selectOption("CEDULA_PARAGUAYA");
    await expect(dlg.locator("#client-taxpayer-type")).toHaveCount(0);
    await dlg.locator("#client-identity-document-type").selectOption("RUC");
    await expect(dlg.locator("#client-taxpayer-type")).toBeVisible();

    await dlg.locator("#client-taxpayer-type").selectOption("PERSONA_JURIDICA");
    await dlg.locator("#client-identity-document-number").fill(`800${Date.now()}-6`);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden();

    const created = await apiGetJson<{ content: ClientDto[] }>(
      request,
      token,
      `/api/clients/page?q=${encodeURIComponent(name)}&size=1`,
    );
    expect(created.content).toHaveLength(1);
    expect(created.content[0].taxpayerType).toBe("PERSONA_JURIDICA");
  });

  test("client edit: changing an existing RUC client to Company persists", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const ruc = `800${Date.now()}-6`;
    const client = await seedClient(
      request,
      token,
      `E2E TaxpayerType Edit ${Date.now()}`,
      undefined,
      ruc,
    );

    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    await expect(page.locator("#detail-taxpayer-type")).toHaveValue("PERSONA_FISICA");

    await page.locator("#detail-taxpayer-type").selectOption("PERSONA_JURIDICA");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Client updated successfully.")).toBeVisible({ timeout: 10_000 });

    const updated = await apiGetJson<ClientDto>(request, token, `/api/clients/${client.id}`);
    expect(updated.taxpayerType).toBe("PERSONA_JURIDICA");
  });

  test("billing form: prefills Taxpayer type from the linked client and sends it on the invoice", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const ruc = `800${Date.now()}-6`;
    const clientName = `E2E TaxpayerType Billing ${Date.now()}`;
    const client = await seedClient(request, token, clientName, undefined, ruc);
    // Mark the client as Persona Jurídica via the API (equivalent to the edit-form flow above).
    await apiPutJson(request, token, `/api/clients/${client.id}`, {
      fullName: clientName,
      ruc,
      identityDocumentType: "RUC",
      taxpayerType: "PERSONA_JURIDICA",
    });

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(clientName.slice(0, 14));
    await page.getByRole("button", { name: clientName }).click();

    await expect(page.locator("#client-taxpayer-type")).toHaveValue("PERSONA_JURIDICA");

    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("50000");
    await page.locator("#pay-amount-0").fill("50000");

    const [res] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/invoices") &&
          r.request().method() === "POST" &&
          !r.url().includes("/void"),
      ),
      page.getByRole("button", { name: "Issue invoice" }).click(),
    ]);
    expect(res.ok(), await res.text()).toBeTruthy();
    const created = (await res.json()) as { id: number };

    const invoice = await apiGetJson<{ clientTaxpayerTypeOverride: string | null }>(
      request,
      token,
      `/api/invoices/${created.id}`,
    );
    expect(invoice.clientTaxpayerTypeOverride).toBe("PERSONA_JURIDICA");
  });
});
