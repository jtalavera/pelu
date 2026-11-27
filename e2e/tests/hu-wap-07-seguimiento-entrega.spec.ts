import { expect, test } from "@playwright/test";

import {
  API_BASE,
  authHeaders,
  calendarVisibleWeekSlotIso,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCalendarShowsClientCard, filterAgendaByProfessional } from "../fixtures/ui";
import {
  BOOKING_FLAG,
  CONFIRMED_LINK,
  CONFIRMED_VARS,
  WHATSAPP_FLAG,
  ageMessages,
  createClientApi,
  enableWhatsAppFlags,
  enqueueMessage,
  expediteRetries,
  failNext,
  failNextEmail,
  messageLog,
  messageStatusEvent,
  postWebhook,
  refreshTemplatesApi,
  restoreCatalog,
  restoreWhatsAppFlags,
  runRetention,
  sendCode,
  sentEmails,
  sentMessages,
  setConsentApi,
  setFakeTemplateStatus,
  waitForFinalStatus,
  whatsAppSignature,
  type EnqueueBody,
  type WhatsAppLogRow,
} from "../fixtures/whatsapp";

// HU-WAP-07 · Seguimiento de entrega, reintentos y respaldo por email
// requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md
//
// Cobertura por criterio:
//  1 registro de cada mensaje ........... el log del salón: plantilla, estado, wamid, intentos, errores
//  2 estados de Meta .................... webhook firmado: SENT→DELIVERED→READ o FAILED, sin retroceder
//  3 reintentos ......................... esperas de 1, 5 y 15 minutos; definitivos sin reintento
//  4 número sin WhatsApp ................ se recuerda y no se vuelve a intentar
//  5 respaldo por email ................. uno solo; el código de verificación no cae a email solo
//  7 vista para el salón ................ línea de estado en el turno y API (administradora)
//  8 plantilla caída .................... directo al respaldo
//  9 retención .......................... número enmascarado a los 90 días
//  10 aislamiento ....................... caso en mt-isolation (mt-whatsapp.spec.ts)
//  Pendiente por depender de otros incrementos: 6 y parte de 7 («Requiere atención» → A6 / RSV-07) y la
//  vista de la profesional sin celular (cubierta en JUnit: AppointmentMessagesControllerTest).

test.describe.configure({ mode: "serial" });

const TENANT_ID = 1;
const PHONE_FORM = "0981 123 456";
const PHONE_E164 = "+595981123456";
const EMAIL = "ana@example.com";
let n = 0;
const key = (label: string) => `e2e-${label}-${Date.now()}-${++n}`;
const unique = (label: string) => `E2E WA ${label} ${Date.now()}${++n}`;

test.describe("HU-WAP-07 · Seguimiento de entrega, reintentos y respaldo por email", () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    await enableWhatsAppFlags(request);
    token = await loginAsDemoApi(request);
  });

  test.beforeEach(async ({ request }) => {
    await restoreCatalog(request);
  });

  test.afterAll(async ({ request }) => {
    await restoreCatalog(request);
    await setTenantFeatureFlag(request, TENANT_ID, WHATSAPP_FLAG, true);
    await setTenantFeatureFlag(request, TENANT_ID, BOOKING_FLAG, true);
    await restoreWhatsAppFlags(request);
  });

  async function queue(
    request: import("@playwright/test").APIRequestContext,
    overrides: Partial<EnqueueBody> = {},
  ): Promise<number> {
    const res = await enqueueMessage(request, token, {
      template: "pelu_turno_confirmado",
      to: PHONE_FORM,
      variables: CONFIRMED_VARS,
      buttons: [CONFIRMED_LINK],
      dedupKey: key("m"),
      fallbackEmail: EMAIL,
      ...overrides,
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return ((await res.json()) as { id: number }).id;
  }

  async function row(request: import("@playwright/test").APIRequestContext, id: number) {
    return (await messageLog(request, token)).find((m) => m.id === id) as WhatsAppLogRow;
  }

  async function waitFor(
    request: import("@playwright/test").APIRequestContext,
    id: number,
    predicate: (r: WhatsAppLogRow) => boolean,
  ) {
    await expect.poll(async () => predicate(await row(request, id)), { timeout: 15_000 }).toBe(true);
    return row(request, id);
  }

  // ── Estados de Meta (criterio 2) ─────────────────────────────────────────────────────────────

  test("AC1+2: los estados avanzan SENT → DELIVERED → READ y cada mensaje queda registrado", async ({
    request,
  }) => {
    const id = await queue(request);
    const sent = await waitForFinalStatus(request, token, id);
    expect(sent).toMatchObject({ status: "SENT", template: "pelu_turno_confirmado", attempts: 1 });
    expect(sent.wamid).toMatch(/^wamid\./);

    expect((await postWebhook(request, messageStatusEvent(sent.wamid, "delivered"))).status()).toBe(200);
    expect((await row(request, id)).status).toBe("DELIVERED");

    expect((await postWebhook(request, messageStatusEvent(sent.wamid, "read"))).status()).toBe(200);
    expect((await row(request, id)).status).toBe("READ");
  });

  test("AC2: las notificaciones desordenadas o repetidas no hacen retroceder el estado", async ({
    request,
  }) => {
    const id = await queue(request);
    const { wamid } = await waitForFinalStatus(request, token, id);

    for (const status of ["read", "delivered", "sent", "delivered", "read"]) {
      expect((await postWebhook(request, messageStatusEvent(wamid, status))).status()).toBe(200);
    }

    expect((await row(request, id)).status).toBe("READ");
  });

  test("AC2: una notificación de estado sin la firma de Meta se rechaza y no cambia nada", async ({
    request,
  }) => {
    const id = await queue(request);
    const { wamid } = await waitForFinalStatus(request, token, id);
    const raw = JSON.stringify(messageStatusEvent(wamid, "delivered"));

    const unsigned = await postWebhook(request, raw, null);
    const forged = await postWebhook(request, raw, whatsAppSignature(raw, "otro-secreto"));

    expect(unsigned.status()).toBe(403);
    expect(forged.status()).toBe(403);
    expect((await row(request, id)).status).toBe("SENT");
  });

  test("AC2: el estado de un mensaje que nunca enviamos se ignora sin error", async ({ request }) => {
    const res = await postWebhook(request, messageStatusEvent("wamid.NOT_OURS", "failed", 131026));
    expect(res.status()).toBe(200);
    expect(await sentEmails(request, token)).toHaveLength(0);
  });

  test("AC2+5: un «no entregado» de Meta falla el mensaje y manda UN email (aunque Meta repita el aviso)", async ({
    request,
  }) => {
    const id = await queue(request);
    const { wamid } = await waitForFinalStatus(request, token, id);

    await postWebhook(request, messageStatusEvent(wamid, "failed", 131049));
    await postWebhook(request, messageStatusEvent(wamid, "failed", 131049));

    const failed = await waitFor(request, id, (r) => r.status === "FAILED" && r.fallbackEmailSent);
    expect(failed.status).toBe("FAILED");
    expect(await sentEmails(request, token)).toHaveLength(1);
  });

  test("AC2: un «no entregado» después de entregado se ignora", async ({ request }) => {
    const id = await queue(request);
    const { wamid } = await waitForFinalStatus(request, token, id);
    await postWebhook(request, messageStatusEvent(wamid, "delivered"));

    await postWebhook(request, messageStatusEvent(wamid, "failed", 131049));

    expect((await row(request, id)).status).toBe("DELIVERED");
    expect(await sentEmails(request, token)).toHaveLength(0);
  });

  // ── Reintentos (criterio 3) ──────────────────────────────────────────────────────────────────

  test("AC3: un error transitorio se reintenta después de una espera y el mensaje sale", async ({
    request,
  }) => {
    await failNext(request, token, "TRANSIENT");
    const id = await queue(request);

    const waiting = await waitFor(request, id, (r) => r.status === "QUEUED" && r.attempts === 1);
    const seconds = (new Date(waiting.nextAttemptAt).getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(40);
    expect(seconds).toBeLessThan(61);
    expect(await sentMessages(request, token)).toHaveLength(0);

    await expediteRetries(request, token);

    const sent = await waitFor(request, id, (r) => r.status === "SENT");
    expect(sent.attempts).toBe(2);
    expect(await sentEmails(request, token)).toHaveLength(0);
  });

  test("AC3: las esperas crecen 1, 5 y 15 minutos y tras el último intento cae al email", async ({
    request,
  }) => {
    await failNext(request, token, "RATE_LIMITED", 4);
    const id = await queue(request);

    for (const [i, minutes] of [1, 5, 15].entries()) {
      const waiting = await waitFor(request, id, (r) => r.status === "QUEUED" && r.attempts === i + 1);
      const seconds = (new Date(waiting.nextAttemptAt).getTime() - Date.now()) / 1000;
      expect(seconds, `wait before retry ${i + 1}`).toBeGreaterThan(minutes * 60 - 20);
      expect(seconds).toBeLessThan(minutes * 60 + 1);
      await expediteRetries(request, token);
    }

    const failed = await waitFor(request, id, (r) => r.status === "FAILED");
    expect(failed.attempts).toBe(4);
    expect(failed.errorCode).toBe("RATE_LIMITED");
    await expect.poll(async () => (await sentEmails(request, token)).length).toBe(1);
  });

  test("AC3: un error definitivo no se reintenta", async ({ request }) => {
    await failNext(request, token, "AUTH_FAILED");
    const id = await queue(request);

    const failed = await waitFor(request, id, (r) => r.status === "FAILED");

    expect(failed.attempts).toBe(1);
    expect(failed.errorCode).toBe("AUTH_FAILED");
    await expediteRetries(request, token);
    expect((await row(request, id)).attempts).toBe(1);
  });

  // ── Número sin WhatsApp (criterio 4) ─────────────────────────────────────────────────────────

  test("AC4: un número sin WhatsApp se recuerda y no se vuelve a intentar", async ({ request }) => {
    await failNext(request, token, "INVALID_RECIPIENT");
    const first = await queue(request);
    await waitFor(request, first, (r) => r.status === "FAILED");

    const second = await queue(request);
    const failed = await waitFor(request, second, (r) => r.status === "FAILED");

    expect(failed.errorCode).toBe("INVALID_RECIPIENT");
    expect(failed.attempts).toBe(1);
    expect(await sentMessages(request, token)).toHaveLength(0); // never reached the provider again
    await expect.poll(async () => (await sentEmails(request, token)).length).toBe(2);

    // Another number is not affected.
    const other = await queue(request, { to: "0982 000 111" });
    expect((await waitForFinalStatus(request, token, other)).status).toBe("SENT");
  });

  test("AC4: si Meta informa «sin WhatsApp» después del envío, el número queda marcado", async ({
    request,
  }) => {
    const id = await queue(request);
    const { wamid } = await waitForFinalStatus(request, token, id);

    await postWebhook(request, messageStatusEvent(wamid, "failed", 131026));
    await waitFor(request, id, (r) => r.status === "FAILED");

    const next = await queue(request);
    const failed = await waitFor(request, next, (r) => r.status === "FAILED");
    expect(failed.errorCode).toBe("INVALID_RECIPIENT");
    expect(failed.attempts).toBe(1);
  });

  // ── Respaldo por email (criterio 5 y 8) ──────────────────────────────────────────────────────

  test("AC5: el email de respaldo lleva el mismo contenido y el enlace, y sale una sola vez", async ({
    request,
  }) => {
    await failNext(request, token, "AUTH_FAILED");
    const id = await queue(request);
    await waitFor(request, id, (r) => r.status === "FAILED" && r.fallbackEmailSent);

    await expediteRetries(request, token);
    await expediteRetries(request, token);

    const emails = await sentEmails(request, token);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe(EMAIL);
    expect(emails[0].subject).toBe("Tu turno está confirmado");
    expect(emails[0].body).toContain(
      "Hola María, tu turno en Salón Bella está confirmado: Corte, el viernes 28/11 a las 15:30 con Laura.",
    );
    expect(emails[0].body).toContain("Ver o cambiar turno: ");
    expect(emails[0].body).toContain("/r/bella/turno/abc123");
    expect(emails[0].body).toContain("no pudimos enviarte este aviso por WhatsApp");
    expect(emails[0].body).not.toContain("981123456");
  });

  test("AC5: sin dirección de email la falla solo queda registrada", async ({ request }) => {
    await failNext(request, token, "AUTH_FAILED");
    const id = await queue(request, { fallbackEmail: undefined });

    const failed = await waitFor(request, id, (r) => r.status === "FAILED");

    expect(failed.fallbackEmailSent).toBe(false);
    expect(await sentEmails(request, token)).toHaveLength(0);
  });

  test("AC5: si el email falla, no se pierde: se reintenta y sale una sola vez", async ({
    request,
  }) => {
    await failNextEmail(request, token, 1);
    await failNext(request, token, "AUTH_FAILED");
    const id = await queue(request);
    await waitFor(request, id, (r) => r.status === "FAILED");
    expect(await sentEmails(request, token)).toHaveLength(0);
    expect((await row(request, id)).fallbackEmailSent).toBe(false);

    await expediteRetries(request, token);
    await expect.poll(async () => (await sentEmails(request, token)).length).toBe(1);
    await expediteRetries(request, token);

    expect(await sentEmails(request, token)).toHaveLength(1);
    expect((await row(request, id)).fallbackEmailSent).toBe(true);
  });

  test("AC5: el código de verificación NO cae a email por su cuenta", async ({ request }) => {
    await failNext(request, token, "TRANSIENT");
    const res = await sendCode(request, token, PHONE_FORM, "123456");

    expect(res.status()).toBe(409);
    expect(await res.text()).toContain("WHATSAPP_TRANSIENT");
    expect(await sentEmails(request, token)).toHaveLength(0);
  });

  test("AC8: una plantilla pausada va directo al respaldo, sin intentar WhatsApp", async ({
    request,
  }) => {
    await setFakeTemplateStatus(request, token, "pelu_turno_confirmado", "PAUSED", "LOW_QUALITY");
    await refreshTemplatesApi(request);
    const id = await queue(request);

    const failed = await waitFor(request, id, (r) => r.status === "FAILED" && r.fallbackEmailSent);

    expect(failed.errorCode).toBe("TEMPLATE_UNAVAILABLE");
    expect(failed.attempts).toBe(1);
    expect(await sentMessages(request, token)).toHaveLength(0);
    expect(await sentEmails(request, token)).toHaveLength(1);
  });

  test("El canal apagado para el salón también cae al email", async ({ request }) => {
    await setTenantFeatureFlag(request, TENANT_ID, WHATSAPP_FLAG, false);
    try {
      const id = await queue(request);
      const failed = await waitFor(request, id, (r) => r.status === "FAILED" && r.fallbackEmailSent);
      expect(failed.errorCode).toBe("CHANNEL_UNAVAILABLE");
      expect(await sentEmails(request, token)).toHaveLength(1);
    } finally {
      await setTenantFeatureFlag(request, TENANT_ID, WHATSAPP_FLAG, true);
    }
  });

  // ── Vista para el salón (criterio 7) ─────────────────────────────────────────────────────────

  async function seedAppointment(request: import("@playwright/test").APIRequestContext, hour: number) {
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await createClientApi(request, token, unique("turno"), PHONE_FORM);
    expect((await setConsentApi(request, token, client.id, true)).ok()).toBeTruthy();
    const appt = await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(hour, 0),
    });
    return { seed, client, appt };
  }

  async function notices(request: import("@playwright/test").APIRequestContext, appointmentId: number) {
    return request.get(`${API_BASE}/api/appointments/${appointmentId}/messages`, {
      headers: authHeaders(token),
    });
  }

  test("AC7: la API de avisos del turno informa el último estado a la administradora", async ({
    request,
  }) => {
    const { client, appt } = await seedAppointment(request, 9);

    const none = await notices(request, appt.id);
    expect(none.ok()).toBeTruthy();
    expect(await none.json()).toEqual({ hasNotice: false, last: null });

    const id = await queue(request, { appointmentId: appt.id, clientId: client.id, purpose: "REMINDER" });
    const { wamid } = await waitForFinalStatus(request, token, id);
    await postWebhook(request, messageStatusEvent(wamid, "delivered"));

    const res = await notices(request, appt.id);
    const body = (await res.json()) as { hasNotice: boolean; last: Record<string, unknown> };
    expect(body.hasNotice).toBe(true);
    expect(body.last).toMatchObject({
      template: "pelu_turno_confirmado",
      purpose: "REMINDER",
      status: "DELIVERED",
      recipient: PHONE_E164,
      fallbackEmailSent: false,
    });
    expect(body.last.deliveredAt).toBeTruthy();
  });

  test("AC7: un turno inexistente (o de otro salón) responde 404", async ({ request }) => {
    const res = await notices(request, 999_999_999);
    expect(res.status()).toBe(404);
  });

  test("AC7: con el canal apagado la ruta de avisos del turno responde 403", async ({
    request,
  }) => {
    const { appt } = await seedAppointment(request, 10);
    await setTenantFeatureFlag(request, TENANT_ID, WHATSAPP_FLAG, false);
    try {
      const res = await notices(request, appt.id);
      expect(res.status()).toBe(403);
      expect(await res.text()).toContain("WHATSAPP_REMINDERS_DISABLED");
    } finally {
      await setTenantFeatureFlag(request, TENANT_ID, WHATSAPP_FLAG, true);
    }
  });

  test("AC7: el detalle del turno muestra «Entregado», «Leído» y «No entregado — llamarla al…»", async ({
    page,
    request,
  }) => {
    const { seed, client, appt } = await seedAppointment(request, 11);
    const id = await queue(request, { appointmentId: appt.id, clientId: client.id, purpose: "REMINDER" });
    const { wamid } = await waitForFinalStatus(request, token, id);
    await postWebhook(request, messageStatusEvent(wamid, "delivered"));

    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await filterAgendaByProfessional(page, new RegExp(seed.professionalFullName));
    await ensureCalendarShowsClientCard(page, new RegExp(client.fullName));
    await page.getByRole("button", { name: new RegExp(client.fullName) }).click();
    const line = page.getByTestId("appointment-notice");
    await expect(line).toContainText("Notice delivered by WhatsApp");
    await page.keyboard.press("Escape");

    await postWebhook(request, messageStatusEvent(wamid, "read"));
    await page.reload();
    await filterAgendaByProfessional(page, new RegExp(seed.professionalFullName));
    await ensureCalendarShowsClientCard(page, new RegExp(client.fullName));
    await page.getByRole("button", { name: new RegExp(client.fullName) }).click();
    await expect(page.getByTestId("appointment-notice")).toContainText("Notice read on WhatsApp");
  });

  test("AC7: un aviso que falló sin email muestra a quién llamar", async ({ page, request }) => {
    const { seed, client, appt } = await seedAppointment(request, 12);
    await failNext(request, token, "AUTH_FAILED");
    const id = await queue(request, {
      appointmentId: appt.id,
      clientId: client.id,
      purpose: "REMINDER",
      fallbackEmail: undefined,
    });
    await waitFor(request, id, (r) => r.status === "FAILED");

    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await filterAgendaByProfessional(page, new RegExp(seed.professionalFullName));
    await ensureCalendarShowsClientCard(page, new RegExp(client.fullName));
    await page.getByRole("button", { name: new RegExp(client.fullName) }).click();

    await expect(page.getByTestId("appointment-notice")).toContainText(
      `Not delivered — call the client at ${PHONE_E164}`,
    );
  });

  test("AC7: un aviso que falló y salió por email lo dice", async ({ page, request }) => {
    const { seed, client, appt } = await seedAppointment(request, 13);
    await failNext(request, token, "AUTH_FAILED");
    const id = await queue(request, { appointmentId: appt.id, clientId: client.id, purpose: "REMINDER" });
    await waitFor(request, id, (r) => r.status === "FAILED" && r.fallbackEmailSent);

    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await filterAgendaByProfessional(page, new RegExp(seed.professionalFullName));
    await ensureCalendarShowsClientCard(page, new RegExp(client.fullName));
    await page.getByRole("button", { name: new RegExp(client.fullName) }).click();

    await expect(page.getByTestId("appointment-notice")).toContainText("sent by email instead");
  });

  // ── Retención (criterio 9) ───────────────────────────────────────────────────────────────────

  test("AC9: pasado el plazo de retención el celular se enmascara y quedan los conteos", async ({
    request,
  }) => {
    const oldId = await queue(request);
    await waitForFinalStatus(request, token, oldId);
    await ageMessages(request, token, 100);
    const recentId = await queue(request);
    await waitForFinalStatus(request, token, recentId);

    await runRetention(request, token);

    const old = await row(request, oldId);
    expect(old.masked).toBe(true);
    expect(old.recipient).toBe("+595******456");
    expect(old.fallbackEmail).toBe("");
    expect(old.payload).toBe("{}");
    expect(old.status).toBe("SENT");
    expect(old.template).toBe("pelu_turno_confirmado");

    const recent = await row(request, recentId);
    expect(recent.masked).toBe(false);
    expect(recent.recipient).toBe(PHONE_E164);
    expect(recent.fallbackEmail).toBe(EMAIL);
  });
});
