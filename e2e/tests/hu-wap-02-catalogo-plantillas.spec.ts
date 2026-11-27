import { expect, test } from "@playwright/test";

import { API_BASE, authHeaders, loginAsDemoApi, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";
import {
  TEMPLATE_NAMES,
  WEBHOOK_URL,
  WHATSAPP_VERIFY_TOKEN,
  enableWhatsAppFlags,
  enqueueMessage,
  postWebhook,
  refreshTemplatesApi,
  restoreCatalog,
  restoreWhatsAppFlags,
  sentMessages,
  setFakeTemplateStatus,
  templateStatusEvent,
  waitForFinalStatus,
  whatsAppSignature,
} from "../fixtures/whatsapp";

// HU-WAP-02 · Catálogo de plantillas y su aprobación en Meta
// requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md
// requirements/user_stories/Plantillas_WhatsApp_para_Meta.md
//
// Cobertura por criterio:
//  1 catálogo versionado ............ las 7 plantillas con categoría, variables y botones (pantalla)
//  2 estado visible / no se usa ..... estado de Meta en pantalla; una plantilla no aprobada no sale
//  3 avisos de Meta ................. webhook firmado: pausa, rechazo, recuperación y alertas
//  4 variables saneadas ............. sin saltos de línea, tabulaciones ni espacios repetidos; largo máximo
//  5 texto estrictamente transaccional  textos del catálogo sin promociones
//  6 pie obligatorio ................ lo verifica WhatsAppTemplateTest (JUnit) contra el documento de Meta
//  (el nombre de pila a partir del nombre completo lo cubre WhatsAppTemplateVariablesTest, JUnit)

test.describe.configure({ mode: "serial" });

const TENANT_ID = 1;
void TENANT_ID;

const EXPECTED: Record<string, { category: string; variables: string; buttons: string }> = {
  pelu_codigo_verificacion: { category: "Authentication", variables: "1", buttons: "1" },
  pelu_turno_confirmado: { category: "Utility", variables: "6", buttons: "1" },
  pelu_turno_pendiente: { category: "Utility", variables: "5", buttons: "1" },
  pelu_turno_no_disponible: { category: "Utility", variables: "4", buttons: "1" },
  pelu_propuesta_horario: { category: "Utility", variables: "4", buttons: "1" },
  pelu_recordatorio_turno: { category: "Utility", variables: "5", buttons: "3" },
  pelu_turno_cancelado: { category: "Utility", variables: "4", buttons: "1" },
};

let n = 0;
const key = (label: string) => `e2e-${label}-${Date.now()}-${++n}`;

test.describe("HU-WAP-02 · Catálogo de plantillas y su aprobación en Meta", () => {
  let platformToken: string;
  let tenantToken: string;

  test.beforeAll(async ({ request }) => {
    await enableWhatsAppFlags(request);
    platformToken = await loginPlatformAdminApi(request);
    tenantToken = await loginAsDemoApi(request);
  });

  test.beforeEach(async ({ request }) => {
    await restoreCatalog(request);
  });

  test.afterAll(async ({ request }) => {
    await restoreCatalog(request);
    await restoreWhatsAppFlags(request);
  });

  async function openCatalog(page: import("@playwright/test").Page) {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/whatsapp");
    await expect(page.getByTestId("whatsapp-templates")).toBeVisible();
  }

  test("AC1: la pantalla lista las siete plantillas con su categoría, variables y botones", async ({
    page,
  }) => {
    await openCatalog(page);

    for (const name of TEMPLATE_NAMES) {
      const row = page.getByTestId(`whatsapp-template-${name}`);
      await expect(row, name).toBeVisible();
      const cells = row.locator("td");
      await expect(cells.nth(1)).toHaveText(EXPECTED[name].category);
      await expect(cells.nth(2)).toHaveText(EXPECTED[name].variables);
      await expect(cells.nth(3)).toHaveText(EXPECTED[name].buttons);
    }
    await expect(page.locator('[data-testid^="whatsapp-template-pelu_"]')).toHaveCount(7);
  });

  test("AC2: tras consultar a Meta, cada plantilla aprobada se ve como «Approved»", async ({
    page,
  }) => {
    await openCatalog(page);
    await page.getByTestId("whatsapp-refresh").click();

    for (const name of TEMPLATE_NAMES) {
      await expect(page.getByTestId(`whatsapp-template-status-${name}`), name).toHaveText("Approved");
    }
    await expect(page.getByTestId("whatsapp-no-alerts")).toBeVisible();
  });

  test("AC2: una plantilla pausada por Meta se ve con su motivo, genera alerta y no se usa", async ({
    page,
    request,
  }) => {
    await setFakeTemplateStatus(request, tenantToken, "pelu_turno_cancelado", "PAUSED", "LOW_QUALITY");
    await openCatalog(page);
    await page.getByTestId("whatsapp-refresh").click();

    const status = page.getByTestId("whatsapp-template-status-pelu_turno_cancelado");
    await expect(status).toHaveText("Paused");
    await expect(page.getByTestId("whatsapp-template-pelu_turno_cancelado")).toContainText("LOW_QUALITY");
    await expect(page.getByTestId("whatsapp-template-status-pelu_turno_confirmado")).toHaveText("Approved");
    await expect(page.getByTestId("whatsapp-alerts")).toContainText("Template paused");
    await expect(page.getByTestId("whatsapp-alerts")).toContainText("pelu_turno_cancelado");

    // The test send of that template is refused and nothing reaches the provider.
    await page.getByLabel("Template", { exact: true }).selectOption("pelu_turno_cancelado");
    await page.getByLabel("Destination phone").fill("0981 123 456");
    await page.getByTestId("whatsapp-test-send").click();
    await expect(page.getByTestId("whatsapp-test-error")).toContainText("not approved by Meta");
    expect(await sentMessages(request, tenantToken)).toHaveLength(0);
  });

  test("AC2: un mensaje de una plantilla no aprobada no se envía (cae a FAILED / TEMPLATE_UNAVAILABLE)", async ({
    request,
  }) => {
    await setFakeTemplateStatus(request, tenantToken, "pelu_turno_confirmado", "REJECTED", "INCORRECT_CATEGORY");
    await refreshTemplatesApi(request);

    const res = await enqueueMessage(request, tenantToken, {
      template: "pelu_turno_confirmado",
      to: "0981123456",
      variables: ["María", "Salón Bella", "Corte", "viernes 28/11", "15:30", "Laura"],
      buttons: [{ kind: "URL", index: 0, value: "bella/turno/abc123" }],
      dedupKey: key("rejected"),
    });
    const { id } = (await res.json()) as { id: number };
    const row = await waitForFinalStatus(request, tenantToken, id);

    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toBe("TEMPLATE_UNAVAILABLE");
    expect(await sentMessages(request, tenantToken)).toHaveLength(0);
  });

  test("AC3: Meta avisa por el webhook firmado que una plantilla fue rechazada y la pantalla lo refleja", async ({
    page,
    request,
  }) => {
    await refreshTemplatesApi(request);
    const res = await postWebhook(
      request,
      templateStatusEvent("pelu_turno_pendiente", "REJECTED", "INVALID_FORMAT"),
    );
    expect(res.status()).toBe(200);

    await openCatalog(page);
    await expect(page.getByTestId("whatsapp-template-status-pelu_turno_pendiente")).toHaveText("Rejected");
    await expect(page.getByTestId("whatsapp-alerts")).toContainText("Template rejected");
    await expect(page.getByTestId("whatsapp-alerts")).toContainText("pelu_turno_pendiente");
  });

  test("AC3: una plantilla que Meta vuelve a aprobar cierra su alerta", async ({ page, request }) => {
    await refreshTemplatesApi(request);
    await postWebhook(request, templateStatusEvent("pelu_recordatorio_turno", "PAUSED"));
    await openCatalog(page);
    await expect(page.getByTestId("whatsapp-template-status-pelu_recordatorio_turno")).toHaveText("Paused");
    await expect(page.getByTestId("whatsapp-alerts")).toContainText("pelu_recordatorio_turno");

    const res = await postWebhook(request, templateStatusEvent("pelu_recordatorio_turno", "APPROVED"));
    expect(res.status()).toBe(200);
    await page.reload();

    await expect(page.getByTestId("whatsapp-template-status-pelu_recordatorio_turno")).toHaveText("Approved");
    await expect(page.getByTestId("whatsapp-no-alerts")).toBeVisible();
  });

  test("AC3: una alerta se puede descartar desde la pantalla", async ({ page, request }) => {
    await refreshTemplatesApi(request);
    await postWebhook(request, templateStatusEvent("pelu_propuesta_horario", "DISABLED"));
    await openCatalog(page);

    const alerts = page.getByTestId("whatsapp-alerts");
    await expect(alerts).toContainText("Template disabled");
    await alerts.getByRole("button", { name: "Dismiss alert" }).click();

    await expect(page.getByTestId("whatsapp-no-alerts")).toBeVisible();
  });

  test("AC3: el webhook rechaza lo que no viene firmado por Meta y no cambia nada", async ({
    request,
  }) => {
    await refreshTemplatesApi(request);
    const event = templateStatusEvent("pelu_turno_confirmado", "REJECTED");
    const raw = JSON.stringify(event);

    const withoutSignature = await postWebhook(request, raw, null);
    const wrongSecret = await postWebhook(request, raw, whatsAppSignature(raw, "someone-elses-secret"));
    const otherBody = await postWebhook(request, raw, whatsAppSignature(JSON.stringify({ other: 1 })));
    const badPrefix = await postWebhook(request, raw, whatsAppSignature(raw).replace("sha256=", "sha1="));
    for (const r of [withoutSignature, wrongSecret, otherBody, badPrefix]) {
      expect(r.status()).toBe(403);
    }

    const after = await refreshTemplatesApi(request);
    expect(after.templates.find((t) => t.name === "pelu_turno_confirmado")?.status).toBe("APPROVED");
    expect(after.alerts).toHaveLength(0);
  });

  test("AC3: el webhook acepta una notificación firmada aunque no le interese (siempre 200)", async ({
    request,
  }) => {
    const unrelated = await postWebhook(request, {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ status: "delivered" }] } }] }],
    });
    expect(unrelated.status()).toBe(200);

    const garbage = await postWebhook(request, "this is not json");
    expect(garbage.status()).toBe(200);

    const someoneElses = await postWebhook(
      request,
      templateStatusEvent("a_template_of_another_app", "REJECTED"),
    );
    expect(someoneElses.status()).toBe(200);
    expect((await refreshTemplatesApi(request)).alerts).toHaveLength(0);
  });

  test("AC3: la verificación del webhook responde el desafío solo con el token correcto", async ({
    request,
  }) => {
    const ok = await request.get(
      `${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=${WHATSAPP_VERIFY_TOKEN}&hub.challenge=abc123`,
    );
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toBe("abc123");

    for (const q of [
      "hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123",
      "hub.mode=subscribe&hub.challenge=abc123",
      `hub.mode=unsubscribe&hub.verify_token=${WHATSAPP_VERIFY_TOKEN}&hub.challenge=abc123`,
    ]) {
      expect((await request.get(`${WEBHOOK_URL}?${q}`)).status()).toBe(403);
    }
  });

  test("AC4: las variables se limpian antes de enviar (sin saltos de línea, tabulaciones ni espacios repetidos)", async ({
    request,
  }) => {
    const long = "x".repeat(200);
    const res = await enqueueMessage(request, tenantToken, {
      template: "pelu_turno_confirmado",
      to: "0981123456",
      variables: ["  Ana\n", "Salón\tBella   Centro", "Corte\r\ny   brushing", "viernes\n28/11", "15:30", long],
      buttons: [{ kind: "URL", index: 0, value: "bella/turno/abc123" }],
      dedupKey: key("sanitize"),
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { id } = (await res.json()) as { id: number };
    await waitForFinalStatus(request, tenantToken, id);

    const sent = (await sentMessages(request, tenantToken)).at(-1);
    expect(sent?.bodyParameters.slice(0, 5)).toEqual([
      "Ana",
      "Salón Bella Centro",
      "Corte y brushing",
      "viernes 28/11",
      "15:30",
    ]);
    expect(sent?.bodyParameters[5]).toHaveLength(60);
    for (const p of sent?.bodyParameters ?? []) {
      expect(p).not.toMatch(/[\n\r\t]| {2,}/);
    }
  });

  test("AC4: una cantidad de variables distinta de la plantilla, o una variable vacía, se rechaza y no se envía", async ({
    request,
  }) => {
    const base = {
      template: "pelu_turno_cancelado",
      to: "0981123456",
      buttons: [{ kind: "URL" as const, index: 0, value: "bella" }],
    };
    const tooFew = await enqueueMessage(request, tenantToken, {
      ...base,
      variables: ["Ana", "Salón"],
      dedupKey: key("few"),
    });
    const empty = await enqueueMessage(request, tenantToken, {
      ...base,
      variables: ["Ana", "   ", "Corte", "viernes"],
      dedupKey: key("empty"),
    });
    const noLink = await enqueueMessage(request, tenantToken, {
      ...base,
      buttons: [],
      variables: ["Ana", "Salón", "Corte", "viernes"],
      dedupKey: key("nolink"),
    });
    for (const r of [tooFew, empty, noLink]) {
      expect(r.status()).toBe(400);
      expect(await r.text()).toContain("WHATSAPP_INVALID_REQUEST");
    }
    expect(await sentMessages(request, tenantToken)).toHaveLength(0);
  });

  test("AC5: los textos del catálogo son transaccionales (sin promociones ni descuentos)", async ({
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/platform/whatsapp/status`, {
      headers: authHeaders(platformToken),
    });
    const { templates } = (await res.json()) as {
      templates: Array<{ name: string; bodyText: string | null; bodyVariables: number }>;
    };
    expect(templates).toHaveLength(7);
    for (const t of templates) {
      if (t.bodyText === null) {
        expect(t.name).toBe("pelu_codigo_verificacion"); // Meta writes the authentication body
        continue;
      }
      expect(t.bodyText.toLowerCase(), t.name).not.toMatch(/descuento|promo|oferta|gratis|%/);
      expect(t.bodyText, t.name).not.toMatch(/^\{\{|\}\}$/);
      expect((t.bodyText.match(/\{\{\d+\}\}/g) ?? []).length, t.name).toBe(t.bodyVariables);
    }
    expect(templates.find((t) => t.name === "pelu_turno_confirmado")?.bodyText).toBe(
      "Hola {{1}}, tu turno en {{2}} está confirmado: {{3}}, el {{4}} a las {{5}} con {{6}}. Podés verlo o cambiarlo con el botón de abajo.",
    );
  });
});
