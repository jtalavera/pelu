import { expect, test } from "@playwright/test";

import {
  API_BASE,
  apiPostJson,
  authHeaders,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  type SeededSalon,
} from "../../fixtures/api";
import {
  askAssistantUi,
  assistantAnswers,
  clientInvoicesApi,
  completeDraftApi,
  confirmDraftApi,
  createClientWithPhone,
  createOpenFicha,
  currentConversationApi,
  draftCards,
  enableAssistantGlobally,
  expireDraftApi,
  lastDraftCard,
  openAssistantPanel,
  prepareInvoicing,
  proposeViaApi,
  restoreAssistantGlobal,
  startNewConversationUi,
  updateServicePriceApi,
} from "../../fixtures/assistant";
import { loginAs, loginAsDemo } from "../../fixtures/auth";
import { loginApi, PASSWORD, professionalWithAccess } from "../../fixtures/commissions";

// HU-AST-03 · Proponer y emitir una factura desde el chat
// requirements/user_stories/HU-AST-03-proponer-y-emitir-factura-desde-el-chat.md
//
// The scripted model understands «invoice <client> [for <service>] [cash]» (fixtures/assistant.ts).
// The demo salon issues non-fiscal receipts (SIFEN is off for it). AC14 (isolation) lives in
// tests/mt-isolation/mt-asistente.spec.ts.

const SUFFIX = String(Date.now()).slice(-7);

test.describe.configure({ mode: "serial" });

test.describe("HU-AST-03 · Proponer y emitir una factura desde el chat", () => {
  let token: string;
  let salon: SeededSalon;
  let n = 0;

  /** A fresh client per test, so no test sees another's open ficha or invoices. */
  const newClient = (request: Parameters<typeof createClientWithPhone>[0]) =>
    createClientWithPhone(request, token, `Asistente Fact ${SUFFIX} ${++n}`);

  test.beforeAll(async ({ request }) => {
    await enableAssistantGlobally(request);
    token = await loginAsDemoApi(request);
    await prepareInvoicing(request, token);
    salon = await seedCategoryServiceProfessional(request, token);
  });
  test.afterAll(async ({ request }) => {
    await restoreAssistantGlobal(request);
  });

  async function open(page: import("@playwright/test").Page) {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);
  }

  test("AC1 · «facturale a …» deja una tarjeta de borrador y no emite nada", async ({ page, request }) => {
    const client = await newClient(request);
    await open(page);

    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);

    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-status", "DRAFT");
    await expect(card.getByTestId("assistant-draft-client")).toHaveText(new RegExp(client.fullName, "i"));
    await expect(card.getByTestId("assistant-draft-lines")).toContainText(salon.serviceFullName);
    await expect(card.getByTestId("assistant-draft-total")).toHaveText("Gs. 50.000");
    await expect(assistantAnswers(page).last()).toContainText("Preparé el borrador");
    // Nothing was issued.
    expect(await clientInvoicesApi(request, token, client.id)).toHaveLength(0);
  });

  test("AC2 · sin indicar servicios toma la ficha abierta del cliente", async ({ page, request }) => {
    const client = await newClient(request);
    await createOpenFicha(request, token, {
      clientId: client.id,
      serviceId: salon.serviceId,
      professionalId: salon.professionalId,
    });
    await open(page);

    await askAssistantUi(page, `invoice ${client.fullName}`);

    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("assistant-draft-lines")).toContainText(salon.serviceFullName);
    await expect(card.getByTestId("assistant-draft-total")).toHaveText("Gs. 50.000");
  });

  test("AC3 · con servicios indicados usa el catálogo y muestra los importes como la app", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    await open(page);

    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);

    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    // «Gs. 50.000»: prefix, point as thousands separator, no decimals.
    const text = await card.innerText();
    expect(text).toMatch(/Gs\. 50\.000/);
    expect(text).not.toMatch(/Gs\. [\d.]*,\d/);
    expect(text).not.toMatch(/50\.000[.,]00/);
  });

  test("AC4 · lo que falta se completa en la tarjeta con botones", async ({ page, request }) => {
    const client = await newClient(request);
    await open(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    const confirm = card.getByTestId("assistant-draft-confirm");

    // Nothing chosen yet: the card says what is missing and the button is locked.
    await expect(card.getByTestId("assistant-draft-missing")).toContainText("payment method");
    await expect(confirm).toBeDisabled();

    await card.getByTestId("assistant-draft-payment-CASH").click();
    await expect(confirm).toBeEnabled();
    await expect(card.getByTestId("assistant-draft-payment-CASH")).toHaveAttribute("aria-pressed", "true");

    // A card payment also needs its brand.
    await card.getByTestId("assistant-draft-payment-CREDIT_CARD").click();
    await expect(confirm).toBeDisabled();
    await expect(card.getByTestId("assistant-draft-missing")).toContainText("card brand");
    await card.getByTestId("assistant-draft-brand-VISA").click();
    await expect(confirm).toBeEnabled();
  });

  test("AC5 · un cambio por chat reemplaza el borrador anterior", async ({ page, request }) => {
    const client = await newClient(request);
    await open(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);
    await expect(draftCards(page)).toHaveCount(1, { timeout: 20_000 });
    await expect(assistantAnswers(page).last()).toContainText("Preparé el borrador");

    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName} cash`);

    await expect(draftCards(page)).toHaveCount(2, { timeout: 20_000 });
    const [first, second] = [draftCards(page).nth(0), draftCards(page).nth(1)];
    await expect(first).toHaveAttribute("data-status", "SUPERSEDED");
    await expect(first.getByTestId("assistant-draft-confirm")).toHaveCount(0);
    await expect(second).toHaveAttribute("data-status", "DRAFT");
  });

  test("AC6 · «Descartar» y descartar por chat dejan el borrador sin emitir", async ({ page, request }) => {
    const client = await newClient(request);
    await open(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });

    await card.getByTestId("assistant-draft-discard").click();

    await expect(card).toHaveAttribute("data-status", "DISCARDED");
    await expect(card.getByTestId("assistant-draft-confirm")).toHaveCount(0);

    // Same by chat.
    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);
    await expect(draftCards(page)).toHaveCount(2, { timeout: 20_000 });
    await expect(assistantAnswers(page).last()).toContainText("Preparé el borrador");
    await askAssistantUi(page, "discard the draft");
    await expect(draftCards(page).nth(1)).toHaveAttribute("data-status", "DISCARDED", { timeout: 20_000 });
    expect(await clientInvoicesApi(request, token, client.id)).toHaveLength(0);
  });

  test("AC7 · un borrador vencido (24 h) se atenúa y no se puede confirmar", async ({ page, request }) => {
    const client = await newClient(request);
    await open(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByTestId("assistant-draft-payment-CASH").click();
    await expect(card.getByTestId("assistant-draft-confirm")).toBeEnabled();
    await expireDraftApi(request, token, (await card.getAttribute("data-draft-id"))!);

    await card.getByTestId("assistant-draft-confirm").click();

    await expect(card).toHaveAttribute("data-status", "EXPIRED");
    await expect(card.getByTestId("assistant-draft-error")).toContainText("expired");
    await expect(card.getByTestId("assistant-draft-confirm")).toHaveCount(0);
    expect(await clientInvoicesApi(request, token, client.id)).toHaveLength(0);
  });

  test("AC8 · «Confirmar y emitir» emite por el camino existente y la factura queda en Facturación", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    await open(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByTestId("assistant-draft-payment-CASH").click();

    await card.getByTestId("assistant-draft-confirm").click();

    await expect(card).toHaveAttribute("data-status", "CONFIRMED", { timeout: 20_000 });
    await expect(card).toContainText(/Invoice \S+ issued/);
    const invoices = await clientInvoicesApi(request, token, client.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe("ISSUED");
    expect(Number(invoices[0].total)).toBe(50000);

    // It is the same invoice Facturación shows: its detail opens from the card.
    await card.getByTestId("assistant-draft-view-invoice").click();
    const detail = page.getByTestId("invoice-detail-view");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(new RegExp(client.fullName, "i"));
    await expect(detail).toContainText("50.000");
  });

  test("AC8b · si falta algo (caja cerrada) el error sale traducido en la tarjeta y el borrador sigue confirmable", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    await open(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByTestId("assistant-draft-payment-CASH").click();
    const closed = await request.post(`${API_BASE}/api/cash-sessions/close`, {
      headers: authHeaders(token),
      data: { countedCashAmount: 0 },
    });
    expect(closed.ok(), await closed.text()).toBeTruthy();
    try {
      await card.getByTestId("assistant-draft-confirm").click();

      const error = card.getByTestId("assistant-draft-error");
      await expect(error).toBeVisible({ timeout: 20_000 });
      await expect(error).not.toContainText("CASH_SESSION_NOT_OPEN");
      await expect(card).toHaveAttribute("data-status", "DRAFT");
      expect(await clientInvoicesApi(request, token, client.id)).toHaveLength(0);
    } finally {
      await prepareInvoicing(request, token);
    }

    // With the register open again, the very same card issues it.
    await card.getByTestId("assistant-draft-confirm").click();
    await expect(card).toHaveAttribute("data-status", "CONFIRMED", { timeout: 20_000 });
    expect(await clientInvoicesApi(request, token, client.id)).toHaveLength(1);
  });

  test("AC9 · dos confirmaciones a la vez emiten una sola factura", async ({ request }) => {
    const client = await newClient(request);
    const { draft } = await proposeViaApi(
      request,
      token,
      `invoice ${client.fullName} for ${salon.serviceFullName}`,
    );
    expect(draft).not.toBeNull();
    await completeDraftApi(request, token, draft!.id, { paymentMethod: "CASH" });

    const [a, b] = await Promise.all([
      confirmDraftApi(request, token, draft!.id),
      confirmDraftApi(request, token, draft!.id),
    ]);

    expect([a.status(), b.status()].sort()).toEqual([200, 409]);
    const refused = a.status() === 409 ? a : b;
    const body = (await refused.json()) as { error: string; invoiceId: number };
    expect(body.error).toBe("ASSISTANT_DRAFT_ALREADY_CONFIRMED");
    const invoices = await clientInvoicesApi(request, token, client.id);
    expect(invoices).toHaveLength(1);
    expect(body.invoiceId).toBe(invoices[0].id);
  });

  test("AC10 · si el precio cambió no se emite: la tarjeta muestra el total nuevo y pide revisarlo", async ({
    page,
    request,
  }) => {
    // A service of its own, so changing its price cannot disturb the other tests.
    const category = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
      name: `E2E Cat Precio ${SUFFIX}`,
      accentKey: "stone",
    });
    const serviceName = `E2E Svc Precio ${SUFFIX}`;
    const service = await apiPostJson<{ id: number }>(request, token, "/api/services", {
      name: serviceName,
      categoryId: category.id,
      priceMinor: 50000,
      durationMinutes: 60,
    });
    const client = await newClient(request);
    await open(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${serviceName}`);
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("assistant-draft-total")).toHaveText("Gs. 50.000");
    await card.getByTestId("assistant-draft-payment-CASH").click();
    await updateServicePriceApi(request, token, { id: service.id, name: serviceName, categoryId: category.id }, 65000);

    await card.getByTestId("assistant-draft-confirm").click();

    await expect(card.getByTestId("assistant-draft-price-changed")).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("assistant-draft-total")).toHaveText("Gs. 65.000");
    await expect(card).toHaveAttribute("data-status", "DRAFT");
    expect(await clientInvoicesApi(request, token, client.id)).toHaveLength(0);

    // The person reviewed it and confirms again: issued at the new price.
    await card.getByTestId("assistant-draft-confirm").click();
    await expect(card).toHaveAttribute("data-status", "CONFIRMED", { timeout: 20_000 });
    const invoices = await clientInvoicesApi(request, token, client.id);
    expect(invoices).toHaveLength(1);
    expect(Number(invoices[0].total)).toBe(65000);
  });

  test("AC15 · los precios de las líneas se editan como en Facturación y lo emitido usa el precio escrito", async ({
    page,
    request,
  }) => {
    // A service of its own, so changing its catalog price cannot disturb the other tests.
    const category = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
      name: `E2E Cat Editar ${SUFFIX}`,
      accentKey: "stone",
    });
    const serviceName = `E2E Svc Editar ${SUFFIX}`;
    const service = await apiPostJson<{ id: number }>(request, token, "/api/services", {
      name: serviceName,
      categoryId: category.id,
      priceMinor: 50000,
      durationMinutes: 60,
    });
    const client = await newClient(request);
    await open(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${serviceName}`);
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    const price = card.getByTestId("assistant-draft-line-price-0");
    await expect(price).toHaveValue("50.000"); // same mask as the billing screen
    await expect(card.getByTestId("assistant-draft-total")).toHaveText("Gs. 50.000");
    await expect(card.getByTestId("assistant-draft-line-edited-0")).toHaveCount(0);

    // An invalid price shows the rule with an example and changes nothing.
    await price.fill("0");
    await price.press("Enter");
    await expect(card.getByRole("alert").filter({ hasText: "50.000" })).toBeVisible();
    await expect(card.getByTestId("assistant-draft-total")).toHaveText("Gs. 50.000");

    // A valid one: the backend recalculates the line and the total; the line is marked «Edited».
    await price.fill("45000");
    await expect(price).toHaveValue("45.000");
    await price.press("Enter");
    await expect(card.getByTestId("assistant-draft-total")).toHaveText("Gs. 45.000");
    await expect(card.getByTestId("assistant-draft-line-total-0")).toHaveText("Gs. 45.000");
    await expect(card.getByTestId("assistant-draft-line-edited-0")).toBeVisible();
    await expect(price).toHaveValue("45.000");
    await expect(card.getByRole("alert").filter({ hasText: "50.000" })).toHaveCount(0);

    // The catalog moves afterwards: the person's price stays and it is not a «price changed».
    await card.getByTestId("assistant-draft-payment-CASH").click();
    await updateServicePriceApi(request, token, { id: service.id, name: serviceName, categoryId: category.id }, 80000);
    await card.getByTestId("assistant-draft-confirm").click();

    await expect(card).toHaveAttribute("data-status", "CONFIRMED", { timeout: 20_000 });
    await expect(card.getByTestId("assistant-draft-price-changed")).toHaveCount(0);
    const invoices = await clientInvoicesApi(request, token, client.id);
    expect(invoices).toHaveLength(1);
    expect(Number(invoices[0].total)).toBe(45000);
    // Once issued, the card has no editable prices.
    await expect(card.getByTestId("assistant-draft-line-price-0")).toHaveCount(0);
  });

  test("AC11 · escribir «sí», «dale» o «confirmá» no emite nada", async ({ page, request }) => {
    const client = await newClient(request);
    await open(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByTestId("assistant-draft-payment-CASH").click();

    for (const reply of ["sí, emitila", "dale", "confirmá"]) {
      await askAssistantUi(page, reply);
      await expect(assistantAnswers(page).last()).toContainText("No entendí tu consulta", { timeout: 20_000 });
    }

    await expect(card).toHaveAttribute("data-status", "DRAFT");
    expect(await clientInvoicesApi(request, token, client.id)).toHaveLength(0);
  });

  test("AC12 · solo administración: una profesional no recibe borrador y no puede confirmar", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    const { draft } = await proposeViaApi(
      request,
      token,
      `invoice ${client.fullName} for ${salon.serviceFullName}`,
    );
    const pro = await professionalWithAccess(request, token, `E2E Asistente Fact Pro ${SUFFIX}`);
    const proToken = await loginApi(request, pro.email);

    // She cannot confirm the administrator's draft: it is not hers, so for her it does not exist.
    const refused = await confirmDraftApi(request, proToken, draft!.id);
    expect(refused.status()).toBe(404);

    // And asking to invoice gets an explanation, no card.
    await loginAs(page, pro.email, PASSWORD);
    await openAssistantPanel(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);
    await expect(assistantAnswers(page).last()).toContainText("solo para administración", { timeout: 20_000 });
    await expect(draftCards(page)).toHaveCount(0);
  });

  test("AC13 · al recargar y reabrir el asistente, la tarjeta sigue ahí con su estado", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    await open(page);
    await askAssistantUi(page, `invoice ${client.fullName} for ${salon.serviceFullName}`);
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByTestId("assistant-draft-payment-CASH").click();
    await expect(card.getByTestId("assistant-draft-confirm")).toBeEnabled();

    await page.reload();
    await openAssistantPanel(page);

    const again = lastDraftCard(page);
    await expect(again).toBeVisible();
    await expect(again).toHaveAttribute("data-status", "DRAFT");
    await expect(again.getByTestId("assistant-draft-total")).toHaveText("Gs. 50.000");
    // What was completed before the reload is remembered.
    await expect(again.getByTestId("assistant-draft-payment-CASH")).toHaveAttribute("aria-pressed", "true");

    // And once issued, the reloaded card is the green one.
    await again.getByTestId("assistant-draft-confirm").click();
    await expect(again).toHaveAttribute("data-status", "CONFIRMED", { timeout: 20_000 });
    await page.reload();
    await openAssistantPanel(page);
    await expect(lastDraftCard(page)).toHaveAttribute("data-status", "CONFIRMED");
    expect(await clientInvoicesApi(request, token, client.id)).toHaveLength(1);
    // The conversation is still the same one.
    expect((await currentConversationApi(request, token)).conversationId).toBeGreaterThan(0);
  });
});
