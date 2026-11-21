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
  askAssistantApi,
  askAssistantUi,
  assistantAnswers,
  assistantBubbles,
  bookAppointmentTomorrow,
  clientInvoicesApi,
  createClientWithPhone,
  currentConversationApi,
  enableAssistantGlobally,
  openAssistantPanel,
  restoreAssistantGlobal,
  startNewConversationUi,
  userBubbles,
} from "../../fixtures/assistant";
import { loginAs, loginAsDemo } from "../../fixtures/auth";
import { loginApi, PASSWORD, professionalWithAccess } from "../../fixtures/commissions";

// HU-AST-02 · Consultar datos por chat
// requirements/user_stories/HU-AST-02-consultar-datos-por-chat.md
//
// AC7 (aislamiento entre salones) lives in tests/mt-isolation/mt-asistente.spec.ts.
// The scripted model answers by text patterns (fixtures/assistant.ts) in Spanish.

const SUFFIX = String(Date.now()).slice(-7);

test.describe.configure({ mode: "serial" });

test.describe("HU-AST-02 · Consultar datos por chat", () => {
  let token: string;
  let salon: SeededSalon;
  let inactiveServiceName: string;
  let inactiveProfessionalName: string;
  let clientOne: { id: number; phone: string; fullName: string };
  let clientTwo: { id: number; phone: string; fullName: string };
  let bookingDate: string;

  test.beforeAll(async ({ request }) => {
    await enableAssistantGlobally(request);
    token = await loginAsDemoApi(request);
    salon = await seedCategoryServiceProfessional(request, token);

    // An inactive service and an inactive professional: the assistant must not list them.
    inactiveServiceName = `E2E Inactivo Svc ${SUFFIX}`;
    const inactiveService = await apiPostJson<{ id: number }>(request, token, "/api/services", {
      name: inactiveServiceName,
      categoryId: salon.categoryId,
      priceMinor: 10000,
      durationMinutes: 30,
    });
    await apiPostJson(request, token, `/api/services/${inactiveService.id}/deactivate`, {});
    inactiveProfessionalName = `E2E Inactiva Prof ${SUFFIX}`;
    const inactiveProfessional = await apiPostJson<{ id: number }>(
      request,
      token,
      "/api/professionals",
      { fullName: inactiveProfessionalName, phone: null, email: null, photoDataUrl: null },
    );
    await apiPostJson(
      request,
      token,
      `/api/professionals/${inactiveProfessional.id}/deactivate`,
      {},
    );

    // Two clients with a turno each, tomorrow.
    clientOne = await createClientWithPhone(request, token, `Asistente Uno ${SUFFIX}`);
    clientTwo = await createClientWithPhone(request, token, `Asistente Dos ${SUFFIX}`);
    const one = await bookAppointmentTomorrow(request, token, {
      clientId: clientOne.id,
      professionalId: salon.professionalId,
      serviceId: salon.serviceId,
    });
    await bookAppointmentTomorrow(request, token, {
      clientId: clientTwo.id,
      professionalId: salon.professionalId,
      serviceId: salon.serviceId,
    });
    bookingDate = one.date;
  });

  test.afterAll(async ({ request }) => {
    await restoreAssistantGlobal(request);
  });

  test("AC1 · Enter envía, Shift+Enter agrega un salto de línea y la caja se bloquea mientras responde", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);
    const input = page.getByTestId("assistant-input");

    await input.fill("hello");
    await input.press("Shift+Enter");
    await input.pressSequentially("there");
    await expect(input).toHaveValue("hello\nthere");
    await expect(userBubbles(page)).toHaveCount(0);

    await input.press("Enter");
    await expect(userBubbles(page)).toHaveCount(1);
    await expect(input).toHaveValue("");
    await expect(assistantAnswers(page).last()).toContainText("No entendí tu consulta");

    // Slow answer: while it trickles out, a second message is not sent.
    await askAssistantUi(page, "slowly hello");
    await expect(userBubbles(page)).toHaveCount(2);
    await input.fill("segundo mensaje");
    await expect(page.getByTestId("assistant-send")).toBeDisabled();
    await input.press("Enter");
    await expect(userBubbles(page)).toHaveCount(2);
    // Once it finishes, the box is usable again.
    await expect(assistantAnswers(page).last()).toContainText("No entendí tu consulta", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("assistant-send")).toBeEnabled();
    await input.press("Enter");
    await expect(userBubbles(page)).toHaveCount(3);
  });

  test("AC2 · se ve el mensaje enseguida, qué está haciendo el asistente y la respuesta a medida que llega", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);

    await askAssistantUi(page, "slowly appointments 2031-01-15");

    // Your own message is there at once.
    await expect(userBubbles(page).last()).toContainText("slowly appointments 2031-01-15");
    // While the agenda is queried, the assistant says what it is doing.
    await expect(page.getByTestId("assistant-tool-status")).toHaveText("Checking the agenda…");
    // The answer shows up in pieces: first its beginning (while the rest is still on its way), later
    // all of it. Polled every 40 ms: the pieces arrive 400 ms apart, and `expect` alone backs off
    // its retries enough to miss that window.
    const answer = assistantAnswers(page).last();
    await expect
      .poll(
        async () => {
          const text = await answer.innerText();
          if (text.includes("2031-01-15.")) return "complete";
          return text.includes("No hay turnos pa") ? "partial" : "empty";
        },
        { intervals: [40], timeout: 15_000, message: "the answer must arrive in pieces" },
      )
      .toBe("partial");
    await expect(answer).toContainText("No hay turnos para 2031-01-15.", { timeout: 10_000 });
    await expect(page.getByTestId("assistant-tool-status")).toHaveCount(0);
  });

  test("AC3 · turnos de un día: hora, cliente, servicio y profesional; y avisa si no hay", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);

    await askAssistantUi(page, "appointments tomorrow");

    const answer = assistantAnswers(page).last();
    await expect(answer).toContainText(`para ${bookingDate}`, { timeout: 15_000 });
    for (const client of [clientOne, clientTwo]) {
      const line = answer.getByText(new RegExp(`\\d{2}:\\d{2} ${client.fullName}`, "i"));
      await expect(line).toBeVisible();
    }
    await expect(answer).toContainText(salon.serviceFullName);
    await expect(answer).toContainText(new RegExp(salon.professionalFullName, "i"));

    await askAssistantUi(page, "appointments 2031-01-15");
    await expect(assistantAnswers(page).last()).toContainText("No hay turnos para 2031-01-15.", {
      timeout: 15_000,
    });
  });

  test("AC4 · los turnos de un cliente por su nombre muestran solo los suyos", async ({ page }) => {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);

    await askAssistantUi(page, `appointments of ${clientOne.fullName} on ${bookingDate}`);

    const answer = assistantAnswers(page).last();
    await expect(answer).toContainText("turno(s)", { timeout: 15_000 });
    await expect(answer).toContainText(new RegExp(clientOne.fullName, "i"));
    await expect(answer).not.toContainText(new RegExp(clientTwo.fullName, "i"));
  });

  test("AC5 · busca clientes por nombre y avisa cuando no existe", async ({ page }) => {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);

    await askAssistantUi(page, `search ${clientTwo.fullName}`);
    await expect(assistantAnswers(page).last()).toContainText(new RegExp(clientTwo.fullName, "i"), {
      timeout: 15_000,
    });

    await askAssistantUi(page, "search Zzyzx Inexistente 999");
    await expect(assistantAnswers(page).last()).toContainText("No encontré clientes", {
      timeout: 15_000,
    });
  });

  test("AC6 · lista los servicios y los profesionales activos, sin los inactivos", async ({ page }) => {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);

    await askAssistantUi(page, "services");
    const services = assistantAnswers(page).last();
    await expect(services).toContainText("Servicios:", { timeout: 15_000 });
    // Fixed format: «- Nombre — Gs. 50.000» (price with point as thousands separator, no decimals).
    await expect(services).toContainText(`- ${salon.serviceFullName} — Gs. 50.000`);
    const listing = await services.innerText();
    expect(listing).not.toMatch(/Gs\. [\d.]*,\d/);
    // Name and price only: neither the category nor the duration show up.
    expect(listing).not.toContain("E2E Cat");
    expect(listing).not.toMatch(/\bmin(utos)?\b|\b60\b/i);
    await expect(services).not.toContainText(inactiveServiceName);

    await askAssistantUi(page, "professionals");
    const professionals = assistantAnswers(page).last();
    await expect(professionals).toContainText(new RegExp(salon.professionalFullName, "i"), {
      timeout: 15_000,
    });
    await expect(professionals).not.toContainText(new RegExp(inactiveProfessionalName, "i"));
  });

  test("AC8 · una profesional usa el asistente pero busca clientes solo por nombre", async ({
    page,
    request,
  }) => {
    const pro = await professionalWithAccess(request, token, `E2E Asistente Pro ${SUFFIX}`);
    const proToken = await loginApi(request, pro.email);

    // The admin finds the client by phone; the professional cannot (name only, like the clients list).
    const adminConversation = await currentConversationApi(request, token);
    const byPhoneAdmin = await askAssistantApi(
      request,
      token,
      adminConversation.conversationId,
      `search ${clientOne.phone}`,
    );
    expect(byPhoneAdmin.text).toMatch(new RegExp(clientOne.fullName, "i"));

    const proConversation = await currentConversationApi(request, proToken);
    const byPhonePro = await askAssistantApi(
      request,
      proToken,
      proConversation.conversationId,
      `search ${clientOne.phone}`,
    );
    expect(byPhonePro.status).toBe(200);
    expect(byPhonePro.text).toContain("No encontré clientes");

    // In the screen: the professional has the assistant and finds the client by name.
    await loginAs(page, pro.email, PASSWORD);
    await expect(page.getByTestId("topbar-assistant")).toBeVisible();
    await openAssistantPanel(page);
    await askAssistantUi(page, `search ${clientOne.fullName}`);
    await expect(assistantAnswers(page).last()).toContainText(new RegExp(clientOne.fullName, "i"), {
      timeout: 15_000,
    });
    await expect(assistantAnswers(page).last()).not.toContainText(clientOne.phone);
  });

  test("AC9 · ante algo que no entiende lo dice y sugiere qué puede hacer", async ({ page }) => {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);

    await askAssistantUi(page, "what is the meaning of life");

    await expect(assistantAnswers(page).last()).toContainText("No entendí tu consulta", {
      timeout: 15_000,
    });
    await expect(assistantAnswers(page).last()).toContainText("turnos del día");
  });

  test("AC10 · sin confirmación el asistente no cambia ningún dato: pedir facturar o agendar solo prepara un borrador", async ({
    page,
    request,
  }) => {
    const listTomorrow = async () => {
      // Wide enough to hold the salon's "tomorrow" whatever the time zone of the runner.
      const from = new Date();
      const to = new Date(from.getTime() + 3 * 24 * 3600 * 1000);
      const res = await request.get(
        `${API_BASE}/api/appointments?from=${from.toISOString()}&to=${to.toISOString()}`,
        { headers: authHeaders(token) },
      );
      expect(res.ok(), await res.text()).toBeTruthy();
      return ((await res.json()) as Array<{ id: number }>).map((a) => a.id).sort();
    };
    const listClients = async () => {
      const res = await request.get(`${API_BASE}/api/clients`, { headers: authHeaders(token) });
      return ((await res.json()) as Array<{ id: number }>).length;
    };
    const appointmentsBefore = await listTomorrow();
    const clientsBefore = await listClients();
    const invoicesBefore = (await clientInvoicesApi(request, token, clientOne.id)).length;

    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);
    await askAssistantUi(page, `invoice ${clientOne.fullName} for ${salon.serviceFullName}`);
    await expect(assistantAnswers(page).last()).toContainText("Preparé el borrador", { timeout: 20_000 });
    // It is a draft on a card, waiting for a person to confirm.
    await expect(page.getByTestId("assistant-draft-card").last()).toHaveAttribute("data-status", "DRAFT");

    // Booking an appointment is also only a draft (HU-AST-06).
    await askAssistantUi(page, `book ${clientOne.fullName} for ${salon.serviceFullName} tomorrow at 10:00`);
    await expect(page.getByTestId("assistant-draft-card").last()).toHaveAttribute("data-type", "APPOINTMENT", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("assistant-draft-card").last()).toHaveAttribute("data-status", "DRAFT");

    expect(await listTomorrow()).toEqual(appointmentsBefore);
    expect(await listClients()).toBe(clientsBefore);
    expect((await clientInvoicesApi(request, token, clientOne.id)).length).toBe(invoicesBefore);
  });

  test("AC11 · si el modelo no está disponible la burbuja muestra un error traducido y la caja queda libre", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);

    await askAssistantUi(page, "model fails");

    const error = page.getByTestId("assistant-error");
    await expect(error).toContainText(
      "The assistant is not available right now. Please try again in a moment.",
      { timeout: 15_000 },
    );
    await expect(error).not.toContainText("ASSISTANT_MODEL_UNAVAILABLE");
    // The box is free again and a normal question still works.
    await askAssistantUi(page, "professionals");
    await expect(assistantAnswers(page).last()).toContainText("Profesionales:", { timeout: 15_000 });
  });

  test("AC12 · un mensaje vacío no se envía; la caja no admite más de 2000 caracteres y el servidor rechaza uno más largo diciendo el máximo", async ({
    page,
    request,
  }) => {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);
    const input = page.getByTestId("assistant-input");

    await expect(page.getByTestId("assistant-send")).toBeDisabled();
    await input.fill("    ");
    await expect(page.getByTestId("assistant-send")).toBeDisabled();
    await input.press("Enter");
    await expect(userBubbles(page)).toHaveCount(0);

    // The box itself caps the text at 2000 characters.
    await input.fill("x".repeat(2100));
    expect((await input.inputValue()).length).toBe(2000);

    // And the server refuses a longer message that arrives by other means, with a translatable code.
    const { conversationId } = await currentConversationApi(request, token);
    const tooLong = await askAssistantApi(request, token, conversationId, "x".repeat(2100));
    expect(tooLong.status).toBe(400);
    expect(tooLong.raw).toContain("ASSISTANT_MESSAGE_TOO_LONG");
    const empty = await askAssistantApi(request, token, conversationId, "   ");
    expect(empty.status).toBe(400);
    expect(empty.raw).toContain("ASSISTANT_MESSAGE_EMPTY");
  });

  test("AC13 · cada persona tiene su conversación: nadie lee ni continúa la de otra", async ({
    request,
  }) => {
    const pro = await professionalWithAccess(request, token, `E2E Asistente Pro2 ${SUFFIX}`);
    const proToken = await loginApi(request, pro.email);
    const adminConversation = await currentConversationApi(request, token);
    const proConversation = await currentConversationApi(request, proToken);
    expect(proConversation.conversationId).not.toBe(adminConversation.conversationId);

    const secret = await askAssistantApi(
      request,
      token,
      adminConversation.conversationId,
      "search Secreto Admin",
    );
    expect(secret.status).toBe(200);

    // Her own history does not contain the administrator's messages…
    const proHistory = await currentConversationApi(request, proToken);
    expect(JSON.stringify(proHistory.messages)).not.toContain("Secreto Admin");
    // …and knowing the id of the administrator's conversation is not enough to write in it (nor she in his).
    const intruder = await askAssistantApi(
      request,
      proToken,
      adminConversation.conversationId,
      "hola",
    );
    expect(intruder.status).toBe(404);
    expect(intruder.raw).toContain("ASSISTANT_CONVERSATION_NOT_FOUND");
    const intruderReverse = await askAssistantApi(
      request,
      token,
      proConversation.conversationId,
      "hola",
    );
    expect(intruderReverse.status).toBe(404);
  });
});
