import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  API_BASE,
  authHeaders,
  createAppointmentApi,
  loginAsDemoApi,
  putProfessionalSchedules,
  seedCategoryServiceProfessional,
  type SeededSalon,
} from "../../fixtures/api";
import {
  askAssistantUi,
  assistantAnswers,
  businessInstant,
  businessTomorrow,
  confirmDraftApi,
  createClientWithPhone,
  currentConversationApi,
  draftCards,
  enableAssistantGlobally,
  expireDraftApi,
  lastDraftCard,
  openAssistantPanel,
  proposeAppointmentViaApi,
  restoreAssistantGlobal,
  startNewConversationUi,
  workingWeek,
} from "../../fixtures/assistant";
import { loginAs, loginAsDemo } from "../../fixtures/auth";
import { createProfessional, loginApi, PASSWORD, professionalWithAccess } from "../../fixtures/commissions";

// HU-AST-06 · Agendar un turno desde el chat
// requirements/user_stories/HU-AST-06-agendar-turno-desde-el-chat.md
//
// The scripted model understands «book <client> for <service> <day> at HH:mm [with <pro>]». Every
// test gets its own professional (09:00–17:00 every day) so appointments never collide between
// tests. The seeded service lasts 60 minutes. AC14 (isolation) lives in
// tests/mt-isolation/mt-asistente.spec.ts.

const SUFFIX = String(Date.now()).slice(-7);

test.describe.configure({ mode: "serial" });

test.describe("HU-AST-06 · Agendar un turno desde el chat", () => {
  let token: string;
  let salon: SeededSalon;
  let n = 0;
  const tomorrow = businessTomorrow();

  const newClient = (request: APIRequestContext) =>
    createClientWithPhone(request, token, `Asistente Turno ${SUFFIX} ${++n}`);

  async function newProfessional(request: APIRequestContext) {
    const pro = await createProfessional(request, token, `E2E Turno ${SUFFIX} ${++n}`);
    await putProfessionalSchedules(request, token, pro.id, workingWeek());
    return pro;
  }

  const bookText = (client: string, when: string, time: string, pro?: string) =>
    `book ${client} for ${salon.serviceFullName} ${when} at ${time}${pro ? ` with ${pro}` : ""}`;

  async function appointmentsOf(request: APIRequestContext, professionalId: number) {
    const from = businessInstant(tomorrow, "00:00").toISOString();
    const to = businessInstant(tomorrow, "23:59").toISOString();
    const res = await request.get(`${API_BASE}/api/appointments`, {
      headers: authHeaders(token),
      params: { from, to, professionalId },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()) as Array<{ id: number; status: string; startAt: string }>;
  }

  async function open(page: Page) {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);
  }

  test.beforeAll(async ({ request }) => {
    await enableAssistantGlobally(request);
    token = await loginAsDemoApi(request);
    salon = await seedCategoryServiceProfessional(request, token);
  });
  test.afterAll(async ({ request }) => {
    await restoreAssistantGlobal(request);
  });

  test("AC1 · «agendá a …» deja una tarjeta de borrador y no crea ningún turno", async ({ page, request }) => {
    const client = await newClient(request);
    const pro = await newProfessional(request);
    await open(page);

    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "10:00", pro.name));

    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-type", "APPOINTMENT");
    await expect(card).toHaveAttribute("data-status", "DRAFT");
    await expect(card.getByTestId("assistant-draft-client")).toHaveText(new RegExp(client.fullName, "i"));
    await expect(card.getByTestId("assistant-draft-service")).toHaveText(salon.serviceFullName);
    await expect(card.getByTestId("assistant-draft-when")).toContainText("10:00 – 11:00");
    await expect(card.getByTestId("assistant-draft-professional")).toHaveText(pro.name);
    await expect(card).toContainText("60 min");
    await expect(card.getByTestId("assistant-draft-confirm")).toHaveText("Confirm and book");
    await expect(assistantAnswers(page).last()).toContainText("Preparé el borrador");
    expect(await appointmentsOf(request, pro.id)).toHaveLength(0);
  });

  test("AC2 · sin profesional se elige una que esté libre a esa hora", async ({ request }) => {
    const client = await newClient(request);
    const busy = await newProfessional(request);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: busy.id,
      serviceId: salon.serviceId,
      startAt: businessInstant(tomorrow, "10:00").toISOString(),
    });

    const { draft } = await proposeAppointmentViaApi(request, token, bookText(client.fullName, "tomorrow", "10:00"));

    expect(draft).not.toBeNull();
    expect(draft!.payload.professionalId).not.toBe(busy.id);
    expect(draft!.payload.time).toBe("10:00");
  });

  test("AC3 · horario ocupado al proponer: no hay borrador y ofrece alternativas como botones", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    const pro = await newProfessional(request);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: pro.id,
      serviceId: salon.serviceId,
      startAt: businessInstant(tomorrow, "10:00").toISOString(),
    });
    await open(page);

    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "10:00", pro.name));

    await expect(assistantAnswers(page).last()).toContainText("ocupado", { timeout: 20_000 });
    await expect(draftCards(page)).toHaveCount(0);
    const chips = page.getByTestId("assistant-option");
    await expect(chips.first()).toBeVisible();
    expect(await chips.allTextContents()).not.toContain("10:00");
  });

  test("AC4 · horario ocupado al confirmar: 409, el borrador sigue y se mueve a otro horario", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    const pro = await newProfessional(request);
    await open(page);
    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "10:00", pro.name));
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    // Someone else takes the time while the card is open.
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: pro.id,
      serviceId: salon.serviceId,
      startAt: businessInstant(tomorrow, "10:00").toISOString(),
    });

    await card.getByTestId("assistant-draft-confirm").click();

    await expect(card.getByTestId("assistant-draft-error")).toContainText("just taken");
    await expect(card).toHaveAttribute("data-status", "DRAFT");
    const alternatives = card.getByTestId("assistant-draft-alternative");
    await expect(alternatives.first()).toBeVisible();
    await alternatives.first().click();
    await expect(card.getByTestId("assistant-draft-alternative")).toHaveCount(0);
    await expect(card.getByTestId("assistant-draft-when")).not.toContainText("10:00 –");

    await card.getByTestId("assistant-draft-confirm").click();
    await expect(card).toHaveAttribute("data-status", "CONFIRMED", { timeout: 20_000 });
    expect(await appointmentsOf(request, pro.id)).toHaveLength(2); // the one that took 10:00 + ours
  });

  test("AC5 · fuera del horario de trabajo: avisa pero igual se puede agendar", async ({ page, request }) => {
    const client = await newClient(request);
    const pro = await newProfessional(request);
    await open(page);

    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "20:00", pro.name));

    const card = lastDraftCard(page);
    await expect(card.getByTestId("assistant-draft-outside-hours")).toContainText(pro.name, { timeout: 20_000 });
    await expect(card.getByTestId("assistant-draft-confirm")).toBeEnabled();
    await card.getByTestId("assistant-draft-confirm").click();
    await expect(card).toHaveAttribute("data-status", "CONFIRMED", { timeout: 20_000 });
  });

  test("AC6 · un horario que ya pasó no genera borrador", async ({ page, request }) => {
    const client = await newClient(request);
    const pro = await newProfessional(request);
    await open(page);

    await askAssistantUi(page, bookText(client.fullName, "2020-01-01", "10:00", pro.name));

    await expect(assistantAnswers(page).last()).toContainText("ya pasó", { timeout: 20_000 });
    await expect(draftCards(page)).toHaveCount(0);
  });

  test("AC7 · pedir otra hora reemplaza el borrador: el anterior queda «Reemplazado»", async ({ page, request }) => {
    const client = await newClient(request);
    const pro = await newProfessional(request);
    await open(page);
    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "10:00", pro.name));
    await expect(draftCards(page)).toHaveCount(1, { timeout: 20_000 });

    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "11:00", pro.name));

    await expect(draftCards(page)).toHaveCount(2, { timeout: 20_000 });
    await expect(draftCards(page).first()).toHaveAttribute("data-status", "SUPERSEDED");
    await expect(draftCards(page).first().getByTestId("assistant-draft-confirm")).toHaveCount(0);
    await expect(lastDraftCard(page)).toHaveAttribute("data-status", "DRAFT");
    await expect(lastDraftCard(page).getByTestId("assistant-draft-when")).toContainText("11:00 – 12:00");
  });

  test("AC8 · confirmar crea el turno Pendiente y «Ver en la agenda» abre su detalle (agenda ya abierta)", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    const pro = await newProfessional(request);
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await openAssistantPanel(page);
    await startNewConversationUi(page);
    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "10:00", pro.name));
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });

    await card.getByTestId("assistant-draft-confirm").click();

    await expect(card).toHaveAttribute("data-status", "CONFIRMED", { timeout: 20_000 });
    await expect(card).toContainText("Appointment booked");
    const created = await appointmentsOf(request, pro.id);
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe("PENDING");

    await card.getByTestId("assistant-draft-view-agenda").click();
    // The agenda was already open: it follows the new target and opens that appointment's detail.
    await expect(page.getByRole("dialog").filter({ hasText: new RegExp(client.fullName, "i") })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("AC9 · dos confirmaciones a la vez crean un solo turno; la segunda es 409 con el resultado original", async ({
    request,
  }) => {
    const client = await newClient(request);
    const pro = await newProfessional(request);
    const { draft } = await proposeAppointmentViaApi(request, token, bookText(client.fullName, "tomorrow", "10:00", pro.name));

    const [a, b] = await Promise.all([
      confirmDraftApi(request, token, draft!.id),
      confirmDraftApi(request, token, draft!.id),
    ]);

    expect([a.status(), b.status()].sort()).toEqual([200, 409]);
    const loser = a.status() === 409 ? a : b;
    expect(await loser.text()).toContain("ASSISTANT_DRAFT_ALREADY_CONFIRMED");
    expect(await appointmentsOf(request, pro.id)).toHaveLength(1);
  });

  test("AC10 · escribir «sí» no agenda nada", async ({ page, request }) => {
    const client = await newClient(request);
    const pro = await newProfessional(request);
    await open(page);
    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "10:00", pro.name));
    await expect(lastDraftCard(page)).toBeVisible({ timeout: 20_000 });

    await askAssistantUi(page, "yes");
    await askAssistantUi(page, "dale, confirmá");

    await expect(assistantAnswers(page)).toHaveCount(3, { timeout: 20_000 });
    await expect(lastDraftCard(page)).toHaveAttribute("data-status", "DRAFT");
    expect(await appointmentsOf(request, pro.id)).toHaveLength(0);
  });

  test("AC11 · descartar (botón o chat) y vencimiento a las 24 h", async ({ page, request }) => {
    const client = await newClient(request);
    const pro = await newProfessional(request);
    await open(page);
    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "10:00", pro.name));
    await expect(lastDraftCard(page)).toBeVisible({ timeout: 20_000 });

    // Button.
    await lastDraftCard(page).getByTestId("assistant-draft-discard").click();
    await expect(lastDraftCard(page)).toHaveAttribute("data-status", "DISCARDED");

    // By chat.
    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "11:00", pro.name));
    await expect(lastDraftCard(page)).toHaveAttribute("data-status", "DRAFT", { timeout: 20_000 });
    await askAssistantUi(page, "discard the draft");
    await expect(lastDraftCard(page)).toHaveAttribute("data-status", "DISCARDED", { timeout: 20_000 });

    // Expiry: the e2e-only support endpoint moves the 24 h deadline into the past.
    const { draft } = await proposeAppointmentViaApi(request, token, bookText(client.fullName, "tomorrow", "12:00", pro.name));
    await expireDraftApi(request, token, draft!.id);
    const expired = await confirmDraftApi(request, token, draft!.id);
    expect(expired.status()).toBe(409);
    expect(await expired.text()).toContain("ASSISTANT_DRAFT_EXPIRED");
    expect(await appointmentsOf(request, pro.id)).toHaveLength(0);
  });

  test("AC12 · una profesional solo agenda para sí misma y no confirma el borrador de otra persona", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    const other = await newProfessional(request);
    const me = await professionalWithAccess(request, token, `E2E Turno Pro ${SUFFIX} ${++n}`);
    await putProfessionalSchedules(request, token, me.id, workingWeek());
    const myToken = await loginApi(request, me.email);

    // The administrator's draft is not hers to confirm.
    const { draft } = await proposeAppointmentViaApi(request, token, bookText(client.fullName, "tomorrow", "10:00", other.name));
    expect((await confirmDraftApi(request, myToken, draft!.id)).status()).toBe(404);

    await loginAs(page, me.email, PASSWORD);
    await openAssistantPanel(page);

    // Without naming anyone, the appointment is hers.
    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "10:00"));
    await expect(lastDraftCard(page)).toBeVisible({ timeout: 20_000 });
    await expect(lastDraftCard(page).getByTestId("assistant-draft-professional")).toContainText(
      /E2E Turno Pro/i,
    );

    // Naming someone else gets an explanation and no new card.
    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "11:00", other.name));
    await expect(assistantAnswers(page).last()).toContainText("vos misma", { timeout: 20_000 });
    await expect(draftCards(page)).toHaveCount(1);

    await lastDraftCard(page).getByTestId("assistant-draft-confirm").click();
    await expect(lastDraftCard(page)).toHaveAttribute("data-status", "CONFIRMED", { timeout: 20_000 });
    expect(await appointmentsOf(request, me.id)).toHaveLength(1);
  });

  test("AC13 · al recargar y reabrir el asistente, la tarjeta sigue ahí con su estado", async ({ page, request }) => {
    const client = await newClient(request);
    const pro = await newProfessional(request);
    await open(page);
    await askAssistantUi(page, bookText(client.fullName, "tomorrow", "10:00", pro.name));
    await expect(lastDraftCard(page)).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await openAssistantPanel(page);
    await expect(lastDraftCard(page)).toHaveAttribute("data-status", "DRAFT");
    await expect(lastDraftCard(page).getByTestId("assistant-draft-when")).toContainText("10:00 – 11:00");

    await lastDraftCard(page).getByTestId("assistant-draft-confirm").click();
    await expect(lastDraftCard(page)).toHaveAttribute("data-status", "CONFIRMED", { timeout: 20_000 });
    await page.reload();
    await openAssistantPanel(page);
    await expect(lastDraftCard(page)).toHaveAttribute("data-status", "CONFIRMED");
    await expect(lastDraftCard(page).getByTestId("assistant-draft-view-agenda")).toBeVisible();
    expect((await currentConversationApi(request, token)).conversationId).toBeGreaterThan(0);
  });
});
