import { expect, test } from "@playwright/test";

import { API_BASE, apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../../fixtures/api";
import {
  ASSISTANT_FLAG,
  askAssistantApi,
  bookAppointmentTomorrow,
  createClientWithPhone,
  currentConversationApi,
  enableAssistantGlobally,
  restoreAssistantGlobal,
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

  test("sin sesión no hay asistente", async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/assistant/conversations/current`);
    expect([401, 403]).toContain(res.status());
  });
});
