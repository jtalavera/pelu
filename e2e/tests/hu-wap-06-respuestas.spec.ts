import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  API_BASE,
  apiGetJson,
  authHeaders,
  apiPutJson,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  setTenantFeatureFlag,
} from "../fixtures/api";
import {
  BOOKING_FLAG,
  WHATSAPP_FLAG,
  createClientApi,
  enableWhatsAppFlags,
  farFutureStart,
  hoursBefore,
  inboundOther,
  inboundReplyButton,
  inboundTemplateButton,
  inboundText,
  messageLog,
  optOutPhone,
  postWebhook,
  resetFake,
  restoreCatalog,
  restoreWhatsAppFlags,
  runReminders,
  sentMessages,
  sentReplies,
  setButtonRepliesEnabled,
  setConsentApi,
  setManageLinks,
  setRemindersEnabled,
  uniqueRecipient,
  waitForFinalStatus,
  type FakeSentMessage,
} from "../fixtures/whatsapp";

// HU-WAP-06 · Respuestas de la clienta: botones, baja y mensajes libres
// requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md
//
// Las respuestas llegan como las notificaciones de Meta, firmadas con el secreto de prueba. Los
// payloads de los botones se toman del recordatorio que el sistema realmente envió.
//
// Cobertura por criterio:
//  1 firma del webhook ............ firma inválida o ausente: 403 y no se procesa nada
//  2 procesamiento idempotente .... la misma notificación dos veces se atiende una vez
//  3 atribución al salón .......... payload alterado o de otro celular no actúa; el mensaje libre se atribuye
//                                    al único salón que escribió en 72 h
//  4 «Confirmo» ................... confirma el turno PENDING del salón y queda en la auditoría
//                                    (turno online sin aprobar: PENDIENTE de A4)
//  5 «No puedo ir» ................ pregunta con dos botones; solo «Sí, cancelar» cancela; fuera del plazo no cancela
//  6 baja y alta .................. BAJA / STOP / NO QUIERO (sin mayúsculas ni tildes) y ALTA, sin necesitar salón
//  7 mensaje libre ................ un texto fijo por celular cada 24 h
//  8 otros tipos .................. audios, imágenes, etc. se tratan como mensaje libre
//  9 privacidad de logs ........... verificado por revisión del código (no hay prueba e2e que lea los logs)
// 10 interruptor del salón ........ sin «Respuestas por botón» el recordatorio no lleva los botones y solo se
//                                    atienden BAJA / ALTA
//  Pendiente por depender de otros incrementos: enlace de gestión en la respuesta libre (A5) y plazo por
//  salón (RSV-02).

test.describe.configure({ mode: "serial" });

const TENANT_ID = 1;

test.describe("HU-WAP-06 · Respuestas de la clienta", () => {
  let token: string;
  let n = 0;
  const unique = (label: string) => `E2E WA06 ${label} ${Date.now()}${++n}`;

  test.beforeAll(async ({ request }) => {
    await enableWhatsAppFlags(request);
    token = await loginAsDemoApi(request);
  });

  test.beforeEach(async ({ request }) => {
    await restoreCatalog(request);
    await resetFake(request, token);
    await setRemindersEnabled(request, token, null);
    await setButtonRepliesEnabled(request, token, null);
    await setManageLinks(request, token, true);
  });

  test.afterAll(async ({ request }) => {
    await resetFake(request, token);
    await restoreCatalog(request);
    await setTenantFeatureFlag(request, TENANT_ID, WHATSAPP_FLAG, true);
    await setTenantFeatureFlag(request, TENANT_ID, BOOKING_FLAG, true);
    await restoreWhatsAppFlags(request);
  });

  type World = {
    to: ReturnType<typeof uniqueRecipient>;
    clientId: number;
    clientName: string;
    appointmentId: number;
    start: Date;
  };

  /** A client with consent and a turno; `start` defaults to a far-future day. */
  async function world(request: APIRequestContext, start?: Date): Promise<World> {
    const to = uniqueRecipient();
    const seed = await seedCategoryServiceProfessional(request, token);
    const clientName = unique("clienta");
    const client = await createClientApi(request, token, clientName, to.phoneForm);
    await apiPutJson(request, token, `/api/clients/${client.id}`, {
      fullName: clientName,
      phone: to.phoneForm,
      email: to.email,
      ruc: null,
    });
    expect((await setConsentApi(request, token, client.id, true)).ok()).toBeTruthy();
    const startAt = start ?? farFutureStart(15);
    const appt = await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: startAt.toISOString(),
    });
    return { to, clientId: client.id, clientName, appointmentId: appt.id, start: startAt };
  }

  const status = async (request: APIRequestContext, w: World) =>
    (await apiGetJson<{ status: string }>(request, token, `/api/appointments/${w.appointmentId}`)).status;
  const repliesTo = async (request: APIRequestContext, w: World) =>
    (await sentReplies(request, token)).filter((r) => r.to === w.to.phoneE164);
  const optedOut = async (request: APIRequestContext, phone: string) => {
    const res = await request.get(`${API_BASE}/api/admin/whatsapp-test-support/opt-outs`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return ((await res.json()) as Array<string | { phone: string }>).some(
      (o) => (typeof o === "string" ? o : o.phone) === phone,
    );
  };
  const send = async (request: APIRequestContext, payload: unknown) => {
    const res = await postWebhook(request, payload);
    expect(res.status()).toBe(200);
  };

  /** Runs the reminder job as of the morning of the turno and returns the reminder that went out. */
  async function reminderOf(request: APIRequestContext, w: World): Promise<FakeSentMessage> {
    await runReminders(request, token, hoursBefore(w.start, 6));
    const rows = (await messageLog(request, token)).filter((m) => m.appointmentId === w.appointmentId);
    expect(rows).toHaveLength(1);
    await waitForFinalStatus(request, token, rows[0].id);
    const sent = (await sentMessages(request, token)).filter((m) => m.to === w.to.phoneE164);
    expect(sent).toHaveLength(1);
    return sent[0];
  }
  const quick = (m: FakeSentMessage, index: number) =>
    m.buttons.find((b) => b.kind === "QUICK_REPLY" && b.index === index)!.value;

  const auditEntries = async (request: APIRequestContext, w: World, operation: string) => {
    const page = await apiGetJson<{ content: Array<{ operation: string | null; entityId: string | null }> }>(
      request,
      token,
      "/api/audit?resource=appointments&size=100",
    );
    return page.content.filter((a) => a.operation === operation && a.entityId === String(w.appointmentId));
  };

  // ── Criterio 1: firma ───────────────────────────────────────────────────────────────────────

  test("AC1: con firma inválida o ausente el webhook responde 403 y no procesa nada", async ({ request }) => {
    const w = await world(request);
    const body = inboundText(w.to.phoneE164, "BAJA");

    expect((await postWebhook(request, body, "sha256=deadbeef")).status()).toBe(403);
    expect((await postWebhook(request, body, null)).status()).toBe(403);

    expect(await optedOut(request, w.to.phoneE164)).toBe(false);
    expect(await repliesTo(request, w)).toHaveLength(0);
  });

  // ── Criterio 2: idempotencia ────────────────────────────────────────────────────────────────

  test("AC2: la misma notificación reenviada por Meta se atiende una sola vez", async ({ request }) => {
    const w = await world(request);
    const body = inboundText(w.to.phoneE164, "hola", "wamid.E2EDUP" + Date.now());

    await send(request, body);
    await send(request, body);

    expect(await repliesTo(request, w)).toHaveLength(1);
  });

  // ── Criterio 4: «Confirmo» ──────────────────────────────────────────────────────────────────

  test("AC4+10: el recordatorio lleva los botones y «Confirmo» confirma el turno del salón", async ({
    request,
  }) => {
    const w = await world(request);
    const reminder = await reminderOf(request, w);

    expect(reminder.buttons.map((b) => `${b.kind}:${b.index}`)).toEqual([
      "QUICK_REPLY:0",
      "QUICK_REPLY:1",
      "URL:2",
    ]);
    expect(await status(request, w)).toBe("PENDING");

    await send(request, inboundTemplateButton(w.to.phoneE164, quick(reminder, 0)));

    expect(await status(request, w)).toBe("CONFIRMED");
    const replies = await repliesTo(request, w);
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toContain("confirmado");
    expect(await auditEntries(request, w, "client-confirm")).toHaveLength(1);

    // Tapping again changes nothing.
    await send(request, inboundTemplateButton(w.to.phoneE164, quick(reminder, 0)));
    expect(await status(request, w)).toBe("CONFIRMED");
  });

  // ── Criterio 3: atribución ──────────────────────────────────────────────────────────────────

  test("AC3: un payload alterado, o tocado desde otro celular, no actúa sobre el turno", async ({ request }) => {
    const w = await world(request);
    const reminder = await reminderOf(request, w);
    const real = quick(reminder, 1); // «No puedo ir»

    await send(request, inboundTemplateButton(w.to.phoneE164, real.replace("CANT_GO", "CANCEL_YES")));
    await send(request, inboundTemplateButton(uniqueRecipient().phoneE164, quick(reminder, 0)));

    expect(await status(request, w)).toBe("PENDING");
    expect(await auditEntries(request, w, "client-confirm")).toHaveLength(0);
  });

  // ── Criterio 5: «No puedo ir» ───────────────────────────────────────────────────────────────

  test("AC5: «No puedo ir» pregunta primero; «No, mantener» deja el turno y «Sí, cancelar» lo cancela", async ({
    request,
  }) => {
    const w = await world(request);
    const reminder = await reminderOf(request, w);

    await send(request, inboundTemplateButton(w.to.phoneE164, quick(reminder, 1)));
    expect(await status(request, w)).toBe("PENDING"); // nothing cancelled by the first tap
    const question = (await repliesTo(request, w))[0];
    expect(question.buttons.map((b) => b.title)).toEqual(["Sí, cancelar", "No, mantener"]);

    await send(request, inboundReplyButton(w.to.phoneE164, question.buttons[1].id));
    expect(await status(request, w)).toBe("PENDING");
    expect((await repliesTo(request, w))[1].text).toContain("mantenemos");

    await send(request, inboundReplyButton(w.to.phoneE164, question.buttons[0].id));
    expect(await status(request, w)).toBe("CANCELLED");
    expect((await repliesTo(request, w))[2].text).toContain("cancelamos");
    expect(await auditEntries(request, w, "client-cancel")).toHaveLength(1);
  });

  test("AC5: fuera del plazo no se cancela y se da el contacto del salón", async ({ request }) => {
    // The deadline in e2e is 2 h: a turno in 1 h can no longer be cancelled by the client.
    const w = await world(request, new Date(Date.now() + 3_600_000));
    const reminder = await reminderOf(request, w);
    await send(request, inboundTemplateButton(w.to.phoneE164, quick(reminder, 1)));
    const question = (await repliesTo(request, w))[0];

    await send(request, inboundReplyButton(w.to.phoneE164, question.buttons[0].id));

    expect(await status(request, w)).toBe("PENDING");
    expect((await repliesTo(request, w))[1].text).toContain("Ya no se puede cancelar");
  });

  // ── Criterio 6: baja y alta ─────────────────────────────────────────────────────────────────

  for (const word of ["BAJA", "stop", "No quiero", " ¡baja! "]) {
    test(`AC6: «${word.trim()}» da de baja el celular y se confirma`, async ({ request }) => {
      const w = await world(request);

      await send(request, inboundText(w.to.phoneE164, word));

      expect(await optedOut(request, w.to.phoneE164)).toBe(true);
      expect((await repliesTo(request, w))[0].text).toContain("no vas a recibir");
    });
  }

  test("AC6: ALTA revierte la baja", async ({ request }) => {
    const w = await world(request);
    await optOutPhone(request, token, w.to.phoneE164);

    await send(request, inboundText(w.to.phoneE164, "alta"));

    expect(await optedOut(request, w.to.phoneE164)).toBe(false);
  });

  test("AC6: la baja vale aunque el celular no pertenezca a ningún salón", async ({ request }) => {
    const stranger = uniqueRecipient();
    await send(request, inboundText(stranger.phoneE164, "BAJA"));
    expect(await optedOut(request, stranger.phoneE164)).toBe(true);
  });

  // ── Criterios 7 y 8: mensajes libres ────────────────────────────────────────────────────────

  test("AC7: un mensaje libre recibe un texto fijo, una sola vez cada 24 horas", async ({ request }) => {
    const w = await world(request);

    await send(request, inboundText(w.to.phoneE164, "hola, ¿tienen lugar mañana?"));
    await send(request, inboundText(w.to.phoneE164, "¿hola?"));

    const replies = await repliesTo(request, w);
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toContain("solo envía avisos de turnos y no recibe consultas");
  });

  test("AC3+7: si un único salón le escribió en las últimas 72 h, la respuesta lo nombra", async ({ request }) => {
    const w = await world(request);
    await reminderOf(request, w);

    await send(request, inboundText(w.to.phoneE164, "hola"));

    const replies = await repliesTo(request, w);
    expect(replies[0].text).toContain("Para consultas, comunicate con");
  });

  test("AC8: audios, imágenes y otros tipos se tratan como mensaje libre", async ({ request }) => {
    const w = await world(request);

    await send(request, inboundOther(w.to.phoneE164, "audio"));

    expect((await repliesTo(request, w))[0].text).toContain("solo envía avisos de turnos");
  });

  // ── Criterio 10: interruptor del salón ──────────────────────────────────────────────────────

  test("AC10: con «Respuestas por botón» apagado el recordatorio no lleva «Confirmo» ni «No puedo ir»", async ({
    request,
  }) => {
    await setButtonRepliesEnabled(request, token, false);
    const w = await world(request);

    const reminder = await reminderOf(request, w);

    expect(reminder.buttons.map((b) => `${b.kind}:${b.index}`)).toEqual(["URL:2"]);
  });

  test("AC10: con el interruptor apagado un toque de botón no actúa, pero BAJA y ALTA sí", async ({ request }) => {
    const w = await world(request);
    const reminder = await reminderOf(request, w); // sent while the switch was on
    await setButtonRepliesEnabled(request, token, false);

    await send(request, inboundTemplateButton(w.to.phoneE164, quick(reminder, 0)));
    expect(await status(request, w)).toBe("PENDING");

    await send(request, inboundText(w.to.phoneE164, "BAJA"));
    expect(await optedOut(request, w.to.phoneE164)).toBe(true);
    await send(request, inboundText(w.to.phoneE164, "ALTA"));
    expect(await optedOut(request, w.to.phoneE164)).toBe(false);
  });
});
