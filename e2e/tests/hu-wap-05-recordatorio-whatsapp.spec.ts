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
  expediteRetries,
  failNext,
  farFutureStart,
  hoursBefore,
  messageLog,
  optOutPhone,
  resetFake,
  restoreCatalog,
  restoreWhatsAppFlags,
  runReminders,
  sentEmails,
  sentMessages,
  setConsentApi,
  setManageLinks,
  setRemindersEnabled,
  uniqueRecipient,
  waitForFinalStatus,
} from "../fixtures/whatsapp";

// HU-WAP-05 · Recordatorio de turnos por WhatsApp
// requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md
//
// El trabajo horario se ejecuta con un reloj simulado (`run-reminders?now=`) sobre turnos en una fecha
// lejana, para que solo toque los de cada test.
//
// Cobertura por criterio:
//  1 mismo disparador ............. el trabajo horario existente (ventana ≤ 25 h, PENDING/CONFIRMED, reminder_sent_at)
//  2 elección de canal ............ WhatsApp solo con interruptor del salón, consentimiento, sin baja, con enlace;
//                                   si no, el email de hoy; nunca los dos
//  3 cuándo se considera enviado .. se marca al encolar; si el mensaje falla, email de respaldo una sola vez
//  4 reserva online sin aprobar ... PENDIENTE: depende de A4 (origen del turno); hoy ningún turno espera aprobación
//  5 horas de silencio ............ 21:00–08:00: se pospone a las 08:00, salvo turno en menos de 12 h
//  6 botones ...................... «Ver mi turno»; con «Respuestas por botón» también «Confirmo» / «No puedo ir»
//                                   (lo que pasa al tocarlos y el interruptor apagado: hu-wap-06-respuestas.spec.ts)
//  7 reprogramación y cancelación . reprogramar da un recordatorio nuevo; un turno cancelado no recibe
//  8 no duplicación ............... una segunda corrida del trabajo no repite el recordatorio
//  9 compatibilidad ............... con el interruptor apagado todo sigue por email, como hoy
//  Pendiente por depender de otros incrementos: enlace real de gestión (A5) y turnos online (A4).

test.describe.configure({ mode: "serial" });

const TENANT_ID = 1;

test.describe("HU-WAP-05 · Recordatorio por WhatsApp", () => {
  let token: string;
  let n = 0;
  const unique = (label: string) => `E2E WA05 ${label} ${Date.now()}${++n}`;

  test.beforeAll(async ({ request }) => {
    await enableWhatsAppFlags(request);
    token = await loginAsDemoApi(request);
  });

  test.beforeEach(async ({ request }) => {
    await restoreCatalog(request);
    await resetFake(request, token);
    await setRemindersEnabled(request, token, null);
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
    serviceName: string;
    serviceId: number;
    professionalId: number;
    start: Date;
  };

  async function world(
    request: APIRequestContext,
    opts: { consent?: boolean; hour?: number } = {},
  ): Promise<World> {
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
    if (opts.consent !== false) {
      expect((await setConsentApi(request, token, client.id, true)).ok()).toBeTruthy();
    }
    const start = farFutureStart(opts.hour ?? 15);
    const appt = await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: start.toISOString(),
    });
    return {
      to,
      clientId: client.id,
      clientName,
      appointmentId: appt.id,
      serviceName: seed.serviceFullName,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      start,
    };
  }

  const toMe = async (request: APIRequestContext, w: World) =>
    (await sentMessages(request, token)).filter((m) => m.to === w.to.phoneE164);
  const rowsOf = async (request: APIRequestContext, w: World) =>
    (await messageLog(request, token)).filter((m) => m.appointmentId === w.appointmentId);
  const reminderSentAt = async (request: APIRequestContext, w: World) =>
    (await apiGetJson<{ reminderSentAt: string | null }>(request, token, `/api/appointments/${w.appointmentId}`))
      .reminderSentAt;
  /** Mid-morning of the turno's day: well outside the quiet hours. */
  const MORNING = 9;
  const dayRunAt = (w: World) => hoursBefore(w.start, 15 - MORNING);

  // ── Criterios 2, 6 y 9: canal, elegibilidad y contenido ────────────────────────────────────────

  test("AC2+6: la clienta con consentimiento recibe la plantilla de recordatorio con sus 5 variables y el botón", async ({
    request,
  }) => {
    const w = await world(request);

    await runReminders(request, token, dayRunAt(w));
    const rows = await rowsOf(request, w);
    expect(rows).toHaveLength(1);
    await waitForFinalStatus(request, token, rows[0].id);

    const sent = await toMe(request, w);
    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe("pelu_recordatorio_turno");
    expect(sent[0].language).toBe("es");
    expect(sent[0].bodyParameters).toHaveLength(5);
    const firstName = w.clientName.split(" ")[0];
    expect(sent[0].bodyParameters[0]).toBe(firstName.charAt(0) + firstName.slice(1).toLowerCase());
    expect(sent[0].bodyParameters[1].length).toBeGreaterThan(0); // the salon, named in the text
    expect(sent[0].bodyParameters[2]).toBe(w.serviceName);
    expect(sent[0].bodyParameters[3]).toMatch(/^(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d{2}\/\d{2}$/);
    expect(sent[0].bodyParameters[4]).toBe("15:00");
    // «Confirmo» / «No puedo ir» (HU-WAP-06, con «Respuestas por botón» encendido) y «Ver mi turno».
    expect(sent[0].buttons.map((b) => `${b.kind}:${b.index}`)).toEqual([
      "QUICK_REPLY:0",
      "QUICK_REPLY:1",
      "URL:2",
    ]);
    expect(sent[0].buttons.find((b) => b.kind === "URL")?.value).toContain("/turno/");
    expect(rows[0].purpose).toBe("REMINDER");
  });

  test("AC2+9: sin consentimiento, con baja o con el interruptor del salón apagado, sigue por email", async ({
    request,
  }) => {
    const noConsent = await world(request, { consent: false });
    const optedOut = await world(request);
    await optOutPhone(request, token, optedOut.to.phoneE164);
    const switchedOff = await world(request);

    await runReminders(request, token, dayRunAt(noConsent));
    await runReminders(request, token, dayRunAt(optedOut));
    await setRemindersEnabled(request, token, false);
    await runReminders(request, token, dayRunAt(switchedOff));

    for (const w of [noConsent, optedOut, switchedOff]) {
      expect(await rowsOf(request, w)).toHaveLength(0);
      expect(await toMe(request, w)).toHaveLength(0);
      // The email path took over: the turno counts as reminded, exactly as before this story.
      expect(await reminderSentAt(request, w)).not.toBeNull();
    }
  });

  test("AC2: sin enlace para gestionar el turno, el recordatorio sigue por email", async ({ request }) => {
    const w = await world(request);
    await setManageLinks(request, token, false);

    await runReminders(request, token, dayRunAt(w));

    expect(await rowsOf(request, w)).toHaveLength(0);
    expect(await reminderSentAt(request, w)).not.toBeNull();
  });

  // ── Criterios 7 y 8: una sola vez y reprogramación ────────────────────────────────────────────────────────────────

  test("AC8: el turno queda marcado al encolar y una segunda corrida no repite el recordatorio", async ({ request }) => {
    const w = await world(request);
    expect(await reminderSentAt(request, w)).toBeNull();

    await runReminders(request, token, dayRunAt(w));
    expect(await reminderSentAt(request, w)).not.toBeNull();
    await runReminders(request, token, dayRunAt(w));
    await runReminders(request, token, new Date(dayRunAt(w).getTime() + 3_600_000));

    expect(await rowsOf(request, w)).toHaveLength(1);
  });

  test("AC7: al reprogramar el turno se envía un recordatorio nuevo para el horario nuevo", async ({
    request,
  }) => {
    const w = await world(request);
    await runReminders(request, token, dayRunAt(w));
    expect(await rowsOf(request, w)).toHaveLength(1);

    const moved = farFutureStart(16);
    await apiPutJson(request, token, `/api/appointments/${w.appointmentId}`, {
      professionalId: w.professionalId,
      serviceId: w.serviceId,
      clientId: w.clientId,
      startAt: moved.toISOString(),
    });
    expect(await reminderSentAt(request, w)).toBeNull();

    await runReminders(request, token, hoursBefore(moved, 7));
    const rows = await rowsOf(request, w);
    expect(rows).toHaveLength(2);
    const last = (await toMe(request, w)).at(-1);
    expect(last?.bodyParameters[4]).toBe("16:00");
  });

  // ── Criterio 5: horas de silencio ───────────────────────────────────────────────────────────

  test("AC5: de noche un turno lejano espera hasta las 08:00 y sale en la corrida siguiente", async ({
    request,
  }) => {
    const w = await world(request);
    const night = hoursBefore(w.start, 16); // 23:00 the evening before

    await runReminders(request, token, night);
    expect(await rowsOf(request, w)).toHaveLength(0);
    expect(await reminderSentAt(request, w)).toBeNull();

    await runReminders(request, token, hoursBefore(w.start, 7)); // 08:00
    expect(await rowsOf(request, w)).toHaveLength(1);
    expect(await reminderSentAt(request, w)).not.toBeNull();
  });

  test("AC5: de noche un turno en menos de 12 horas sale igual", async ({ request }) => {
    const w = await world(request, { hour: 6 }); // 06:00; the job runs at 23:00 the evening before: 7 h
    await runReminders(request, token, hoursBefore(w.start, 7));
    expect(await rowsOf(request, w)).toHaveLength(1);
  });

  // ── Criterio 6: respaldo por email ──────────────────────────────────────────────────────────

  test("AC6: si el mensaje no se puede enviar, la clienta recibe un email con lo mismo, una sola vez", async ({
    request,
  }) => {
    const w = await world(request);
    await failNext(request, token, "AUTH_FAILED"); // a permanent failure: no retries, straight to the email

    await runReminders(request, token, dayRunAt(w));
    const rows = await rowsOf(request, w);
    expect(rows).toHaveLength(1);
    await waitForFinalStatus(request, token, rows[0].id);

    await expect
      .poll(async () => (await sentEmails(request, token)).filter((e) => e.to === w.to.email).length)
      .toBe(1);
    const mail = (await sentEmails(request, token)).find((e) => e.to === w.to.email)!;
    expect(mail.body).toContain(w.serviceName);
    expect(mail.body).toContain("15:00");
    await expediteRetries(request, token);
    expect((await sentEmails(request, token)).filter((e) => e.to === w.to.email)).toHaveLength(1);
  });

  // ── Criterio 7: cancelación ───────────────────────────────────────────────────────────

  test("AC7: un turno cancelado no recibe recordatorio", async ({ request }) => {
    const w = await world(request);
    const res = await request.patch(`${API_BASE}/api/appointments/${w.appointmentId}/status`, {
      headers: authHeaders(token),
      data: { status: "CANCELLED", cancelReason: "E2E" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    await runReminders(request, token, dayRunAt(w));

    expect(await rowsOf(request, w)).toHaveLength(0);
    expect(await toMe(request, w)).toHaveLength(0);
  });
});
