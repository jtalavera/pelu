import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  API_BASE,
  apiBaseUrl,
  apiPostJson,
  authHeaders,
  loginAsDemoApi,
  loginPlatformAdminApi,
  seedCategoryServiceProfessional,
  setTenantFeatureFlag,
  type SeededSalon,
} from "../../fixtures/api";
import {
  askAssistantUi,
  draftCards,
  enableAssistantGlobally,
  lastDraftCard,
  openAssistantPanel,
  prepareInvoicing,
  restoreAssistantGlobal,
  startNewConversationUi,
} from "../../fixtures/assistant";
import { goToInvoiceHistory, searchInvoiceHistory } from "../../fixtures/billing";
import { loginAsDemo } from "../../fixtures/auth";

// HU-AST-04 · Compartir la factura con el cliente
// requirements/user_stories/HU-AST-04-compartir-la-factura-con-el-cliente.md
//
// The demo salon has SIFEN off and the non-fiscal receipt on: its invoices are comprobantes no
// fiscales. Email is disabled in e2e (the backend just logs the send), so a send answers 204.

const SUFFIX = String(Date.now()).slice(-7);
const DEMO_TENANT_ID = 1;

test.describe.configure({ mode: "serial" });

test.describe("HU-AST-04 · Compartir la factura con el cliente", () => {
  let token: string;
  let salon: SeededSalon;
  let n = 0;

  test.beforeAll(async ({ request }) => {
    await enableAssistantGlobally(request);
    token = await loginAsDemoApi(request);
    await prepareInvoicing(request, token);
    salon = await seedCategoryServiceProfessional(request, token);
  });
  test.afterAll(async ({ request }) => {
    await restoreAssistantGlobal(request);
  });

  /** A client (optionally with an email) and an issued non-fiscal invoice of Gs. 50.000 for it. */
  async function clientWithInvoice(request: APIRequestContext, email: string | null) {
    const phone = `09${String(Date.now()).slice(-8)}`;
    const fullName = `Asistente Share ${SUFFIX} ${++n}`;
    const client = await apiPostJson<{ id: number; fullName: string }>(request, token, "/api/clients", {
      fullName,
      phone,
      email,
      ruc: null,
    });
    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      lines: [
        { serviceId: salon.serviceId, description: salon.serviceFullName, quantity: 1, unitPrice: 50000 },
      ],
      payments: [{ method: "CASH", amount: 50000 }],
    });
    return { client, invoiceId: invoice.id };
  }

  /** Billing → invoice history → the detail of the client's invoice. */
  async function openDetailFromHistory(page: Page, clientName: string) {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, clientName);
    const row = page
      .locator('[data-testid^="invoice-history-row-"]')
      .filter({ hasText: clientName })
      .filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(page.getByTestId("invoice-detail-view")).toBeVisible();
  }

  async function captureWhatsappOpens(page: Page) {
    await page.evaluate(() => {
      const w = window as unknown as { __opened: string[] };
      w.__opened = [];
      window.open = ((url?: string | URL) => {
        w.__opened.push(String(url ?? ""));
        return null;
      }) as typeof window.open;
    });
  }

  test("AC1 · «Compartir con el cliente» abre el detalle directo en su panel Compartir", async ({
    page,
    request,
  }) => {
    const client = await apiPostJson<{ id: number; fullName: string }>(request, token, "/api/clients", {
      fullName: `Asistente Share ${SUFFIX} card`,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByTestId("assistant-draft-payment-CASH").click();
    await card.getByTestId("assistant-draft-confirm").click();
    await expect(card).toHaveAttribute("data-status", "CONFIRMED", { timeout: 20_000 });

    await card.getByTestId("assistant-draft-share").click();

    await expect(page.getByTestId("invoice-detail-view")).toBeVisible();
    await expect(page.getByTestId("invoice-panel-share")).toBeVisible();
    await expect(page.getByTestId("receipt-share-section")).toBeVisible();
    await expect(page.getByTestId("receipt-share-send-email-button")).toBeVisible();
    await expect(page.getByTestId("receipt-share-send-whatsapp-button")).toBeVisible();
  });

  test("AC2 · «Ver factura» abre el detalle de la factura emitida (sin el panel Compartir)", async ({
    page,
    request,
  }) => {
    const client = await apiPostJson<{ id: number; fullName: string }>(request, token, "/api/clients", {
      fullName: `Asistente Share ${SUFFIX} view`,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByTestId("assistant-draft-payment-CASH").click();
    await card.getByTestId("assistant-draft-confirm").click();
    await expect(card).toHaveAttribute("data-status", "CONFIRMED", { timeout: 20_000 });

    await card.getByTestId("assistant-draft-view-invoice").click();

    await expect(page.getByTestId("invoice-detail-view")).toContainText(new RegExp(client.fullName, "i"));
    await expect(page.getByTestId("invoice-panel-share")).toHaveCount(0);
    // It is there to share when she wants.
    await expect(page.getByTestId("invoice-share-button")).toBeVisible();
    await expect(draftCards(page)).toHaveCount(1);
  });

  test("AC3 · en Facturación, el detalle de una factura sin SIFEN también tiene «Compartir»", async ({
    page,
    request,
  }) => {
    const { client } = await clientWithInvoice(request, null);

    await openDetailFromHistory(page, client.fullName);

    const share = page.getByTestId("invoice-share-button");
    await expect(share).toBeVisible();
    await share.click();
    await expect(page.getByTestId("receipt-share-section")).toBeVisible();
    await expect(page.getByTestId("receipt-share-email-input")).toBeVisible();
    await expect(page.getByTestId("receipt-share-send-whatsapp-button")).toBeVisible();
    // It is the receipt's panel, not the KuDE's.
    await expect(page.getByTestId("sifen-tab-email")).toHaveCount(0);
  });

  test("AC4 · el email se manda con el comprobante, precargado con el del cliente", async ({
    page,
    request,
  }) => {
    const { client, invoiceId } = await clientWithInvoice(request, "cliente.share@example.com");
    await openDetailFromHistory(page, client.fullName);
    await page.getByTestId("invoice-share-button").click();
    const input = page.getByTestId("receipt-share-email-input");
    await expect(input).toHaveValue("cliente.share@example.com");

    const sent = page.waitForResponse(
      (r) => r.url().endsWith(`/api/invoices/${invoiceId}/pdf/email`) && r.request().method() === "POST",
    );
    await page.getByTestId("receipt-share-send-email-button").click();

    const res = await sent;
    expect(res.status()).toBe(204);
    expect(JSON.parse(res.request().postData() ?? "{}")).toMatchObject({
      email: "cliente.share@example.com",
    });
    await expect(page.getByTestId("receipt-share-email-success")).toContainText("Receipt sent by email");

    // Typing another address wins over the one on file.
    await input.fill("otro@example.com");
    const second = page.waitForResponse((r) => r.url().endsWith("/pdf/email"));
    await page.getByTestId("receipt-share-send-email-button").click();
    expect(JSON.parse((await second).request().postData() ?? "{}")).toMatchObject({
      email: "otro@example.com",
    });
  });

  test("AC5 · sin dirección, o mal escrita, el panel muestra un error traducido con un ejemplo", async ({
    page,
    request,
  }) => {
    const { client } = await clientWithInvoice(request, null);
    await openDetailFromHistory(page, client.fullName);
    await page.getByTestId("invoice-share-button").click();
    const send = page.getByTestId("receipt-share-send-email-button");

    await send.click();
    const error = page.getByTestId("receipt-share-email-error");
    await expect(error).toContainText("Enter the client's email");
    await expect(error).toContainText("client@email.com");
    await expect(error).not.toContainText("RECEIPT_EMAIL_REQUIRED");

    await page.getByTestId("receipt-share-email-input").fill("no-es-un-email");
    await send.click();
    await expect(error).toContainText("Enter a valid email");
    await expect(error).not.toContainText("RECEIPT_EMAIL_INVALID");
    await expect(page.getByTestId("receipt-share-email-success")).toHaveCount(0);
  });

  test("AC6 · «Enviar por WhatsApp» descarga el PDF del comprobante y abre el chat con el mensaje", async ({
    page,
    request,
  }) => {
    const { client, invoiceId } = await clientWithInvoice(request, null);
    await openDetailFromHistory(page, client.fullName);
    await page.getByTestId("invoice-share-button").click();
    await captureWhatsappOpens(page);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.waitForResponse(
        (r) => r.url().includes(`/api/invoices/${invoiceId}/pdf`) && r.request().method() === "GET",
      ),
      page.getByTestId("receipt-share-send-whatsapp-button").click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^COMPROBANTE-NO-FISCAL-.*\.pdf$/);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length))
      .toBeGreaterThan(0);
    const url = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened[0]);
    // The client's phone ("09…" → "595…") and a message with the amount in the app's money format.
    expect(url).toContain("https://web.whatsapp.com/send?phone=595");
    const message = decodeURIComponent(url.split("text=")[1] ?? "");
    expect(message).toContain("Gs. 50.000");
    expect(message).toMatch(/receipt No\./i);
  });

  test("AC7 · sin el comprobante no fiscal habilitado no se ofrece compartirlo", async ({ page, request }) => {
    const { client } = await clientWithInvoice(request, null);
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, "NON_FISCAL_RECEIPT", false);
    try {
      await openDetailFromHistory(page, client.fullName);
      await expect(page.getByTestId("invoice-share-button")).toHaveCount(0);
    } finally {
      const platform = await loginPlatformAdminApi(request);
      const res = await request.delete(
        `${apiBaseUrl()}/api/admin/feature-flags/tenants/${DEMO_TENANT_ID}/NON_FISCAL_RECEIPT`,
        { headers: authHeaders(platform) },
      );
      expect(res.ok(), await res.text()).toBeTruthy();
    }
    // And the endpoint refuses it too (the guards of the receipt PDF apply).
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, "NON_FISCAL_RECEIPT", false);
    try {
      const { invoiceId } = await clientWithInvoice(request, "x@example.com").catch(() => ({ invoiceId: 0 }));
      const refused = await request.post(`${API_BASE}/api/invoices/${invoiceId}/pdf/email`, {
        headers: authHeaders(token),
        data: { email: "x@example.com" },
      });
      expect([404, 409]).toContain(refused.status());
    } finally {
      const platform = await loginPlatformAdminApi(request);
      await request.delete(
        `${apiBaseUrl()}/api/admin/feature-flags/tenants/${DEMO_TENANT_ID}/NON_FISCAL_RECEIPT`,
        { headers: authHeaders(platform) },
      );
    }
  });
});
