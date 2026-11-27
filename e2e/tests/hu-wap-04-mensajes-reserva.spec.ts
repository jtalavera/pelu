import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  API_BASE,
  apiPutJson,
  authHeaders,
  calendarVisibleWeekSlotIso,
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
  expediteRetries,
  failNext,
  messageLog,
  optOutPhone,
  restoreCatalog,
  restoreWhatsAppFlags,
  sendBookingNotice,
  sentEmails,
  sentMessages,
  setBookingNoticesEnabled,
  setConsentApi,
  uniqueRecipient,
  waitForFinalStatus,
  type BookingEventName,
  type WhatsAppLogRow,
} from "../fixtures/whatsapp";

// HU-WAP-04 · Mensajes de la reserva: confirmación, pendiente, rechazo, propuesta y cancelación
// requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md
//
// Lo que existe hoy es el MOTOR de estos mensajes (BookingNotifier). La reserva online (A4), el
// enlace de gestión (A5) y la aprobación de solicitudes (A6) todavía no existen, así que ningún flujo
// real lo dispara: estos tests lo ejercitan con un disparador de soporte que hace lo que esos flujos
// harán (llamar al motor dentro de su transacción).
//
// Cobertura por criterio:
//  1 eventos y plantillas ........ las cinco, con sus variables y su botón
//  2 destinatario ................. turno del salón: celular y consentimiento de la clienta; turno online:
//                                    su contacto propio; sin consentimiento vigente ni baja (RT-11)
//  3 una vez por evento ........... mismo evento y horario no se duplica (WhatsApp ni email)
//  4 después del commit ........... una transacción revertida no deja mensaje; un envío fallido no revierte
//  5 reprogramación y cancelación . el horario nuevo, nueva confirmación y se anula lo viejo en cola
//  6 respaldo ..................... email con el mismo contenido; sin canal queda registrado
//  7 contenido mínimo ............. solo lo que lleva la plantilla
//  8 turnos del salón ............. crear un turno desde la agenda no envía nada
//  9 motivo del rechazo ........... no existe en el motor: la plantilla no lo admite
//  Pendiente por depender de otros incrementos: «Requiere atención» en la app (A6, RSV-07).

test.describe.configure({ mode: "serial" });

const TENANT_ID = 1;
const LINK = "bella/turno/tok123";
const WEEKDAY = /^(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d{2}\/\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

test.describe("HU-WAP-04 · Mensajes de la reserva", () => {
  let token: string;
  let n = 0;
  const unique = (label: string) => `E2E WA04 ${label} ${Date.now()}${++n}`;

  test.beforeAll(async ({ request }) => {
    await enableWhatsAppFlags(request);
    token = await loginAsDemoApi(request);
  });

  test.beforeEach(async ({ request }) => {
    await restoreCatalog(request);
    await setBookingNoticesEnabled(request, token, null);
  });

  test.afterAll(async ({ request }) => {
    await setBookingNoticesEnabled(request, token, null);
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
    serviceName: string;
    professionalName: string;
    professionalId: number;
    serviceId: number;
  };

  /** A client with a phone (and email), a consent if asked, and a turno. */
  async function world(
    request: APIRequestContext,
    opts: { consent?: boolean; hour?: number; withEmail?: boolean } = {},
  ): Promise<World> {
    const to = uniqueRecipient();
    const seed = await seedCategoryServiceProfessional(request, token);
    const clientName = unique("clienta");
    const client = await createClientApi(request, token, clientName, to.phoneForm);
    if (opts.consent !== false) {
      expect((await setConsentApi(request, token, client.id, true)).ok()).toBeTruthy();
    }
    if (opts.withEmail !== false) {
      await apiPutJson(request, token, `/api/clients/${client.id}`, {
        fullName: clientName,
        phone: to.phoneForm,
        email: to.email,
        ruc: null,
      });
      if (opts.consent !== false) {
        // The edit above kept the same number, so the consent stays; make sure.
        expect((await setConsentApi(request, token, client.id, true)).ok()).toBeTruthy();
      }
    }
    const appt = await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(opts.hour ?? 11, 0),
    });
    return {
      to,
      clientId: client.id,
      clientName,
      appointmentId: appt.id,
      serviceName: seed.serviceFullName,
      professionalName: seed.professionalFullName,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
    };
  }

  const toMe = async (request: APIRequestContext, w: World) =>
    (await sentMessages(request, token)).filter((m) => m.to === w.to.phoneE164);
  const emailsToMe = async (request: APIRequestContext, w: World) =>
    (await sentEmails(request, token)).filter((e) => e.to === w.to.email);
  const rowsOf = async (request: APIRequestContext, w: World) =>
    (await messageLog(request, token)).filter((m) => m.appointmentId === w.appointmentId);
  const notify = (
    request: APIRequestContext,
    w: World,
    event: BookingEventName,
    extra: Record<string, unknown> = {},
  ) =>
    sendBookingNotice(request, token, {
      appointmentId: w.appointmentId,
      event,
      mode: "CLIENT",
      linkSuffix: LINK,
      ...extra,
    });

  // ── Eventos, plantillas y contenido (criterios 1, 7 y 9) ────────────────────────────────────

  const EVENTS: Array<[BookingEventName, string, number]> = [
    ["CONFIRMED", "pelu_turno_confirmado", 6],
    ["PENDING", "pelu_turno_pendiente", 5],
    ["REJECTED", "pelu_turno_no_disponible", 4],
    ["PROPOSAL", "pelu_propuesta_horario", 4],
    ["CANCELLED", "pelu_turno_cancelado", 4],
  ];

  for (const [event, template, variables] of EVENTS) {
    test(`AC1+7: ${event} usa ${template} con sus ${variables} variables y solo con eso`, async ({ request }) => {
      const w = await world(request);

      const out = await notify(request, w, event);
      expect(out.channel).toBe("WHATSAPP");
      await waitForFinalStatus(request, token, out.messageId as number);

      const sent = await toMe(request, w);
      expect(sent).toHaveLength(1);
      expect(sent[0].template).toBe(template);
      expect(sent[0].language).toBe("es");
      expect(sent[0].bodyParameters).toHaveLength(variables);
      const firstName = w.clientName.split(" ")[0];
      expect(sent[0].bodyParameters[0]).toBe(firstName.charAt(0) + firstName.slice(1).toLowerCase());
      expect(sent[0].bodyParameters[1].length).toBeGreaterThan(0); // the salon, named in the text (D9)
      expect(sent[0].bodyParameters[2]).toBe(w.serviceName);
      expect(sent[0].bodyParameters[3]).toMatch(WEEKDAY);
      if (event === "CONFIRMED" || event === "PENDING") expect(sent[0].bodyParameters[4]).toMatch(TIME);
      if (event === "CONFIRMED") expect(sent[0].bodyParameters[5]).toBe(w.professionalName);
      expect(sent[0].buttons).toEqual([{ kind: "URL", index: 0, value: LINK }]);
      // Nothing that is not in the template: no amount, no contact data.
      const everything = JSON.stringify(sent[0]);
      expect(everything).not.toContain("50000");
      expect(everything).not.toContain(w.to.email);
    });
  }

  test("AC7+9: el contenido guardado es solo lo de la plantilla y el rechazo no admite motivo", async ({
    request,
  }) => {
    const w = await world(request);
    const out = await notify(request, w, "REJECTED");
    await waitForFinalStatus(request, token, out.messageId as number);

    const row = (await rowsOf(request, w))[0];
    const payload = JSON.parse(row.payload) as { bodyParameters: string[]; buttons: unknown[] };
    expect(Object.keys(payload).sort()).toEqual(["bodyParameters", "buttons", "language"]);
    expect(payload.bodyParameters).toHaveLength(4); // name, salon, service, date: no reason slot at all
    // The salon's free text can only be given to the support trigger as ... nothing: there is no field.
    const res = await request.post(`${API_BASE}/api/admin/whatsapp-test-support/booking-notice`, {
      headers: authHeaders(token),
      data: {
        appointmentId: w.appointmentId,
        event: "REJECTED",
        mode: "CLIENT",
        linkSuffix: LINK,
        reason: "Texto libre que NO debe viajar",
      },
    });
    expect(res.ok()).toBeTruthy();
    expect(JSON.stringify(await sentMessages(request, token))).not.toContain("Texto libre");
  });

  // ── Destinatario y consentimiento (criterio 2) ─────────────────────────────────────────────

  test("AC2: un turno del salón va al celular de la clienta, en formato internacional", async ({
    request,
  }) => {
    const w = await world(request);
    const out = await notify(request, w, "CONFIRMED");
    const row = await waitForFinalStatus(request, token, out.messageId as number);

    expect(row.recipient).toBe(w.to.phoneE164);
    expect(row.clientId).toBe(w.clientId);
    expect(row.purpose).toBe("BOOKING");
    expect(row.appointmentId).toBe(w.appointmentId);
  });

  test("AC2: un turno online va a SU contacto propio, aunque la ficha de la clienta tenga otro celular", async ({
    request,
  }) => {
    const w = await world(request, { consent: false });
    const own = uniqueRecipient();

    const out = await sendBookingNotice(request, token, {
      appointmentId: w.appointmentId,
      event: "PENDING",
      mode: "ONLINE",
      fullName: "paula ruiz",
      phone: own.phoneForm,
      email: own.email,
      optIn: true,
      linkSuffix: LINK,
    });

    expect(out.channel).toBe("WHATSAPP");
    const row = await waitForFinalStatus(request, token, out.messageId as number);
    expect(row.recipient).toBe(own.phoneE164);
    expect(row.clientId).toBeNull(); // the booking's own consent is what counts, not the client file
    const sent = (await sentMessages(request, token)).filter((m) => m.to === own.phoneE164);
    expect(sent).toHaveLength(1);
    expect(sent[0].bodyParameters[0]).toBe("Paula");
    expect(await toMe(request, w)).toHaveLength(0); // nothing to the number in the client's file
  });

  test("AC2: un turno online sin consentimiento en el formulario no recibe WhatsApp", async ({ request }) => {
    const w = await world(request, { consent: false });
    const own = uniqueRecipient();

    const out = await sendBookingNotice(request, token, {
      appointmentId: w.appointmentId,
      event: "PENDING",
      mode: "ONLINE",
      fullName: "Paula",
      phone: own.phoneForm,
      email: own.email,
      optIn: false,
      linkSuffix: LINK,
    });

    expect(out.channel).toBe("EMAIL");
    expect(out.reason).toBe("NO_CONSENT");
    expect((await sentMessages(request, token)).filter((m) => m.to === own.phoneE164)).toHaveLength(0);
    await expect
      .poll(async () => (await sentEmails(request, token)).filter((e) => e.to === own.email).length)
      .toBe(1);
  });

  test("RT-11: un celular dado de baja no recibe WhatsApp, ni siquiera con el consentimiento del formulario", async ({
    request,
  }) => {
    const w = await world(request);
    await optOutPhone(request, token, w.to.phoneE164);

    const out = await notify(request, w, "CONFIRMED");

    expect(out.channel).toBe("EMAIL");
    expect(out.reason).toBe("OPTED_OUT");
    expect(await toMe(request, w)).toHaveLength(0);
    await expect.poll(async () => (await emailsToMe(request, w)).length).toBe(1);
  });

  test("RT-11: la clienta que retira el consentimiento deja de recibir WhatsApp", async ({ request }) => {
    const w = await world(request);
    expect((await setConsentApi(request, token, w.clientId, false)).ok()).toBeTruthy();

    const out = await notify(request, w, "CONFIRMED");

    expect(out.channel).toBe("EMAIL");
    expect(out.reason).toBe("NO_CONSENT");
    expect(await toMe(request, w)).toHaveLength(0);
  });

  // ── Una vez por evento (criterio 3) ────────────────────────────────────────────────────────

  test("AC3: el mismo evento del mismo horario sale una sola vez, aunque se pida varias", async ({ request }) => {
    const w = await world(request);

    const a = await notify(request, w, "CONFIRMED");
    const b = await notify(request, w, "CONFIRMED");
    const c = await notify(request, w, "CONFIRMED");

    expect(new Set([a.messageId, b.messageId, c.messageId]).size).toBe(1);
    await waitForFinalStatus(request, token, a.messageId as number);
    expect(await toMe(request, w)).toHaveLength(1);
    expect(await rowsOf(request, w)).toHaveLength(1);
  });

  test("AC3: eventos distintos del mismo turno son avisos distintos", async ({ request }) => {
    const w = await world(request);

    const pending = await notify(request, w, "PENDING");
    const confirmed = await notify(request, w, "CONFIRMED");

    expect(pending.messageId).not.toBe(confirmed.messageId);
    await waitForFinalStatus(request, token, pending.messageId as number);
    await waitForFinalStatus(request, token, confirmed.messageId as number);
    expect((await toMe(request, w)).map((m) => m.template).sort()).toEqual([
      "pelu_turno_confirmado",
      "pelu_turno_pendiente",
    ]);
  });

  test("AC3: el aviso por email tampoco se duplica", async ({ request }) => {
    const w = await world(request, { consent: false });

    await notify(request, w, "CONFIRMED");
    await notify(request, w, "CONFIRMED");
    await expect.poll(async () => (await emailsToMe(request, w)).length).toBe(1);
    await expediteRetries(request, token); // the sweep would resend a pending fallback: it must not
    await expediteRetries(request, token);

    expect(await emailsToMe(request, w)).toHaveLength(1);
    expect(await rowsOf(request, w)).toHaveLength(1);
  });

  // ── Después del commit (criterio 4) ────────────────────────────────────────────────────────

  test("AC4: si la transacción de quien origina el aviso se revierte, no hay aviso ni envío", async ({
    request,
  }) => {
    const w = await world(request);
    const w2 = await world(request, { consent: false, hour: 12 });

    const a = await notify(request, w, "CONFIRMED", { rollback: true });
    const b = await notify(request, w2, "CONFIRMED", { rollback: true });
    expect(a.rolledBack).toBe(true);
    expect(b.rolledBack).toBe(true);

    await new Promise((r) => setTimeout(r, 1500));
    expect(await rowsOf(request, w)).toHaveLength(0);
    expect(await rowsOf(request, w2)).toHaveLength(0);
    expect(await toMe(request, w)).toHaveLength(0);
    expect(await emailsToMe(request, w2)).toHaveLength(0);
  });

  test("AC4: un envío que falla no revierte el turno que lo originó y cae al email", async ({ request }) => {
    const w = await world(request);
    await failNext(request, token, "AUTH_FAILED");

    const out = await notify(request, w, "CONFIRMED");
    const row = await waitForFinalStatus(request, token, out.messageId as number);

    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toBe("AUTH_FAILED");
    const appt = await request.get(`${API_BASE}/api/appointments/${w.appointmentId}`, {
      headers: authHeaders(token),
    });
    expect(appt.ok()).toBeTruthy(); // the turno is still there
    await expect.poll(async () => (await emailsToMe(request, w)).length).toBe(1);
  });

  // ── Reprogramación y cancelación (criterio 5) ──────────────────────────────────────────────

  test("AC5: reprogramar genera una confirmación nueva y anula el aviso que seguía en cola del horario viejo", async ({
    request,
  }) => {
    const w = await world(request, { hour: 9 });
    await failNext(request, token, "TRANSIENT"); // keeps the first notice waiting for a retry
    const old = await notify(request, w, "CONFIRMED");
    await expect
      .poll(async () => (await rowsOf(request, w)).find((m) => m.id === old.messageId)?.attempts)
      .toBe(1);
    expect((await rowsOf(request, w))[0].status).toBe("QUEUED");

    await apiPutJson(request, token, `/api/appointments/${w.appointmentId}`, {
      clientId: w.clientId,
      professionalId: w.professionalId,
      serviceId: w.serviceId,
      startAt: calendarVisibleWeekSlotIso(15, 0),
    });
    const fresh = await notify(request, w, "CONFIRMED");

    expect(fresh.messageId).not.toBe(old.messageId);
    const rows = await rowsOf(request, w);
    const voided = rows.find((m) => m.id === old.messageId) as WhatsAppLogRow;
    expect(voided.status).toBe("CANCELLED");
    expect(voided.errorCode).toBe("SUPERSEDED");
    const sentRow = await waitForFinalStatus(request, token, fresh.messageId as number);
    expect(sentRow.status).toBe("SENT");
    expect(await toMe(request, w)).toHaveLength(1); // only the new one ever left
    await expediteRetries(request, token);
    expect(await toMe(request, w)).toHaveLength(1); // the voided one is not resurrected by the sweep
  });

  test("AC5: cancelar anula todo lo pendiente y avisa de la cancelación", async ({ request }) => {
    const w = await world(request);
    await failNext(request, token, "TRANSIENT");
    const waiting = await notify(request, w, "CONFIRMED");
    await expect
      .poll(async () => (await rowsOf(request, w)).find((m) => m.id === waiting.messageId)?.attempts)
      .toBe(1);

    const cancelled = await notify(request, w, "CANCELLED");

    const rows = await rowsOf(request, w);
    expect(rows.find((m) => m.id === waiting.messageId)).toMatchObject({
      status: "CANCELLED",
      errorCode: "SUPERSEDED",
    });
    await waitForFinalStatus(request, token, cancelled.messageId as number);
    const sent = await toMe(request, w);
    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe("pelu_turno_cancelado");
  });

  test("AC5: un aviso que ya salió no se toca al cancelar", async ({ request }) => {
    const w = await world(request);
    const confirmed = await notify(request, w, "CONFIRMED");
    await waitForFinalStatus(request, token, confirmed.messageId as number);

    const cancelled = await notify(request, w, "CANCELLED");
    await waitForFinalStatus(request, token, cancelled.messageId as number);

    const rows = await rowsOf(request, w);
    expect(rows.find((m) => m.id === confirmed.messageId)?.status).toBe("SENT");
    expect(await toMe(request, w)).toHaveLength(2);
  });

  // ── Respaldo (criterio 6) ──────────────────────────────────────────────────────────────────

  test("AC6: sin consentimiento el aviso va por email con el mismo contenido y el enlace", async ({ request }) => {
    const w = await world(request, { consent: false });

    const out = await notify(request, w, "CONFIRMED");

    expect(out.channel).toBe("EMAIL");
    expect(out.reason).toBe("NO_CONSENT");
    await expect.poll(async () => (await emailsToMe(request, w)).length).toBe(1);
    const mail = (await emailsToMe(request, w))[0];
    expect(mail.subject).toBe("Tu turno está confirmado");
    expect(mail.body).toContain("está confirmado: " + w.serviceName);
    expect(mail.body).toContain("con " + w.professionalName);
    expect(mail.body).toContain("Ver o cambiar turno: ");
    expect(mail.body).toContain("/r/" + LINK);
    expect(await toMe(request, w)).toHaveLength(0);
    const row = (await rowsOf(request, w))[0];
    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toBe("NO_CONSENT");
    expect(row.attempts).toBe(0);
  });

  test("AC6: sin consentimiento y sin email queda registrado, para que el salón llame", async ({ request }) => {
    const w = await world(request, { consent: false, withEmail: false });

    const out = await notify(request, w, "CONFIRMED");

    expect(out.channel).toBe("NONE");
    const row = (await rowsOf(request, w))[0];
    expect(row.status).toBe("FAILED");
    expect(row.fallbackEmail).toBe("");
    expect(row.fallbackEmailSent).toBe(false);
    expect(await emailsToMe(request, w)).toHaveLength(0);
    expect(await toMe(request, w)).toHaveLength(0);
    // The salon sees it in the turno's notice line (C1).
    const res = await request.get(`${API_BASE}/api/appointments/${w.appointmentId}/messages`, {
      headers: authHeaders(token),
    });
    const body = (await res.json()) as { hasNotice: boolean; last: { status: string; fallbackEmailSent: boolean } };
    expect(body.hasNotice).toBe(true);
    expect(body.last).toMatchObject({ status: "FAILED", fallbackEmailSent: false });
  });

  test("AC6: con el interruptor «Confirmaciones de reserva» del salón apagado, todo va por email", async ({
    request,
  }) => {
    const w = await world(request);
    await setBookingNoticesEnabled(request, token, false);

    const out = await notify(request, w, "CONFIRMED");

    expect(out.channel).toBe("EMAIL");
    expect(out.reason).toBe("NOTICES_DISABLED");
    expect(await toMe(request, w)).toHaveLength(0);
    await expect.poll(async () => (await emailsToMe(request, w)).length).toBe(1);
  });

  test("AC6: con el canal de WhatsApp apagado para el salón, todo va por email", async ({ request }) => {
    const w = await world(request);
    await setTenantFeatureFlag(request, TENANT_ID, WHATSAPP_FLAG, false);
    try {
      const out = await notify(request, w, "CONFIRMED");
      expect(out.channel).toBe("EMAIL");
      expect(out.reason).toBe("CHANNEL_UNAVAILABLE");
      expect(await toMe(request, w)).toHaveLength(0);
      await expect.poll(async () => (await emailsToMe(request, w)).length).toBe(1);
    } finally {
      await setTenantFeatureFlag(request, TENANT_ID, WHATSAPP_FLAG, true);
    }
  });

  test("AC6: un celular que no se puede normalizar (un fijo) va por email", async ({ request }) => {
    const to = uniqueRecipient();
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await createClientApi(request, token, unique("fijo"), "021 123 456");
    const appt = await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(13, 0),
    });

    const out = await sendBookingNotice(request, token, {
      appointmentId: appt.id,
      event: "CONFIRMED",
      mode: "ONLINE",
      fullName: "Ana",
      phone: "021 123 456",
      email: to.email,
      optIn: true,
      linkSuffix: LINK,
    });

    expect(out.channel).toBe("EMAIL");
    expect(out.reason).toBe("INVALID_PHONE");
  });

  test("AC6: una plantilla pausada por Meta termina por email", async ({ request }) => {
    const w = await world(request);
    const { setFakeTemplateStatus, refreshTemplatesApi } = await import("../fixtures/whatsapp");
    await setFakeTemplateStatus(request, token, "pelu_turno_confirmado", "PAUSED", "LOW_QUALITY");
    await refreshTemplatesApi(request);

    const out = await notify(request, w, "CONFIRMED");
    const row = await waitForFinalStatus(request, token, out.messageId as number);

    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toBe("TEMPLATE_UNAVAILABLE");
    await expect.poll(async () => (await emailsToMe(request, w)).length).toBe(1);
    expect(await toMe(request, w)).toHaveLength(0);
  });

  // ── Turnos del salón (criterio 8) ──────────────────────────────────────────────────────────

  test("AC8: crear un turno desde la agenda no envía confirmación", async ({ request }) => {
    const w = await world(request);
    const before = await rowsOf(request, w);
    const seed = await seedCategoryServiceProfessional(request, token);

    const appt = await createAppointmentApi(request, token, {
      clientId: w.clientId,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(16, 0),
    });
    await new Promise((r) => setTimeout(r, 1500));

    const log = await messageLog(request, token);
    expect(log.filter((m) => m.appointmentId === appt.id)).toHaveLength(0);
    expect((await rowsOf(request, w)).length).toBe(before.length);
    expect(await toMe(request, w)).toHaveLength(0);
    expect(await emailsToMe(request, w)).toHaveLength(0);
  });

  test("Un turno que no es del salón no admite avisos (404)", async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/admin/whatsapp-test-support/booking-notice`, {
      headers: authHeaders(token),
      data: { appointmentId: 999_999_999, event: "CONFIRMED", mode: "ONLINE", phone: "0981123456", linkSuffix: LINK },
    });
    expect(res.status()).toBe(404);
  });
});
