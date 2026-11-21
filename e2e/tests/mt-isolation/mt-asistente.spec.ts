import { expect, test } from "@playwright/test";

import {
  API_BASE,
  apiBaseUrl,
  authHeaders,
  loginPlatformAdminApi,
  putProfessionalSchedules,
} from "../../fixtures/api";
import {
  ASSISTANT_FLAG,
  askAssistantApi,
  bookAppointmentTomorrow,
  createClientWithPhone,
  completeDraftApi,
  confirmDraftApi,
  currentConversationApi,
  enableAssistantGlobally,
  optionLabels,
  proposeAppointmentViaApi,
  proposeViaApi,
  restoreAssistantGlobal,
  workingWeek,
} from "../../fixtures/assistant";
import { setTenantFlag } from "../../fixtures/commissions";
import { getMtWorld, mtLoginToken, type MtTenant } from "../../fixtures/mt/world";

/**
 * Conversational assistant (HU-AST-02 AC7) — multi-tenant isolation. A user of salon A must not
 * reach clients, turnos or conversations of salon B through the assistant, and the feature flag is
 * resolved per salon. The model is the scripted one (app.femme.assistant.model=fake); the flag is
 * OFF globally by default, so the suite switches it on globally and restores it at the end.
 */
test.describe.configure({ mode: "serial" });

test.describe("mt-asistente · aislamiento del asistente conversacional", () => {
  const world = getMtWorld();
  const tag = String(Date.now()).slice(-7);
  const names = { A: `MT Asistente Alfa ${tag}`, B: `MT Asistente Beta ${tag}` };
  let tokenA: string;
  let tokenB: string;
  let bookingDate: Record<"A" | "B", string>;

  async function seed(request: Parameters<typeof mtLoginToken>[0], tenant: MtTenant, token: string, name: string) {
    const client = await createClientWithPhone(request, token, name);
    const booked = await bookAppointmentTomorrow(request, token, {
      clientId: client.id,
      professionalId: tenant.professionalIds[0],
      serviceId: tenant.catalog.serviceIds[0],
    });
    return booked.date;
  }

  test.beforeAll(async ({ request }) => {
    await enableAssistantGlobally(request);
    tokenA = await mtLoginToken(request, world.tenantA);
    tokenB = await mtLoginToken(request, world.tenantB);
    bookingDate = {
      A: await seed(request, world.tenantA, tokenA, names.A),
      B: await seed(request, world.tenantB, tokenB, names.B),
    };
  });

  test.afterAll(async ({ request }) => {
    await restoreAssistantGlobal(request);
  });

  test("las consultas de un salón no devuelven turnos ni clientes del otro", async ({ request }) => {
    const convA = await currentConversationApi(request, tokenA);
    const convB = await currentConversationApi(request, tokenB);

    const agendaA = await askAssistantApi(request, tokenA, convA.conversationId, `appointments ${bookingDate.A}`);
    expect(agendaA.status).toBe(200);
    expect(agendaA.text).toMatch(new RegExp(names.A, "i"));
    expect(agendaA.text).not.toMatch(new RegExp(names.B, "i"));

    const agendaB = await askAssistantApi(request, tokenB, convB.conversationId, `appointments ${bookingDate.B}`);
    expect(agendaB.text).toMatch(new RegExp(names.B, "i"));
    expect(agendaB.text).not.toMatch(new RegExp(names.A, "i"));

    // Asking for the other salon's client by exact name finds nothing.
    const crossSearch = await askAssistantApi(request, tokenA, convA.conversationId, `search ${names.B}`);
    expect(crossSearch.text).toContain("No encontré clientes");
    expect(crossSearch.text).not.toMatch(new RegExp(names.B, "i"));
    const crossAppointments = await askAssistantApi(
      request,
      tokenA,
      convA.conversationId,
      `appointments of ${names.B} on ${bookingDate.B}`,
    );
    expect(crossAppointments.text).not.toMatch(new RegExp(names.B, "i"));

    // Each salon finds its own client.
    const ownSearch = await askAssistantApi(request, tokenB, convB.conversationId, `search ${names.B}`);
    expect(ownSearch.text).toMatch(new RegExp(names.B, "i"));
  });

  test("las conversaciones son de cada salón: ni se leen ni se continúan desde el otro", async ({ request }) => {
    const convA = await currentConversationApi(request, tokenA);
    const convB = await currentConversationApi(request, tokenB);
    expect(convA.conversationId).not.toBe(convB.conversationId);

    await askAssistantApi(request, tokenA, convA.conversationId, `search ${names.A}`);
    const historyB = await currentConversationApi(request, tokenB);
    expect(JSON.stringify(historyB.messages)).not.toContain(names.A);

    const intruder = await askAssistantApi(request, tokenB, convA.conversationId, "services");
    expect(intruder.status, intruder.raw).toBe(404);
    expect(intruder.raw).toContain("ASSISTANT_CONVERSATION_NOT_FOUND");
    const historyA = await currentConversationApi(request, tokenA);
    expect(JSON.stringify(historyA.messages)).not.toContain("services");
  });

  test("el flag se resuelve por salón: apagado para B, el asistente de A sigue funcionando", async ({ request }) => {
    await setTenantFlag(request, world.tenantB.id, ASSISTANT_FLAG, false);
    try {
      const refused = await request.get(`${API_BASE}/api/assistant/conversations/current`, {
        headers: authHeaders(tokenB),
      });
      expect(refused.status()).toBe(403);
      expect(await refused.text()).toContain("ASSISTANT_DISABLED");

      const still = await request.get(`${API_BASE}/api/assistant/conversations/current`, {
        headers: authHeaders(tokenA),
      });
      expect(still.status()).toBe(200);
      // Dictation follows the same flag: no voice token for the salon that has it off.
      const noVoice = await request.get(`${API_BASE}/api/assistant/speech-token`, { headers: authHeaders(tokenB) });
      expect(noVoice.status()).toBe(403);
      expect(await noVoice.text()).toContain("ASSISTANT_DISABLED");
      const voiceA = await request.get(`${API_BASE}/api/assistant/speech-token`, { headers: authHeaders(tokenA) });
      expect(voiceA.status()).toBe(200);
    } finally {
      const platform = await loginPlatformAdminApi(request);
      await request.delete(
        `${apiBaseUrl()}/api/admin/feature-flags/tenants/${world.tenantB.id}/${ASSISTANT_FLAG}`,
        { headers: authHeaders(platform) },
      );
    }
    const back = await request.get(`${API_BASE}/api/assistant/conversations/current`, {
      headers: authHeaders(tokenB),
    });
    expect(back.status()).toBe(200);
  });

  test("HU-AST-03 AC14 · un borrador es de su salón: otro salón no puede confirmarlo, completarlo ni descartarlo", async ({
    request,
  }) => {
    const serviceA = world.tenantA.catalog.serviceNames[0];
    const { draft } = await proposeViaApi(request, tokenA, `invoice ${names.A} for ${serviceA}`);
    expect(draft, "salon A gets its own draft").not.toBeNull();
    expect(draft!.payload.clientName).toMatch(new RegExp(names.A, "i"));

    // Salon B knows the id but it is not its draft: 404 everywhere, nothing changes.
    const confirm = await confirmDraftApi(request, tokenB, draft!.id);
    expect(confirm.status()).toBe(404);
    const patch = await request.patch(`${API_BASE}/api/assistant/drafts/${draft!.id}`, {
      headers: authHeaders(tokenB),
      data: { paymentMethod: "CASH" },
    });
    expect(patch.status()).toBe(404);
    const discard = await request.post(`${API_BASE}/api/assistant/drafts/${draft!.id}/discard`, {
      headers: authHeaders(tokenB),
    });
    expect(discard.status()).toBe(404);

    // The owner still has it intact (and can complete it).
    await completeDraftApi(request, tokenA, draft!.id, { paymentMethod: "CASH" });
  });

  test("HU-AST-03 AC14 · el asistente no arma borradores con clientes ni servicios de otro salón", async ({
    request,
  }) => {
    const serviceA = world.tenantA.catalog.serviceNames[0];

    const otherClient = await proposeViaApi(request, tokenA, `invoice ${names.B} for ${serviceA}`);
    expect(otherClient.draft).toBeNull();
    expect(otherClient.answer.text).toContain("No encontré");

    // A service that only exists in the other salon (its own copy of the shared names is fine).
    const privateName = `MT Servicio privado ${tag}`;
    const created = await request.post(`${API_BASE}/api/service-categories`, {
      headers: authHeaders(tokenB),
      data: { name: `MT Cat privada ${tag}`, accentKey: "stone" },
    });
    const category = (await created.json()) as { id: number };
    await request.post(`${API_BASE}/api/services`, {
      headers: authHeaders(tokenB),
      data: { name: privateName, categoryId: category.id, priceMinor: 12000, durationMinutes: 30 },
    });
    const otherService = await proposeViaApi(request, tokenA, `invoice ${names.A} for ${privateName}`);
    expect(otherService.draft).toBeNull();
  });

  test("HU-AST-05 AC8 · la disponibilidad solo incluye profesionales del propio salón", async ({ request }) => {
    const proA = world.tenantA.professionalIds[0];
    const proB = world.tenantB.professionalIds[0];
    await putProfessionalSchedules(request, tokenA, proA, workingWeek());
    await putProfessionalSchedules(request, tokenB, proB, workingWeek());
    const serviceA = world.tenantA.catalog.serviceNames[0];
    const convA = await currentConversationApi(request, tokenA);

    const res = await askAssistantApi(request, tokenA, convA.conversationId, `availability tomorrow for ${serviceA}`);

    expect(res.status).toBe(200);
    expect(optionLabels(res).length).toBeGreaterThan(0);
    const chips = JSON.stringify(res.events.filter((e) => e.event === "card.options"));
    // Every chip carries a professional id: none of them is salon B's.
    expect(chips).not.toMatch(new RegExp(`profesional ${proB}[,)]`));
    expect(chips).toMatch(new RegExp(`profesional ${proA}[,)]`));
  });

  test("HU-AST-06 AC14 · un borrador de turno es de su salón: otro salón no puede confirmarlo, completarlo ni descartarlo", async ({
    request,
  }) => {
    const serviceA = world.tenantA.catalog.serviceNames[0];
    const { draft } = await proposeAppointmentViaApi(
      request,
      tokenA,
      `book ${names.A} for ${serviceA} tomorrow at 10:00`,
    );
    expect(draft, "salon A gets its own appointment draft").not.toBeNull();

    expect((await confirmDraftApi(request, tokenB, draft!.id)).status()).toBe(404);
    const patch = await request.patch(`${API_BASE}/api/assistant/drafts/${draft!.id}`, {
      headers: authHeaders(tokenB),
      data: { startAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
    });
    expect(patch.status()).toBe(404);
    const discard = await request.post(`${API_BASE}/api/assistant/drafts/${draft!.id}/discard`, {
      headers: authHeaders(tokenB),
    });
    expect(discard.status()).toBe(404);
  });

  test("HU-AST-06 AC14 · el asistente no arma turnos con clientes ni profesionales de otro salón", async ({ request }) => {
    const serviceA = world.tenantA.catalog.serviceNames[0];

    const otherClient = await proposeAppointmentViaApi(
      request,
      tokenA,
      `book ${names.B} for ${serviceA} tomorrow at 10:00`,
    );
    expect(otherClient.draft).toBeNull();
    expect(otherClient.answer.text).toContain("No encontré");

    // The professional of salon A is the only one A can book: an unknown name finds nobody.
    const { conversationId } = await currentConversationApi(request, tokenA);
    const ghost = await askAssistantApi(
      request,
      tokenA,
      conversationId,
      `book ${names.A} for ${serviceA} tomorrow at 10:00 with Profesional Inexistente ${tag}`,
    );
    expect(ghost.events.some((e) => e.event === "card.draft")).toBe(false);
  });

  test("sin sesión no hay asistente", async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/assistant/conversations/current`);
    expect([401, 403]).toContain(res.status());
  });
});
