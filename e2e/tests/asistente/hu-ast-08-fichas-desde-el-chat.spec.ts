import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { apiPostJson, loginAsDemoApi, seedCategoryServiceProfessional, type SeededSalon } from "../../fixtures/api";
import {
  askAssistantApi,
  askAssistantUi,
  assistantAnswers,
  auditRowsApi,
  backdateRecordApi,
  bookAppointmentToday,
  clientInvoicesApi,
  confirmDraftApi,
  createClientWithPhone,
  createOpenFichaWithServices,
  createProductApi,
  currentConversationApi,
  draftCards,
  enableAssistantGlobally,
  expireDraftApi,
  getAppointmentApi,
  getRecordApi,
  lastDraftCard,
  openAssistantPanel,
  proposeRecordViaApi,
  proposeViaApi,
  putRecordLinesApi,
  recordsOfClientApi,
  restoreAssistantGlobal,
  startNewConversationUi,
} from "../../fixtures/assistant";
import { loginAs, loginAsDemo } from "../../fixtures/auth";
import { createProfessional, loginApi, PASSWORD, professionalWithAccess } from "../../fixtures/commissions";

// HU-AST-08 · Crear y editar fichas de servicio desde el chat
// requirements/user_stories/HU-AST-08-fichas-de-servicio-desde-el-chat.md
//
// The scripted model understands «record <client> [new] [rec=ID] [apt=ID] [add <item> [xN] [at P] |
// remove N | set N xQ | set N with <professional>]». Each test uses its own client (and, when a turno
// is involved, its own professional) so tests never collide. A turno «de hoy» is booked a few
// minutes ahead (the agenda refuses a start in the past), so this spec is not meant to run in the
// last minutes before midnight in the salon's zone. AC15 across salons lives in
// tests/mt-isolation/mt-asistente.spec.ts.

const SUFFIX = String(Date.now()).slice(-7);

test.describe.configure({ mode: "serial" });

test.describe("HU-AST-08 · Fichas de servicio desde el chat", () => {
  let token: string;
  let salon: SeededSalon;
  let tinte: { id: number; name: string };
  let gel: { id: number; name: string };
  let n = 0;

  const newClient = (request: APIRequestContext) =>
    createClientWithPhone(request, token, `Ficha Chat ${SUFFIX} C${++n}Z`);
  const newPro = (request: APIRequestContext) => createProfessional(request, token, `E2E Pro ${SUFFIX} P${++n}Z`);
  const record = (client: { fullName: string }, rest = "") => `record ${client.fullName}${rest ? ` ${rest}` : ""}`;

  /** A professional with system access: her id, her login and her token. */
  async function proSession(request: APIRequestContext) {
    const name = `E2E Pro ${SUFFIX} P${++n}Z`;
    const pro = await professionalWithAccess(request, token, name);
    return { ...pro, name, token: await loginApi(request, pro.email) };
  }

  async function conversationOf(request: APIRequestContext, tok: string) {
    return (await currentConversationApi(request, tok)).conversationId;
  }

  async function ask(request: APIRequestContext, tok: string, text: string) {
    return askAssistantApi(request, tok, await conversationOf(request, tok), text);
  }

  async function open(page: Page) {
    await loginAsDemo(page);
    await openAssistantPanel(page);
    await startNewConversationUi(page);
  }

  /** The card of a draft, pinned by its id (`lastDraftCard` always points at the newest one). */
  async function pinned(page: Page, card: Locator) {
    const id = await card.getAttribute("data-draft-id");
    return page.locator(`[data-testid="assistant-draft-card"][data-draft-id="${id}"]`);
  }

  test.beforeAll(async ({ request }) => {
    await enableAssistantGlobally(request);
    token = await loginAsDemoApi(request);
    salon = await seedCategoryServiceProfessional(request, token);
    tinte = await apiPostJson<{ id: number; name: string }>(request, token, "/api/services", {
      name: `E2E Tinte ${SUFFIX}`,
      categoryId: salon.categoryId,
      priceMinor: 120000,
      durationMinutes: 30,
    });
    gel = await createProductApi(request, token, `E2E Gel ${SUFFIX}`, 20000);
  });
  test.afterAll(async ({ request }) => {
    await restoreAssistantGlobal(request);
  });

  test("AC1 · leer la ficha: la administradora ve montos, la profesional no ve ninguno", async ({ request }) => {
    const client = await newClient(request);
    const pro = await proSession(request);
    await createOpenFichaWithServices(request, token, {
      clientId: client.id,
      serviceIds: [salon.serviceId, tinte.id],
      professionalId: pro.id,
    });

    const admin = await ask(request, token, record(client));
    expect(admin.text).toContain(salon.serviceFullName);
    expect(admin.text).toContain("Gs. 50.000");
    expect(admin.text).toContain("Gs. 170.000");

    const asPro = await ask(request, pro.token, record(client));
    expect(asPro.text).toContain(salon.serviceFullName);
    expect(asPro.text).not.toContain("Gs.");
    expect(asPro.raw).not.toMatch(/unitPrice|lineTotal|"price"|"total"/);
  });

  test("AC2 · crear la ficha ligada al turno de hoy: tarjeta, «Guardar ficha», turno En curso", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    const pro = await newPro(request);
    const turno = await bookAppointmentToday(request, token, {
      clientId: client.id,
      serviceId: salon.serviceId,
      professionalId: pro.id,
    });
    await open(page);

    await askAssistantUi(page, record(client, `add ${tinte.name}`));

    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-type", "SERVICE_RECORD");
    await expect(card).toHaveAttribute("data-status", "DRAFT");
    const first = card.getByTestId("assistant-record-line-1");
    await expect(first).toContainText(salon.serviceFullName);
    await expect(first).toHaveAttribute("data-mark", "KEPT");
    const second = card.getByTestId("assistant-record-line-2");
    await expect(second).toContainText(tinte.name);
    await expect(second).toHaveAttribute("data-mark", "NEW");
    await expect(card.getByTestId("assistant-record-appointment")).toBeVisible();
    await expect(card.getByTestId("assistant-record-total")).toContainText("Gs. 170.000");
    await expect(card.getByTestId("assistant-draft-confirm")).toHaveText("Save record");
    await expect(assistantAnswers(page).last()).toContainText("Preparé la ficha");
    // Proposing wrote nothing.
    expect(await recordsOfClientApi(request, token, client.id)).toHaveLength(0);

    const saved = await pinned(page, card);
    await card.getByTestId("assistant-draft-confirm").click();
    await expect(saved).toHaveAttribute("data-status", "CONFIRMED");
    const records = await recordsOfClientApi(request, token, client.id);
    expect(records).toHaveLength(1);
    expect((await getRecordApi(request, token, records[0].id)).lines).toHaveLength(2);
    const appointment = await getAppointmentApi(request, token, turno.id);
    expect(appointment.status).toBe("IN_PROGRESS");
    expect(appointment.serviceRecordId).toBe(records[0].id);
  });

  test("AC3 · sin turno hoy la administradora crea la ficha suelta, solo con lo pedido", async ({ request }) => {
    const client = await newClient(request);

    const { draft } = await proposeRecordViaApi(request, token, record(client, `add ${salon.serviceFullName} x2`));

    expect(draft).not.toBeNull();
    expect(draft!.payload.appointmentId).toBeNull();
    expect(draft!.payload.serviceRecordId).toBeNull();
    expect(draft!.payload.lines).toHaveLength(1);
    expect(draft!.payload.lines[0].quantity).toBe(2);
    expect((await confirmDraftApi(request, token, draft!.id)).status()).toBe(200);
    const records = await recordsOfClientApi(request, token, client.id);
    expect(records).toHaveLength(1);
    const saved = await getRecordApi(request, token, records[0].id);
    expect(saved.appointmentId).toBeNull();
    expect(saved.lines.map((l) => l.quantity)).toEqual([2]);
  });

  test("AC4 · con varios turnos hoy pregunta cuál, y con el turno elegido prepara la tarjeta", async ({ request }) => {
    const client = await newClient(request);
    const pro1 = await newPro(request);
    const pro2 = await newPro(request);
    await bookAppointmentToday(request, token, { clientId: client.id, serviceId: salon.serviceId, professionalId: pro1.id });
    const second = await bookAppointmentToday(request, token, {
      clientId: client.id,
      serviceId: tinte.id,
      professionalId: pro2.id,
    });

    const asked = await proposeRecordViaApi(request, token, record(client, `add ${gel.name}`));
    expect(asked.draft).toBeNull();
    expect(asked.answer.text).toContain("varios turnos");

    const chosen = await proposeRecordViaApi(request, token, record(client, `apt=${second.id} add ${gel.name}`));
    expect(chosen.draft).not.toBeNull();
    expect(chosen.draft!.payload.appointmentId).toBe(second.id);
    expect(chosen.draft!.payload.lines[0].name).toContain(tinte.name);
  });

  test("AC5 · la profesional solo abre una ficha desde un turno propio de hoy", async ({ request }) => {
    const client = await newClient(request);
    const pro = await proSession(request);
    const other = await newPro(request);
    const othersTurno = await bookAppointmentToday(request, token, {
      clientId: client.id,
      serviceId: salon.serviceId,
      professionalId: other.id,
    });

    const none = await ask(request, pro.token, record(client, `add ${tinte.name}`));
    expect(none.events.some((e) => e.event === "card.draft")).toBe(false);
    expect(none.text).toContain("turno propio");

    const foreign = await ask(request, pro.token, record(client, `apt=${othersTurno.id} add ${tinte.name}`));
    expect(foreign.events.some((e) => e.event === "card.draft")).toBe(false);
    expect(foreign.text).toContain("APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL");
    expect(await recordsOfClientApi(request, token, client.id)).toHaveLength(0);
  });

  test("AC6 · editar la ficha abierta: agregar, cambiar cantidad, cambiar profesional y quitar", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    const pro = await newPro(request);
    const other = await newPro(request);
    const recordId = await createOpenFichaWithServices(request, token, {
      clientId: client.id,
      serviceIds: [salon.serviceId, tinte.id],
      professionalId: pro.id,
    });

    // Agregar (un producto, con cantidad) y guardar.
    const added = await proposeRecordViaApi(request, token, record(client, `add ${gel.name} x2`));
    expect(added.draft!.payload.serviceRecordId).toBe(recordId);
    expect(added.draft!.payload.lines.map((l) => l.mark)).toEqual(["KEPT", "KEPT", "NEW"]);
    expect((await confirmDraftApi(request, token, added.draft!.id)).status()).toBe(200);
    expect((await getRecordApi(request, token, recordId)).lines).toHaveLength(3);

    // Cambiar cantidad y profesional de la línea 1.
    const qty = await proposeRecordViaApi(request, token, record(client, "set 1 x3"));
    expect(qty.draft!.payload.lines[0].mark).toBe("CHANGED");
    expect((await confirmDraftApi(request, token, qty.draft!.id)).status()).toBe(200);
    const who = await proposeRecordViaApi(request, token, record(client, `set 1 with ${other.name}`));
    expect(who.draft!.payload.lines[0].professionalName).toBe(other.name); // the app upper-cases names
    expect((await confirmDraftApi(request, token, who.draft!.id)).status()).toBe(200);
    const edited = (await getRecordApi(request, token, recordId)).lines;
    expect(edited[0].quantity).toBe(3);
    expect(edited[0].professionalId).toBe(other.id);

    // Quitar la línea 2 (en pantalla: tachada y marcada), y guardar.
    await open(page);
    await askAssistantUi(page, record(client, "remove 2"));
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("assistant-record-line-removed-0")).toContainText(tinte.name);
    await expect(card.getByTestId("assistant-record-line-removed-0")).toHaveAttribute("data-mark", "REMOVED");
    await expect(card.getByTestId("assistant-record-line-2")).toContainText(gel.name);
    const saved = await pinned(page, card);
    await card.getByTestId("assistant-draft-confirm").click();
    await expect(saved).toHaveAttribute("data-status", "CONFIRMED");
    expect((await getRecordApi(request, token, recordId)).lines).toHaveLength(2);
  });

  test("AC7 · el precio dicho lo fija solo la administradora", async ({ request }) => {
    const client = await newClient(request);
    const pro = await newPro(request);
    await bookAppointmentToday(request, token, { clientId: client.id, serviceId: salon.serviceId, professionalId: pro.id });

    const priced = await proposeRecordViaApi(request, token, record(client, `add ${tinte.name} at 100000`));
    expect(priced.draft!.payload.lines[1].unitPrice).toBe(100000);
    expect(priced.draft!.payload.total).toBe(150000);
    expect((await confirmDraftApi(request, token, priced.draft!.id)).status()).toBe(200);
    const [saved] = await recordsOfClientApi(request, token, client.id);
    expect((await getRecordApi(request, token, saved.id)).lines.map((l) => l.unitPrice)).toContain(100000);

    // La profesional no puede fijar precios: se rechaza y se le explica.
    const asPro = await proSession(request);
    const other = await newClient(request);
    const refused = await ask(request, asPro.token, record(other, `add ${tinte.name} at 100000`));
    expect(refused.events.some((e) => e.event === "card.draft")).toBe(false);
    expect(refused.text).toContain("No podés fijar precios");
  });

  test("AC8 · la profesional nunca ve montos: ni en la tarjeta, ni al recargar, ni al guardar", async ({
    page,
    request,
  }) => {
    // Por la API: nada de montos en el borrador, en el resultado de guardar ni en el historial.
    const client = await newClient(request);
    const pro = await proSession(request);
    await bookAppointmentToday(request, token, { clientId: client.id, serviceId: salon.serviceId, professionalId: pro.id });
    const proposed = await ask(request, pro.token, record(client, `add ${tinte.name}`));
    const card = proposed.events.find((e) => e.event === "card.draft");
    expect(card).toBeTruthy();
    expect(JSON.stringify(card!.data)).not.toMatch(/unitPrice|lineTotal|"total"/);
    expect(proposed.text).not.toContain("Gs.");
    const saved = await confirmDraftApi(request, pro.token, String(card!.data.id));
    expect(saved.status()).toBe(200);
    expect(await saved.text()).not.toMatch(/unitPrice|lineTotal|"total"/);
    expect(JSON.stringify(await currentConversationApi(request, pro.token))).not.toMatch(/unitPrice|lineTotal/);

    // En pantalla, con su propia sesión: la tarjeta no tiene montos ni total, tampoco al recargar.
    const pro2 = await proSession(request);
    const client2 = await newClient(request);
    await bookAppointmentToday(request, token, { clientId: client2.id, serviceId: salon.serviceId, professionalId: pro2.id });
    await loginAs(page, pro2.email, PASSWORD);
    await openAssistantPanel(page);
    await startNewConversationUi(page);
    await askAssistantUi(page, record(client2, `add ${tinte.name}`));
    const proCard = lastDraftCard(page);
    await expect(proCard).toBeVisible({ timeout: 20_000 });
    await expect(proCard.getByTestId("assistant-record-line-2")).toContainText(tinte.name);
    await expect(proCard.getByTestId("assistant-record-total")).toHaveCount(0);
    await expect(proCard).not.toContainText("Gs.");
    await page.reload();
    await openAssistantPanel(page);
    await expect(draftCards(page).last()).toBeVisible();
    await expect(draftCards(page).last()).not.toContainText("Gs.");
  });

  test("AC9 · varias fichas abiertas, o una de un día anterior: pregunta antes de tocar nada", async ({ request }) => {
    const client = await newClient(request);
    const pro = await newPro(request);
    const first = await createOpenFichaWithServices(request, token, {
      clientId: client.id,
      serviceIds: [salon.serviceId],
      professionalId: pro.id,
    });
    const second = await createOpenFichaWithServices(request, token, {
      clientId: client.id,
      serviceIds: [tinte.id],
      professionalId: pro.id,
    });

    const asked = await proposeRecordViaApi(request, token, record(client, `add ${gel.name}`));
    expect(asked.draft).toBeNull();
    expect(asked.answer.text).toContain("varias fichas");
    const chosen = await proposeRecordViaApi(request, token, record(client, `rec=${second} add ${gel.name}`));
    expect(chosen.draft!.payload.serviceRecordId).toBe(second);

    // Una sola ficha, pero de un día anterior: ni se edita sola ni bloquea abrir la de hoy.
    const old = await newClient(request);
    const oldRecord = await createOpenFichaWithServices(request, token, {
      clientId: old.id,
      serviceIds: [salon.serviceId],
      professionalId: pro.id,
    });
    await backdateRecordApi(request, token, oldRecord, 3);
    const stale = await proposeRecordViaApi(request, token, record(old, `add ${gel.name}`));
    expect(stale.draft).toBeNull();
    expect(stale.answer.text).toContain("día anterior");
    const edit = await proposeRecordViaApi(request, token, record(old, `rec=${oldRecord} add ${gel.name}`));
    expect(edit.draft!.payload.serviceRecordId).toBe(oldRecord);
    const fresh = await proposeRecordViaApi(request, token, record(old, `new add ${gel.name}`));
    expect(fresh.draft, fresh.answer.text).not.toBeNull();
    expect(fresh.draft!.payload.serviceRecordId).toBeNull();
    expect(first).not.toBe(second);
  });

  test("AC9 · la profesional no ve las fichas de días anteriores", async ({ request }) => {
    const client = await newClient(request);
    const pro = await proSession(request);
    const oldRecord = await createOpenFichaWithServices(request, token, {
      clientId: client.id,
      serviceIds: [salon.serviceId],
      professionalId: pro.id,
    });
    await backdateRecordApi(request, token, oldRecord, 3);
    await bookAppointmentToday(request, token, { clientId: client.id, serviceId: tinte.id, professionalId: pro.id });

    const answer = await ask(request, pro.token, record(client, `add ${gel.name}`));

    const card = answer.events.find((e) => e.event === "card.draft");
    expect(card).toBeTruthy();
    const payload = (card!.data as unknown as { payload: { serviceRecordId: number | null; appointmentId: number | null } })
      .payload;
    expect(payload.serviceRecordId).toBeNull(); // opens from her turno, never edits yesterday's
    expect(payload.appointmentId).not.toBeNull();
  });

  test("AC10 · un segundo pedido se suma a la tarjeta pendiente y la anterior queda «Reemplazado»", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    const pro = await newPro(request);
    await createOpenFichaWithServices(request, token, {
      clientId: client.id,
      serviceIds: [salon.serviceId],
      professionalId: pro.id,
    });
    await open(page);

    await askAssistantUi(page, record(client, `add ${tinte.name}`));
    const firstCard = lastDraftCard(page);
    await expect(firstCard).toBeVisible({ timeout: 20_000 });
    const first = await pinned(page, firstCard);
    await expect(draftCards(page)).toHaveCount(1);

    await askAssistantUi(page, record(client, "remove 1"));
    await expect(draftCards(page)).toHaveCount(2, { timeout: 20_000 });
    await expect(first).toHaveAttribute("data-status", "SUPERSEDED");
    const second = lastDraftCard(page);
    // La lista que se numera es la de la tarjeta: «1» era el servicio de la ficha, y el tinte sigue.
    await expect(second.getByTestId("assistant-record-line-1")).toContainText(tinte.name);
    await expect(second.getByTestId("assistant-record-line-1")).toHaveAttribute("data-mark", "NEW");
    await expect(second.getByTestId("assistant-record-line-removed-0")).toContainText(salon.serviceFullName);
  });

  test("AC11 · si la ficha cambió antes de guardar, la tarjeta se rehace y pide confirmar de nuevo", async ({
    page,
    request,
  }) => {
    const client = await newClient(request);
    const pro = await newPro(request);
    const recordId = await createOpenFichaWithServices(request, token, {
      clientId: client.id,
      serviceIds: [salon.serviceId],
      professionalId: pro.id,
    });
    await open(page);
    await askAssistantUi(page, record(client, `add ${tinte.name}`));
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    const pending = await pinned(page, card);

    // Mientras tanto alguien cambia la cantidad en la pantalla de Fichas.
    await putRecordLinesApi(request, token, recordId, client.id, [
      { serviceId: salon.serviceId, professionalId: pro.id, quantity: 2, unitPrice: 50000 },
    ]);
    await card.getByTestId("assistant-draft-confirm").click();

    await expect(pending.getByTestId("assistant-record-changed")).toBeVisible();
    await expect(pending).toHaveAttribute("data-status", "DRAFT");
    expect((await getRecordApi(request, token, recordId)).lines).toHaveLength(1);
    await pending.getByTestId("assistant-draft-confirm").click();
    await expect(pending).toHaveAttribute("data-status", "CONFIRMED");
    const lines = (await getRecordApi(request, token, recordId)).lines;
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.serviceId === salon.serviceId)!.quantity).toBe(2);
  });

  test("AC11 · lo que ya no tiene su línea se informa como «no aplicado» y el resto se conserva", async ({
    request,
  }) => {
    const client = await newClient(request);
    const pro = await newPro(request);
    const recordId = await createOpenFichaWithServices(request, token, {
      clientId: client.id,
      serviceIds: [salon.serviceId],
      professionalId: pro.id,
    });
    await proposeRecordViaApi(request, token, record(client, `add ${gel.name}`));
    const { draft } = await proposeRecordViaApi(request, token, record(client, "remove 1"));
    // La línea del servicio desaparece de la ficha antes del botón.
    await putRecordLinesApi(request, token, recordId, client.id, [
      { serviceId: tinte.id, professionalId: pro.id, quantity: 1, unitPrice: 120000 },
    ]);

    const res = await confirmDraftApi(request, token, draft!.id);

    expect(res.status()).toBe(409);
    const body = (await res.json()) as { error: string; draft: RecordDraftBody };
    expect(body.error).toBe("ASSISTANT_RECORD_CHANGED");
    expect(body.draft.payload.notApplied).toHaveLength(1);
    expect((await confirmDraftApi(request, token, draft!.id)).status()).toBe(200);
  });

  test("AC12 · dos toques a la vez guardan una sola ficha; el segundo responde 409", async ({ request }) => {
    const client = await newClient(request);
    const { draft } = await proposeRecordViaApi(request, token, record(client, `add ${salon.serviceFullName}`));

    const [a, b] = await Promise.all([
      confirmDraftApi(request, token, draft!.id),
      confirmDraftApi(request, token, draft!.id),
    ]);

    expect([a.status(), b.status()].sort()).toEqual([200, 409]);
    const loser = a.status() === 409 ? a : b;
    expect(((await loser.json()) as { error: string }).error).toBe("ASSISTANT_DRAFT_ALREADY_CONFIRMED");
    expect(await recordsOfClientApi(request, token, client.id)).toHaveLength(1);
  });

  test("AC13 · descartar, vencer y recargar", async ({ page, request }) => {
    const client = await newClient(request);
    await open(page);

    // «Descartar» en la tarjeta: atenuada, sin tocar nada.
    await askAssistantUi(page, record(client, `add ${salon.serviceFullName}`));
    const card = lastDraftCard(page);
    await expect(card).toBeVisible({ timeout: 20_000 });
    const discarded = await pinned(page, card);
    await card.getByTestId("assistant-draft-discard").click();
    await expect(discarded).toHaveAttribute("data-status", "DISCARDED");
    expect(await recordsOfClientApi(request, token, client.id)).toHaveLength(0);

    // Pedirlo por el chat también la descarta.
    await askAssistantUi(page, record(client, `add ${tinte.name}`));
    const second = await pinned(page, lastDraftCard(page));
    await askAssistantUi(page, "discard the draft");
    await expect(second).toHaveAttribute("data-status", "DISCARDED");

    // Un borrador que vence no se puede guardar.
    const { draft } = await proposeRecordViaApi(request, token, record(client, `add ${gel.name}`));
    await expireDraftApi(request, token, draft!.id);
    const expired = await confirmDraftApi(request, token, draft!.id);
    expect(expired.status()).toBe(409);
    expect(((await expired.json()) as { error: string }).error).toBe("ASSISTANT_DRAFT_EXPIRED");

    // Guardada y recargada: la tarjeta sigue ahí, en verde.
    const saveClient = await newClient(request);
    await startNewConversationUi(page);
    await askAssistantUi(page, record(saveClient, `add ${salon.serviceFullName}`));
    const toSave = lastDraftCard(page);
    await expect(toSave).toBeVisible({ timeout: 20_000 });
    const id = await toSave.getAttribute("data-draft-id");
    await toSave.getByTestId("assistant-draft-confirm").click();
    await expect(page.locator(`[data-draft-id="${id}"]`)).toHaveAttribute("data-status", "CONFIRMED");
    await page.reload();
    await openAssistantPanel(page);
    await expect(page.locator(`[data-draft-id="${id}"]`)).toHaveAttribute("data-status", "CONFIRMED");
    await expect(page.locator(`[data-draft-id="${id}"]`).getByTestId("assistant-draft-confirm")).toHaveCount(0);
  });

  test("AC14 · facturar con una ficha sin guardar no la reemplaza: pide guardarla antes", async ({ request }) => {
    const client = await newClient(request);
    const pro = await newPro(request);
    await createOpenFichaWithServices(request, token, {
      clientId: client.id,
      serviceIds: [salon.serviceId],
      professionalId: pro.id,
    });
    const pending = await proposeRecordViaApi(request, token, record(client, `add ${tinte.name}`));

    const blocked = await proposeViaApi(request, token, `invoice ${client.fullName}`);

    expect(blocked.draft).toBeNull();
    expect(blocked.answer.text).toContain("ficha sin guardar");
    expect(await clientInvoicesApi(request, token, client.id)).toHaveLength(0);
    // La tarjeta de la ficha sigue viva: se puede guardar.
    expect((await confirmDraftApi(request, token, pending.draft!.id)).status()).toBe(200);
    // Con la ficha guardada, la factura sale de ella, con lo que se agregó.
    const invoice = await proposeViaApi(request, token, `invoice ${client.fullName}`);
    expect(invoice.draft!.type).toBe("INVOICE");
    expect(invoice.draft!.payload.lines.map((l) => l.name).join(" ")).toContain(tinte.name);
  });

  test("AC15 · un borrador de ficha es de quien lo pidió: otra persona no puede guardarlo", async ({ request }) => {
    const client = await newClient(request);
    const { draft } = await proposeRecordViaApi(request, token, record(client, `add ${salon.serviceFullName}`));
    const stranger = await proSession(request);

    const res = await confirmDraftApi(request, stranger.token, draft!.id);

    expect(res.status()).toBe(404);
    expect(await recordsOfClientApi(request, token, client.id)).toHaveLength(0);
  });

  test("AC16 · guardar la ficha deja su fila en la auditoría", async ({ request }) => {
    const client = await newClient(request);
    const { draft } = await proposeRecordViaApi(request, token, record(client, `add ${salon.serviceFullName}`));
    const saved = await confirmDraftApi(request, token, draft!.id);
    expect(saved.status()).toBe(200);
    const recordId = ((await saved.json()) as { serviceRecordId: number }).serviceRecordId;

    const rows = await auditRowsApi(request, token, "service-records");

    expect(rows.some((r) => r.operation === "create" && r.entityId === String(recordId))).toBe(true);
  });
});

type RecordDraftBody = { payload: { notApplied: Array<{ op: string; name: string }> } };
