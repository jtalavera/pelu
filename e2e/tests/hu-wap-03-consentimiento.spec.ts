import { expect, test } from "@playwright/test";

import {
  API_BASE,
  apiPutJson,
  authHeaders,
  loginAsDemoApi,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import {
  BOOKING_FLAG,
  CONFIRMED_LINK,
  CONFIRMED_VARS,
  WHATSAPP_FLAG,
  createClientApi,
  enableWhatsAppFlags,
  enqueueMessage,
  genericClientId,
  getClientApi,
  optOutPhone,
  restoreCatalog,
  restoreWhatsAppFlags,
  sentMessages,
  setConsentApi,
  waitForFinalStatus,
} from "../fixtures/whatsapp";

// HU-WAP-03 · Consentimiento de la clienta para recibir WhatsApp
// requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md
//
// Cobertura por criterio (la historia se entrega por partes, ver docs/whatsapp-channel.md):
//  1 modelo ................................ consentimiento con fecha y origen «STAFF» en la ficha
//  2 alta en el salón ...................... interruptor con su ayuda, registro en la auditoría
//  4 retiro (por el salón) ................. efecto inmediato: un mensaje en cola se cancela
//  5 baja a nivel de plataforma ............ un celular dado de baja no recibe nada y el salón no lo reactiva
//  6 clientas existentes ................... nacen sin consentimiento
//  7 clienta ocasional ..................... nunca recibe WhatsApp
//  8 cambio de celular ..................... invalida el consentimiento anterior
//  9 visibilidad ........................... se ve en la lista y en la ficha; la profesional no accede
//                                             (ProfessionalAccessPolicyTest / ClientService.nameOnlyForProfessional, JUnit)
//  Pendientes por depender de otros incrementos: 1 (consentimiento propio de los turnos online →
//  columnas de appointments, A4), 3 (alta desde el email → enlace firmado y página pública, A5) y
//  4 (retiro respondiendo BAJA → HU-WAP-06, C4).

test.describe.configure({ mode: "serial" });

const TENANT_ID = 1;
const PHONE_FORM = "0981 123 456";
const PHONE_E164 = "+595981123456";
let n = 0;
const key = (label: string) => `e2e-${label}-${Date.now()}-${++n}`;
const unique = (label: string) => `E2E WA ${label} ${Date.now()}${++n}`;

test.describe("HU-WAP-03 · Consentimiento de la clienta para recibir WhatsApp", () => {
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

  async function openClient(page: import("@playwright/test").Page, id: number) {
    await loginAsDemo(page);
    await page.goto(`/app/clients/${id}`);
    await expect(page.getByTestId("client-section-contact")).toBeVisible();
  }

  test("AC6: una clienta nueva (o existente) no tiene consentimiento", async ({ request }) => {
    const c = await createClientApi(request, token, unique("nueva"), PHONE_FORM);
    expect(c.whatsappOptIn).toBe(false);
    expect(c.whatsappOptInAt).toBeNull();
    expect((await getClientApi(request, token, c.id)).whatsappOptIn).toBe(false);
  });

  test("AC2: el interruptor explica cuándo activarlo y registra el consentimiento con fecha y origen", async ({
    page,
    request,
  }) => {
    const c = await createClientApi(request, token, unique("alta"), PHONE_FORM);
    await openClient(page, c.id);

    const box = page.getByTestId("client-whatsapp-consent");
    await expect(box).toContainText("Accepts WhatsApp notices");
    await expect(page.getByTestId("client-whatsapp-hint")).toHaveText("Turn it on only if the client agreed.");
    const sw = page.getByTestId("client-whatsapp-switch");
    await expect(sw).not.toBeChecked();

    await sw.dispatchEvent("click");

    await expect(sw).toBeChecked();
    await expect(page.getByTestId("client-whatsapp-since")).toContainText("Recorded on");
    const saved = await getClientApi(request, token, c.id);
    expect(saved.whatsappOptIn).toBe(true);
    expect(saved.whatsappOptInSource).toBe("STAFF");
    expect(saved.whatsappOptInAt).not.toBeNull();

    await page.reload();
    await expect(page.getByTestId("client-whatsapp-switch")).toBeChecked();
  });

  test("AC2: el alta y el retiro quedan en la auditoría (quién y cuándo)", async ({ request }) => {
    const c = await createClientApi(request, token, unique("audit"), PHONE_FORM);
    expect((await setConsentApi(request, token, c.id, true)).ok()).toBeTruthy();
    expect((await setConsentApi(request, token, c.id, false)).ok()).toBeTruthy();

    const res = await request.get(`${API_BASE}/api/audit?resource=clients&size=50`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const page = (await res.json()) as {
      content: Array<{ userEmail: string; resource: string; operation: string | null; entityId: string; createdAt: string; httpMethod: string }>;
    };
    const entries = page.content.filter(
      (e) => e.operation === "whatsapp-consent" && e.entityId === String(c.id),
    );
    expect(entries.length).toBeGreaterThanOrEqual(2);
    for (const e of entries) {
      expect(e.userEmail).toContain("@");
      expect(e.httpMethod).toBe("PUT");
      expect(e.createdAt).toBeTruthy();
    }
  });

  test("AC4: el consentimiento activo permite enviar; retirarlo desde la ficha lo corta", async ({
    page,
    request,
  }) => {
    const c = await createClientApi(request, token, unique("retiro"), PHONE_FORM);
    await openClient(page, c.id);
    await page.getByTestId("client-whatsapp-switch").dispatchEvent("click");
    await expect(page.getByTestId("client-whatsapp-switch")).toBeChecked();

    const sentOk = await enqueueMessage(request, token, {
      template: "pelu_turno_confirmado",
      to: PHONE_FORM,
      variables: CONFIRMED_VARS,
      buttons: [CONFIRMED_LINK],
      dedupKey: key("con-consent"),
      clientId: c.id,
    });
    const okRow = await waitForFinalStatus(request, token, ((await sentOk.json()) as { id: number }).id);
    expect(okRow.status).toBe("SENT");
    expect((await sentMessages(request, token)).at(-1)?.to).toBe(PHONE_E164);

    await page.getByTestId("client-whatsapp-switch").dispatchEvent("click");
    await expect(page.getByTestId("client-whatsapp-switch")).not.toBeChecked();
    expect((await getClientApi(request, token, c.id)).whatsappOptIn).toBe(false);

    const afterWithdrawal = await enqueueMessage(request, token, {
      template: "pelu_turno_confirmado",
      to: PHONE_FORM,
      variables: CONFIRMED_VARS,
      buttons: [CONFIRMED_LINK],
      dedupKey: key("sin-consent"),
      clientId: c.id,
      fallbackEmail: "ana@example.com",
    });
    const row = await waitForFinalStatus(
      request,
      token,
      ((await afterWithdrawal.json()) as { id: number }).id,
    );
    expect(row.status).toBe("CANCELLED");
    expect(row.errorCode).toBe("NO_CONSENT");
    expect(await sentMessages(request, token)).toHaveLength(1); // only the first one
  });

  test("AC6: una clienta sin consentimiento no recibe WhatsApp (ni respaldo: no lo pidió)", async ({
    request,
  }) => {
    const c = await createClientApi(request, token, unique("sinconsent"), PHONE_FORM);
    const res = await enqueueMessage(request, token, {
      template: "pelu_turno_confirmado",
      to: PHONE_FORM,
      variables: CONFIRMED_VARS,
      buttons: [CONFIRMED_LINK],
      dedupKey: key("nc"),
      clientId: c.id,
      fallbackEmail: "ana@example.com",
    });

    const row = await waitForFinalStatus(request, token, ((await res.json()) as { id: number }).id);

    expect(row.status).toBe("CANCELLED");
    expect(row.errorCode).toBe("NO_CONSENT");
    expect(await sentMessages(request, token)).toHaveLength(0);
  });

  test("AC8: al cambiar el celular de la clienta el consentimiento anterior se invalida", async ({
    page,
    request,
  }) => {
    const c = await createClientApi(request, token, unique("celular"), PHONE_FORM);
    expect((await setConsentApi(request, token, c.id, true)).ok()).toBeTruthy();

    // Same number typed differently: the consent stays.
    await apiPutJson(request, token, `/api/clients/${c.id}`, {
      fullName: c.fullName,
      phone: "+595 981 123 456",
      email: null,
      ruc: null,
    });
    expect((await getClientApi(request, token, c.id)).whatsappOptIn).toBe(true);

    // Another number: the consent was for the old one and is dropped.
    await apiPutJson(request, token, `/api/clients/${c.id}`, {
      fullName: c.fullName,
      phone: "0982 999 888",
      email: null,
      ruc: null,
    });
    const after = await getClientApi(request, token, c.id);
    expect(after.whatsappOptIn).toBe(false);

    await openClient(page, c.id);
    await expect(page.getByTestId("client-whatsapp-switch")).not.toBeChecked();

    // A message to the NEW number is not covered by the old consent either.
    const res = await enqueueMessage(request, token, {
      template: "pelu_turno_confirmado",
      to: "0982 999 888",
      variables: CONFIRMED_VARS,
      buttons: [CONFIRMED_LINK],
      dedupKey: key("newnum"),
      clientId: c.id,
    });
    const row = await waitForFinalStatus(request, token, ((await res.json()) as { id: number }).id);
    expect(row.errorCode).toBe("NO_CONSENT");

    // It is asked for again: with the new number it works.
    expect((await setConsentApi(request, token, c.id, true)).ok()).toBeTruthy();
    const again = await enqueueMessage(request, token, {
      template: "pelu_turno_confirmado",
      to: "0982 999 888",
      variables: CONFIRMED_VARS,
      buttons: [CONFIRMED_LINK],
      dedupKey: key("newnum2"),
      clientId: c.id,
    });
    expect(
      (await waitForFinalStatus(request, token, ((await again.json()) as { id: number }).id)).status,
    ).toBe("SENT");
  });

  test("AC8: con el celular editado y sin guardar, el interruptor espera al celular guardado", async ({
    page,
    request,
  }) => {
    const c = await createClientApi(request, token, unique("sucio"), PHONE_FORM);
    await openClient(page, c.id);

    await page.getByLabel("Phone").fill("0982999888");

    await expect(page.getByTestId("client-whatsapp-switch")).toBeDisabled();
    await expect(page.getByTestId("client-whatsapp-hint")).toContainText("Save the phone change first");
  });

  test("AC2: sin un celular válido no se puede activar (con el mensaje y un ejemplo)", async ({
    page,
    request,
  }) => {
    const c = await createClientApi(request, token, unique("sincel"), null);
    await openClient(page, c.id);

    await expect(page.getByTestId("client-whatsapp-switch")).toBeDisabled();
    await expect(page.getByTestId("client-whatsapp-hint")).toContainText("Example: 0981 123 456");

    const res = await setConsentApi(request, token, c.id, true);
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain("WHATSAPP_CLIENT_PHONE_INVALID");
  });

  test("AC5: un celular dado de baja no recibe nada y el salón no puede reactivarlo", async ({
    page,
    request,
  }) => {
    const c = await createClientApi(request, token, unique("baja"), PHONE_FORM);
    expect((await setConsentApi(request, token, c.id, true)).ok()).toBeTruthy();
    await optOutPhone(request, token, PHONE_E164);

    // Messages to that phone are not sent, with or without a registered client.
    for (const clientId of [c.id, undefined]) {
      const res = await enqueueMessage(request, token, {
        template: "pelu_turno_confirmado",
        to: PHONE_FORM,
        variables: CONFIRMED_VARS,
        buttons: [CONFIRMED_LINK],
        dedupKey: key("optout"),
        clientId,
      });
      const row = await waitForFinalStatus(request, token, ((await res.json()) as { id: number }).id);
      expect(row.status).toBe("CANCELLED");
      expect(row.errorCode).toBe("OPTED_OUT");
    }
    expect(await sentMessages(request, token)).toHaveLength(0);

    // The salon cannot turn it back on: not through the API, not through the screen.
    await setConsentApi(request, token, c.id, false);
    const retry = await setConsentApi(request, token, c.id, true);
    expect(retry.status()).toBe(409);
    expect(await retry.text()).toContain("WHATSAPP_PHONE_OPTED_OUT");

    await openClient(page, c.id);
    await page.getByTestId("client-whatsapp-switch").dispatchEvent("click");
    await expect(
      page.getByRole("alert").filter({ hasText: "asked not to receive WhatsApp notices" }),
    ).toBeVisible();
    await expect(page.getByTestId("client-whatsapp-switch")).not.toBeChecked();
  });

  test("AC7: la clienta ocasional genérica nunca recibe WhatsApp", async ({ request }) => {
    const genericId = await genericClientId(request, token);

    const res = await setConsentApi(request, token, genericId, true);
    expect(res.status()).toBe(409);
    expect(await res.text()).toContain("CLIENT_GENERIC_READ_ONLY");

    const queued = await enqueueMessage(request, token, {
      template: "pelu_turno_confirmado",
      to: PHONE_FORM,
      variables: CONFIRMED_VARS,
      buttons: [CONFIRMED_LINK],
      dedupKey: key("generic"),
      clientId: genericId,
    });
    const row = await waitForFinalStatus(request, token, ((await queued.json()) as { id: number }).id);
    expect(row.status).toBe("CANCELLED");
    expect(await sentMessages(request, token)).toHaveLength(0);
  });

  test("Una clienta inactiva no admite cambiar el consentimiento", async ({ page, request }) => {
    const c = await createClientApi(request, token, unique("inactiva"), PHONE_FORM);
    const off = await request.post(`${API_BASE}/api/clients/${c.id}/deactivate`, {
      headers: authHeaders(token),
    });
    expect(off.ok(), await off.text()).toBeTruthy();

    const res = await setConsentApi(request, token, c.id, true);
    expect(res.status()).toBe(409);
    expect(await res.text()).toContain("CLIENT_INACTIVE");

    await openClient(page, c.id);
    await expect(page.getByTestId("client-whatsapp-switch")).toBeDisabled();
    await expect(page.getByTestId("client-whatsapp-hint")).toContainText("Reactivate the client");
  });

  test("AC9: la lista de clientas indica quién acepta WhatsApp", async ({ page, request }) => {
    const yes = await createClientApi(request, token, unique("listasi"), PHONE_FORM);
    const no = await createClientApi(request, token, unique("listano"), "0982 111 222");
    expect((await setConsentApi(request, token, yes.id, true)).ok()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByPlaceholder(/search/i).first().fill(yes.fullName);
    await expect(page.getByText(yes.fullName)).toBeVisible();
    await expect(page.getByText(yes.fullName).locator("xpath=..")).toContainText("Accepts WhatsApp");

    await page.getByPlaceholder(/search/i).first().fill(no.fullName);
    await expect(page.getByText(no.fullName)).toBeVisible();
    await expect(page.getByText(no.fullName).locator("xpath=..")).not.toContainText("Accepts WhatsApp");
  });

  test("RT-01: con el canal apagado para el salón el interruptor no existe y la API responde 403", async ({
    page,
    request,
  }) => {
    const c = await createClientApi(request, token, unique("flagoff"), PHONE_FORM);

    await setTenantFeatureFlag(request, TENANT_ID, WHATSAPP_FLAG, false);
    try {
      const res = await setConsentApi(request, token, c.id, true);
      expect(res.status()).toBe(403);
      expect(await res.text()).toContain("WHATSAPP_REMINDERS_DISABLED");
      await openClient(page, c.id);
      await expect(page.getByTestId("client-whatsapp-consent")).toHaveCount(0);
    } finally {
      await setTenantFeatureFlag(request, TENANT_ID, WHATSAPP_FLAG, true);
    }

    await setTenantFeatureFlag(request, TENANT_ID, BOOKING_FLAG, false);
    try {
      const res = await setConsentApi(request, token, c.id, true);
      expect(res.status()).toBe(403);
      expect(await res.text()).toContain("ONLINE_BOOKING_DISABLED");
    } finally {
      await setTenantFeatureFlag(request, TENANT_ID, BOOKING_FLAG, true);
    }
    expect((await getClientApi(request, token, c.id)).whatsappOptIn).toBe(false);
  });

  test("Una clienta que no existe en el salón responde 404", async ({ request }) => {
    const res = await setConsentApi(request, token, 999_999_999, true);
    expect(res.status()).toBe(404);
  });
});
