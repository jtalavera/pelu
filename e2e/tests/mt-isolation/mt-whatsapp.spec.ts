import { expect, test } from "@playwright/test";

import {
  API_BASE,
  authHeaders,
  createAppointmentApi,
  instantToOffsetIso,
  seedCategoryServiceProfessional,
  setTenantFeatureFlag,
} from "../../fixtures/api";
import { expectCrossTenantForbidden } from "../../fixtures/mt/probe";
import { getMtWorld, mtLoginToken, type MtTenant } from "../../fixtures/mt/world";
import {
  BOOKING_FLAG,
  CONFIRMED_LINK,
  CONFIRMED_VARS,
  WHATSAPP_FLAG,
  createClientApi,
  enableWhatsAppFlags,
  enqueueMessage,
  failNext,
  getClientApi,
  messageLog,
  messageStatusEvent,
  postWebhook,
  refreshTemplatesApi,
  resetFake,
  restoreWhatsAppFlags,
  sentMessages,
  setConsentApi,
  waitForFinalStatus,
} from "../../fixtures/whatsapp";

/**
 * mt-whatsapp — Épica C: the WhatsApp channel never mixes salons, even though ONE number serves all
 * of them (RT-02, HU-WAP-03 criterio 5, HU-WAP-07 criterio 10).
 *
 *  Two salons (A and B): the mt world's third tenant is suspended by design and cannot log in.
 *
 *  1. Each salon only sees its own delivery log.
 *  2. A delivery status is attributed from OUR record of the message (the wamid), so it changes the
 *     right salon's row and no other.
 *  3. A salon cannot read another salon's appointment notices.
 *  4. Consent is per salon: it cannot be changed from another salon, and a consent given in A does not
 *     cover B's client with the same phone.
 *  5. An opt-out is per PHONE and applies to every salon; no salon can re-enable it.
 *  6. The channel's flags are per salon.
 *  7. An unreachable number (the shared number's reputation) is remembered for every salon.
 *
 * All raw HTTP goes to `API_BASE` (the :8081 mt backend). Assertions say "contains / excludes THIS
 * id" — never an absolute count.
 */

test.describe.configure({ mode: "serial" });

const world = getMtWorld();
const PHONE = "0981 123 456";
const PHONE_E164 = "+595981123456";
const SHARED_EMAIL = "ana@example.com";
let n = 0;
const key = (label: string) => `mt-wa-${label}-${Date.now()}-${++n}`;
const unique = (label: string) => `MT WA ${label} ${Date.now()}${++n}`;

type Salon = { t: MtTenant; token: string };

test.describe("mt-whatsapp · aislamiento del canal WhatsApp", () => {
  let a: Salon;
  let b: Salon;

  test.beforeAll(async ({ request }) => {
    await enableWhatsAppFlags(request);
    a = { t: world.tenantA, token: await mtLoginToken(request, world.tenantA) };
    b = { t: world.tenantB, token: await mtLoginToken(request, world.tenantB) };
  });

  test.beforeEach(async ({ request }) => {
    await resetFake(request, a.token);
    await refreshTemplatesApi(request);
  });

  test.afterAll(async ({ request }) => {
    await resetFake(request, a.token);
    await refreshTemplatesApi(request);
    for (const s of [a, b]) {
      await setTenantFeatureFlag(request, s.t.id, WHATSAPP_FLAG, true);
      await setTenantFeatureFlag(request, s.t.id, BOOKING_FLAG, true);
    }
    await restoreWhatsAppFlags(request);
  });

  async function queue(
    request: import("@playwright/test").APIRequestContext,
    s: Salon,
    overrides: Record<string, unknown> = {},
  ): Promise<number> {
    const res = await enqueueMessage(request, s.token, {
      template: "pelu_turno_confirmado",
      to: PHONE,
      variables: CONFIRMED_VARS,
      buttons: [CONFIRMED_LINK],
      dedupKey: key(s.t.key),
      fallbackEmail: SHARED_EMAIL,
      ...overrides,
    } as never);
    expect(res.ok(), await res.text()).toBeTruthy();
    return ((await res.json()) as { id: number }).id;
  }

  async function consentingClient(request: import("@playwright/test").APIRequestContext, s: Salon) {
    const client = await createClientApi(request, s.token, unique(s.t.key), PHONE);
    expect((await setConsentApi(request, s.token, client.id, true)).ok()).toBeTruthy();
    return client;
  }

  test("1: cada salón ve solo su propio registro de mensajes", async ({ request }) => {
    const idA = await queue(request, a);
    const idB = await queue(request, b);
    const rowA = await waitForFinalStatus(request, a.token, idA);
    const rowB = await waitForFinalStatus(request, b.token, idB);

    const logA = (await messageLog(request, a.token)).map((m) => m.wamid);
    const logB = (await messageLog(request, b.token)).map((m) => m.wamid);

    expect(logA).toContain(rowA.wamid);
    expect(logA).not.toContain(rowB.wamid);
    expect(logB).toContain(rowB.wamid);
    expect(logB).not.toContain(rowA.wamid);
  });

  test("2: un estado de entrega cambia solo el mensaje del salón al que pertenece", async ({
    request,
  }) => {
    const idA = await queue(request, a);
    const idB = await queue(request, b);
    const rowA = await waitForFinalStatus(request, a.token, idA);
    await waitForFinalStatus(request, b.token, idB);

    expect((await postWebhook(request, messageStatusEvent(rowA.wamid, "read"))).status()).toBe(200);

    const after = (id: number, s: Salon) =>
      messageLog(request, s.token).then((rows) => rows.find((m) => m.id === id));
    expect((await after(idA, a))?.status).toBe("READ");
    expect((await after(idB, b))?.status).toBe("SENT");
    // The status of a message of A can never show up in B's log, whatever B's token is.
    expect((await messageLog(request, b.token)).find((m) => m.wamid === rowA.wamid)).toBeUndefined();
  });

  test("3: un salón no puede leer los avisos de un turno de otro salón", async ({ request }) => {
    const seed = await seedCategoryServiceProfessional(request, a.token);
    const client = await consentingClient(request, a);
    const appt = await createAppointmentApi(request, a.token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: instantToOffsetIso(new Date(Date.now() + (20 + (n % 30)) * 86_400_000)),
    });
    const id = await queue(request, a, { appointmentId: appt.id, clientId: client.id });
    await waitForFinalStatus(request, a.token, id);

    const own = await request.get(`${API_BASE}/api/appointments/${appt.id}/messages`, {
      headers: authHeaders(a.token),
    });
    expect(own.ok(), await own.text()).toBeTruthy();
    expect(((await own.json()) as { hasNotice: boolean }).hasNotice).toBe(true);

    await expectCrossTenantForbidden(request, b.token, `/api/appointments/${appt.id}/messages`);
  });

  test("4: el consentimiento es de cada salón: no se cambia desde otro ni vale para otra clienta", async ({
    request,
  }) => {
    const clientA = await consentingClient(request, a);
    const clientB = await createClientApi(request, b.token, unique("b"), PHONE);

    // B cannot touch A's client.
    const res = await setConsentApi(request, b.token, clientA.id, false);
    expect(res.status()).toBe(404);
    expect((await getClientApi(request, a.token, clientA.id)).whatsappOptIn).toBe(true);

    // The same phone consented in A does not make B's client reachable.
    const idB = await queue(request, b, { clientId: clientB.id });
    const rowB = await waitForFinalStatus(request, b.token, idB);
    expect(rowB.status).toBe("CANCELLED");
    expect(rowB.errorCode).toBe("NO_CONSENT");

    // And A's own message does go out.
    const idA = await queue(request, a, { clientId: clientA.id });
    expect((await waitForFinalStatus(request, a.token, idA)).status).toBe("SENT");
    expect(await sentMessages(request, a.token)).toHaveLength(1);
  });

  test("5: una baja vale para todos los salones y ninguno puede reactivarla", async ({ request }) => {
    const clients = [await consentingClient(request, a), await consentingClient(request, b)];
    const salons = [a, b];
    // A BAJA reply is recorded by phone (HU-WAP-06); the support endpoint stands in for it.
    const optOut = await request.post(`${API_BASE}/api/admin/whatsapp-test-support/opt-outs`, {
      headers: authHeaders(a.token),
      data: { phone: PHONE_E164 },
    });
    expect(optOut.ok(), await optOut.text()).toBeTruthy();

    for (const [i, s] of salons.entries()) {
      const id = await queue(request, s, { clientId: clients[i].id });
      const row = await waitForFinalStatus(request, s.token, id);
      expect(row.status, s.t.key).toBe("CANCELLED");
      expect(row.errorCode, s.t.key).toBe("OPTED_OUT");

      await setConsentApi(request, s.token, clients[i].id, false);
      const retry = await setConsentApi(request, s.token, clients[i].id, true);
      expect(retry.status(), s.t.key).toBe(409);
      expect(await retry.text()).toContain("WHATSAPP_PHONE_OPTED_OUT");
    }
    expect(await sentMessages(request, a.token)).toHaveLength(0);
  });

  test("6: los flags del canal son de cada salón", async ({ request }) => {
    await setTenantFeatureFlag(request, b.t.id, WHATSAPP_FLAG, false);
    try {
      const idA = await queue(request, a);
      const idB = await queue(request, b);

      expect((await waitForFinalStatus(request, a.token, idA)).status).toBe("SENT");
      const rowB = await waitForFinalStatus(request, b.token, idB);
      expect(rowB.status).toBe("FAILED");
      expect(rowB.errorCode).toBe("CHANNEL_UNAVAILABLE");

      const consent = await setConsentApi(request, b.token, (await createClientApi(request, b.token, unique("f"), PHONE)).id, true);
      expect(consent.status()).toBe(403);
      expect(await consent.text()).toContain("WHATSAPP_REMINDERS_DISABLED");
    } finally {
      await setTenantFeatureFlag(request, b.t.id, WHATSAPP_FLAG, true);
    }
  });

  test("7: un número sin WhatsApp queda marcado para todos los salones", async ({ request }) => {
    await failNext(request, a.token, "INVALID_RECIPIENT");
    const idA = await queue(request, a);
    await waitForFinalStatus(request, a.token, idA);

    const idB = await queue(request, b);
    const rowB = await waitForFinalStatus(request, b.token, idB);

    expect(rowB.status).toBe("FAILED");
    expect(rowB.errorCode).toBe("INVALID_RECIPIENT");
    expect(rowB.attempts).toBe(1);
    expect(await sentMessages(request, a.token)).toHaveLength(0);
  });
});
