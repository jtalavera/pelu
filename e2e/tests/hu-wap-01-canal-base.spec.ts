import { expect, test } from "@playwright/test";

import { API_BASE, authHeaders, decodeJwtPayload, loginAsDemoApi, loginPlatformAdminApi, setTenantFeatureFlag } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";
import {
  BOOKING_FLAG,
  WHATSAPP_FLAG,
  enableWhatsAppFlags,
  enqueueMessage,
  failNext,
  messageLog,
  resetFake,
  restoreCatalog,
  restoreWhatsAppFlags,
  sendCode,
  sentMessages,
  waitForFinalStatus,
} from "../fixtures/whatsapp";

// HU-WAP-01 · Base técnica del canal: envío, configuración y entorno de pruebas
// requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md
//
// Cobertura por criterio (el proveedor es el falso: nada sale del proceso):
//  1 envío ampliado con botones y wamid ........ test-send de la plantilla con 3 botones (UI y soporte)
//  2 errores tipificados ........................ un caso por categoría contra la API de plataforma
//  3 dos modos de envío ......................... enqueue (commit / rollback / una vez por evento) y código síncrono
//  4 normalización de teléfonos ................. formas del celular paraguayo y rechazo de fijos
//  7 proveedor falso + soporte .................. todo este spec lo usa; que NO exista en producción lo prueba
//                                                 WhatsAppProductionDefaultsTest (JUnit)
//  8 dependencia de flags ....................... cada flag apagado del salón deja el mensaje FAILED sin enviar
//  Criterios 5 (Terraform/Key Vault), 6 (arranque seguro con configuración incompleta) y 9 (un solo
//  cliente HTTP con tiempos de espera) no se pueden observar desde el navegador: los cubren
//  WhatsAppSettingsTest, WhatsAppProductionDefaultsTest y MetaCloudWhatsAppGatewayTest (JUnit).

test.describe.configure({ mode: "serial" });

const TENANT_ID = 1;
const URL_BTN = (index: number, value: string) => ({ kind: "URL" as const, index, value });
const CONFIRMED_VARS = ["María", "Salón Bella", "Corte", "viernes 28/11", "15:30", "Laura"];

let n = 0;
const key = (label: string) => `e2e-${label}-${Date.now()}-${++n}`;

test.describe("HU-WAP-01 · Base técnica del canal de WhatsApp", () => {
  let platformToken: string;
  let tenantToken: string;

  test.beforeAll(async ({ request }) => {
    await enableWhatsAppFlags(request);
    platformToken = await loginPlatformAdminApi(request);
    tenantToken = await loginAsDemoApi(request);
    expect(Number(decodeJwtPayload(tenantToken).tid)).toBe(TENANT_ID);
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

  test("AC1: el envío de prueba lleva cuerpo, dos respuestas rápidas y un enlace, y devuelve el wamid", async ({
    page,
    request,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.getByRole("link", { name: "WhatsApp", exact: true }).click();
    await expect(page).toHaveURL(/\/platform\/whatsapp/);
    await expect(page.getByRole("heading", { name: "WhatsApp", level: 1 })).toBeVisible();

    await page.getByLabel("Template", { exact: true }).selectOption("pelu_recordatorio_turno");
    await page.getByLabel("Destination phone").fill("0981 123 456");
    await page.getByTestId("whatsapp-test-send").click();

    const result = page.getByTestId("whatsapp-test-result");
    await expect(result).toContainText("Message sent. Id: wamid.");

    const sent = await sentMessages(request, tenantToken);
    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe("pelu_recordatorio_turno");
    expect(sent[0].language).toBe("es");
    expect(sent[0].to).toBe("+595981123456");
    expect(sent[0].bodyParameters).toEqual(["María", "Salón Bella", "Corte y brushing", "viernes 28/11", "15:30"]);
    expect(sent[0].buttons.map((b) => [b.kind, b.index])).toEqual([
      ["QUICK_REPLY", 0],
      ["QUICK_REPLY", 1],
      ["URL", 2],
    ]);
    await expect(result).toContainText(sent[0].wamid);
  });

  test("AC1: el envío de prueba valida el celular en el formulario antes de llamar a la API", async ({
    page,
    request,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/whatsapp");
    await page.getByTestId("whatsapp-test-send").click();

    await expect(page.getByRole("alert").filter({ hasText: "Example: 0981 123 456" })).toBeVisible();
    expect(await sentMessages(request, tenantToken)).toHaveLength(0);
  });

  const typedErrors: Array<{ code: string; status: number; reason: string; ui: string }> = [
    { code: "INVALID_RECIPIENT", status: 400, reason: "WHATSAPP_INVALID_RECIPIENT", ui: "not valid or has no WhatsApp" },
    { code: "TEMPLATE_UNAVAILABLE", status: 409, reason: "WHATSAPP_TEMPLATE_UNAVAILABLE", ui: "not approved by Meta" },
    { code: "RATE_LIMITED", status: 409, reason: "WHATSAPP_RATE_LIMITED", ui: "sending limit" },
    { code: "AUTH_FAILED", status: 409, reason: "WHATSAPP_AUTH_FAILED", ui: "expired or lacks permissions" },
    { code: "TRANSIENT", status: 409, reason: "WHATSAPP_TRANSIENT", ui: "did not respond" },
    { code: "INVALID_REQUEST", status: 400, reason: "WHATSAPP_INVALID_REQUEST", ui: "message is not valid" },
  ];

  for (const c of typedErrors) {
    test(`AC2: un fallo ${c.code} se distingue y se traduce`, async ({ page, request }) => {
      await failNext(request, tenantToken, c.code);
      const res = await request.post(`${API_BASE}/api/platform/whatsapp/test-send`, {
        headers: authHeaders(platformToken),
        data: { to: "0981123456", template: "pelu_turno_cancelado" },
      });
      expect(res.status()).toBe(c.status);
      expect(await res.text()).toContain(c.reason);

      // The same failure as the platform admin sees it in the screen.
      await failNext(request, tenantToken, c.code);
      await loginAsPlatformAdmin(page);
      await page.goto("/platform/whatsapp");
      await page.getByLabel("Template", { exact: true }).selectOption("pelu_turno_cancelado");
      await page.getByLabel("Destination phone").fill("0981123456");
      await page.getByTestId("whatsapp-test-send").click();
      await expect(page.getByTestId("whatsapp-test-error")).toContainText(c.ui);
    });
  }

  test("AC3: un mensaje encolado sale solo después del commit y queda registrado con su wamid", async ({
    request,
  }) => {
    const res = await enqueueMessage(request, tenantToken, {
      template: "pelu_turno_confirmado",
      to: "0981 123 456",
      variables: CONFIRMED_VARS,
      buttons: [URL_BTN(0, "bella/turno/abc123")],
      dedupKey: key("commit"),
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { id } = (await res.json()) as { id: number };

    const row = await waitForFinalStatus(request, tenantToken, id);
    expect(row.status).toBe("SENT");
    expect(row.wamid).toMatch(/^wamid\./);

    const sent = await sentMessages(request, tenantToken);
    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe("pelu_turno_confirmado");
    expect(sent[0].buttons).toEqual([URL_BTN(0, "bella/turno/abc123")]);
    expect(sent[0].wamid).toBe(row.wamid);
  });

  test("AC3: si la transacción que origina el mensaje se revierte, no hay mensaje ni envío", async ({
    request,
  }) => {
    const before = (await messageLog(request, tenantToken)).length;
    const res = await enqueueMessage(request, tenantToken, {
      template: "pelu_turno_confirmado",
      to: "0981123456",
      variables: CONFIRMED_VARS,
      buttons: [URL_BTN(0, "bella/turno/abc123")],
      dedupKey: key("rollback"),
      rollback: true,
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    expect(((await res.json()) as { rolledBack: boolean }).rolledBack).toBe(true);

    await new Promise((r) => setTimeout(r, 1500));
    expect((await messageLog(request, tenantToken)).length).toBe(before);
    expect(await sentMessages(request, tenantToken)).toHaveLength(0);
  });

  test("AC3: un mismo evento se envía una sola vez aunque se encole varias", async ({ request }) => {
    const dedupKey = key("dedup");
    const body = {
      template: "pelu_turno_cancelado",
      to: "0981123456",
      variables: ["María", "Salón Bella", "Corte", "viernes 28/11"],
      buttons: [URL_BTN(0, "bella")],
      dedupKey,
    };
    const first = await enqueueMessage(request, tenantToken, body);
    const second = await enqueueMessage(request, tenantToken, body);
    const third = await enqueueMessage(request, tenantToken, body);
    const ids = await Promise.all(
      [first, second, third].map(async (r) => ((await r.json()) as { id: number }).id),
    );
    expect(new Set(ids).size).toBe(1);

    await waitForFinalStatus(request, tenantToken, ids[0]);
    expect(await sentMessages(request, tenantToken)).toHaveLength(1);
  });

  test("AC3: un envío que falla queda FAILED con su código tipificado y no se pierde en silencio", async ({
    request,
  }) => {
    await failNext(request, tenantToken, "INVALID_RECIPIENT");
    const res = await enqueueMessage(request, tenantToken, {
      template: "pelu_turno_confirmado",
      to: "0981123456",
      variables: CONFIRMED_VARS,
      buttons: [URL_BTN(0, "bella/turno/abc123")],
      dedupKey: key("fail"),
    });
    const { id } = (await res.json()) as { id: number };

    const row = await waitForFinalStatus(request, tenantToken, id);
    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toBe("INVALID_RECIPIENT");
    expect(await sentMessages(request, tenantToken)).toHaveLength(0);
  });

  test("AC3: el código de verificación se envía de forma síncrona, con el código en el cuerpo y en el botón", async ({
    request,
  }) => {
    const res = await sendCode(request, tenantToken, "0981 123 456", "482915");
    expect(res.ok(), await res.text()).toBeTruthy();
    const { wamid } = (await res.json()) as { wamid: string };

    const sent = await sentMessages(request, tenantToken);
    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe("pelu_codigo_verificacion");
    expect(sent[0].bodyParameters).toEqual(["482915"]);
    expect(sent[0].buttons).toEqual([URL_BTN(0, "482915")]);
    expect(sent[0].wamid).toBe(wamid);

    const log = (await messageLog(request, tenantToken)).filter((m) => m.purpose === "OTP");
    expect(log.at(-1)).toMatchObject({ status: "SENT", wamid });
  });

  test("AC3: si el código no se puede enviar, la respuesta lo dice con su categoría y no se reintenta", async ({
    request,
  }) => {
    await failNext(request, tenantToken, "TRANSIENT");
    const res = await sendCode(request, tenantToken, "0981123456", "111222");
    expect(res.status()).toBe(409);
    expect(await res.text()).toContain("WHATSAPP_TRANSIENT");

    expect(await sentMessages(request, tenantToken)).toHaveLength(0);
    const otp = (await messageLog(request, tenantToken)).filter((m) => m.purpose === "OTP");
    expect(otp.at(-1)).toMatchObject({ status: "FAILED", errorCode: "TRANSIENT" });
  });

  const phones: Array<[string, string]> = [
    ["0981123456", "+595981123456"],
    ["981123456", "+595981123456"],
    ["+595981123456", "+595981123456"],
    ["595981123456", "+595981123456"],
    ["(0981) 123-456", "+595981123456"],
  ];
  for (const [typed, expected] of phones) {
    test(`AC4: el celular «${typed}» se envía como ${expected}`, async ({ request }) => {
      const res = await sendCode(request, tenantToken, typed, "123456");
      expect(res.ok(), await res.text()).toBeTruthy();
      const sent = await sentMessages(request, tenantToken);
      expect(sent.at(-1)?.to).toBe(expected);
    });
  }

  for (const typed of ["021123456", "09811234", "098112345678", "abc"]) {
    test(`AC4: el número «${typed}» se rechaza y no se envía nada`, async ({ request }) => {
      const res = await sendCode(request, tenantToken, typed, "123456");
      expect(res.status()).toBe(400);
      expect(await res.text()).toContain("WHATSAPP_INVALID_RECIPIENT");
      expect(await sentMessages(request, tenantToken)).toHaveLength(0);
    });
  }

  for (const flag of [WHATSAPP_FLAG, BOOKING_FLAG]) {
    test(`AC8: con ${flag} apagado para el salón el mensaje no sale (canal no disponible)`, async ({
      request,
    }) => {
      await setTenantFeatureFlag(request, TENANT_ID, flag, false);
      try {
        const res = await enqueueMessage(request, tenantToken, {
          template: "pelu_turno_confirmado",
          to: "0981123456",
          variables: CONFIRMED_VARS,
          buttons: [URL_BTN(0, "bella/turno/abc123")],
          dedupKey: key(`flag-${flag}`),
        });
        const { id } = (await res.json()) as { id: number };
        const row = await waitForFinalStatus(request, tenantToken, id);
        expect(row.status).toBe("FAILED");
        expect(row.errorCode).toBe("CHANNEL_UNAVAILABLE");

        const code = await sendCode(request, tenantToken, "0981123456", "123456");
        expect(code.status()).toBe(409);
        expect(await code.text()).toContain("WHATSAPP_CHANNEL_UNAVAILABLE");
        expect(await sentMessages(request, tenantToken)).toHaveLength(0);
      } finally {
        await setTenantFeatureFlag(request, TENANT_ID, flag, true);
      }
    });
  }

  test("AC8: con el flag global WHATSAPP_REMINDERS apagado el canal no está disponible", async ({
    request,
  }) => {
    await restoreWhatsAppFlags(request);
    try {
      const res = await sendCode(request, tenantToken, "0981123456", "123456");
      expect(res.status()).toBe(409);
      expect(await res.text()).toContain("WHATSAPP_CHANNEL_UNAVAILABLE");
    } finally {
      await enableWhatsAppFlags(request);
    }
  });

  test("Los datos de la plataforma son solo de la plataforma: un administrador de salón recibe 403", async ({
    request,
  }) => {
    for (const path of ["/api/platform/whatsapp/status"]) {
      const res = await request.get(`${API_BASE}${path}`, { headers: authHeaders(tenantToken) });
      expect(res.status()).toBe(403);
    }
    const send = await request.post(`${API_BASE}/api/platform/whatsapp/test-send`, {
      headers: authHeaders(tenantToken),
      data: { to: "0981123456", template: "pelu_turno_cancelado" },
    });
    expect(send.status()).toBe(403);
    const anon = await request.get(`${API_BASE}/api/platform/whatsapp/status`);
    expect([401, 403]).toContain(anon.status());
  });

  test("La pantalla de plataforma informa el estado del canal sin mostrar ningún secreto", async ({
    page,
    request,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/whatsapp");

    await expect(page.getByTestId("whatsapp-switch")).toHaveText("On");
    await expect(page.getByTestId("whatsapp-provider")).toHaveText("Simulated (testing only)");
    await expect(page.getByTestId("whatsapp-operational")).toHaveText("Yes");
    await expect(page.getByTestId("whatsapp-config-problems")).toHaveCount(0);

    const status = await request.get(`${API_BASE}/api/platform/whatsapp/status`, {
      headers: authHeaders(platformToken),
    });
    const text = await status.text();
    expect(text).not.toContain("e2e-whatsapp-app-secret");
    expect(text).not.toContain("e2e-whatsapp-verify-token");
  });
});
