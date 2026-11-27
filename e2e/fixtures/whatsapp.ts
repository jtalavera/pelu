import { createHmac } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";

import {
  API_BASE,
  apiPostJson,
  authHeaders,
  loginAsDemoApi,
  loginPlatformAdminApi,
} from "./api";
import { setGlobalFlag } from "./commissions";

/**
 * WhatsApp channel (requirements/user_stories/Especificacion_Reserva_Online_y_Ficha_Tecnica.md,
 * Épica C). The e2e backends run the FAKE provider (app.femme.whatsapp.provider=fake): nothing
 * leaves the process. `WhatsAppTestSupportController` lets a spec read what the fake "sent", make
 * the next sends fail, set a template's approval status and trigger the queued / synchronous
 * send modes for the caller's salon. The webhook secrets below mirror application-e2e.properties.
 *
 * The support endpoints are called with a SALON admin token (never the platform admin's: a
 * tenant-less token is only accepted on the /api/platform and /api/auth prefixes).
 */
export const WHATSAPP_FLAG = "WHATSAPP_REMINDERS";
export const BOOKING_FLAG = "ONLINE_BOOKING";
export const WHATSAPP_APP_SECRET = "e2e-whatsapp-app-secret";
export const WHATSAPP_VERIFY_TOKEN = "e2e-whatsapp-verify-token";
export const WEBHOOK_URL = `${API_BASE}/api/whatsapp/webhook`;
const SUPPORT = `${API_BASE}/api/admin/whatsapp-test-support`;

export const TEMPLATE_NAMES = [
  "pelu_codigo_verificacion",
  "pelu_turno_confirmado",
  "pelu_turno_pendiente",
  "pelu_turno_no_disponible",
  "pelu_propuesta_horario",
  "pelu_recordatorio_turno",
  "pelu_turno_cancelado",
] as const;

export type FakeSentMessage = {
  wamid: string;
  to: string;
  template: string;
  language: string;
  bodyParameters: string[];
  buttons: Array<{ kind: "URL" | "QUICK_REPLY"; index: number; value: string }>;
};

export type WhatsAppLogRow = {
  id: number;
  purpose: string;
  template: string;
  status: string;
  errorCode: string;
  wamid: string;
  attempts: number;
  recipient: string;
  fallbackEmailSent: boolean;
  fallbackEmail: string;
  nextAttemptAt: string;
  masked: boolean;
  payload: string;
};

export type FakeSentEmail = { to: string; subject: string; body: string; at: string };

// The effective flag is global AND tier AND tenant and both are born OFF globally.
export async function enableWhatsAppFlags(request: APIRequestContext) {
  await setGlobalFlag(request, BOOKING_FLAG, true);
  await setGlobalFlag(request, WHATSAPP_FLAG, true);
}
export async function restoreWhatsAppFlags(request: APIRequestContext) {
  await setGlobalFlag(request, WHATSAPP_FLAG, false);
  await setGlobalFlag(request, BOOKING_FLAG, false);
}

export async function sentMessages(
  request: APIRequestContext,
  token: string,
): Promise<FakeSentMessage[]> {
  const res = await request.get(`${SUPPORT}/sent`, { headers: authHeaders(token) });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as FakeSentMessage[];
}

/** Forgets the fake's sent messages, pending failures and template-status overrides. */
export async function resetFake(request: APIRequestContext, token: string) {
  // Everything the fake keeps: sent messages and emails, opt-outs and unreachable numbers.
  const res = await request.delete(`${SUPPORT}/state`, { headers: authHeaders(token) });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function failNext(
  request: APIRequestContext,
  token: string,
  code: string,
  count = 1,
) {
  const res = await request.post(`${SUPPORT}/fail-next`, {
    headers: authHeaders(token),
    data: { code, count },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function setFakeTemplateStatus(
  request: APIRequestContext,
  token: string,
  name: string,
  status: string,
  reason: string | null = null,
) {
  const res = await request.post(`${SUPPORT}/templates/${name}/status`, {
    headers: authHeaders(token),
    data: { status, reason },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export type EnqueueBody = {
  template: string;
  to: string;
  variables: string[];
  buttons: Array<{ kind: "URL" | "QUICK_REPLY"; index: number; value: string }>;
  dedupKey: string;
  rollback?: boolean;
  /** Where the one-time email fallback goes if WhatsApp fails (HU-WAP-07). */
  fallbackEmail?: string;
  clientId?: number;
  appointmentId?: number;
  purpose?: "BOOKING" | "REMINDER";
};

/** Queues a message for the caller's salon inside a transaction (the "appointment created" stand-in). */
export async function enqueueMessage(request: APIRequestContext, token: string, body: EnqueueBody) {
  return request.post(`${SUPPORT}/enqueue`, { headers: authHeaders(token), data: body });
}

export async function sendCode(
  request: APIRequestContext,
  token: string,
  to: string,
  code: string,
) {
  return request.post(`${SUPPORT}/send-code`, { headers: authHeaders(token), data: { to, code } });
}

export async function messageLog(
  request: APIRequestContext,
  tenantToken: string,
): Promise<WhatsAppLogRow[]> {
  const res = await request.get(`${SUPPORT}/log`, { headers: authHeaders(tenantToken) });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as WhatsAppLogRow[];
}

/** Waits until the queued message with this id reached a final status, and returns its row. */
export async function waitForFinalStatus(
  request: APIRequestContext,
  tenantToken: string,
  id: number,
): Promise<WhatsAppLogRow> {
  let row: WhatsAppLogRow | undefined;
  await expect
    .poll(
      async () => {
        row = (await messageLog(request, tenantToken)).find((m) => m.id === id);
        return row?.status;
      },
      { timeout: 15_000 },
    )
    .toMatch(/^(SENT|FAILED|CANCELLED)$/);
  return row as WhatsAppLogRow;
}

export function whatsAppSignature(rawBody: string, secret = WHATSAPP_APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/** POSTs a notification to Meta's webhook, signed like Meta does (or with the given override). */
export async function postWebhook(
  request: APIRequestContext,
  payload: unknown,
  signature?: string | null,
) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== null) {
    headers["X-Hub-Signature-256"] = signature ?? whatsAppSignature(raw);
  }
  return request.post(WEBHOOK_URL, { headers, data: Buffer.from(raw, "utf8") });
}

export function templateStatusEvent(name: string, event: string, reason = "NONE") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "message_template_status_update",
            value: {
              event,
              message_template_name: name,
              message_template_language: "es",
              reason,
            },
          },
        ],
      },
    ],
  };
}

export async function refreshTemplatesApi(request: APIRequestContext) {
  const token = await loginPlatformAdminApi(request);
  const res = await request.post(`${API_BASE}/api/platform/whatsapp/templates/refresh`, {
    headers: authHeaders(token),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as {
    templates: Array<{ name: string; status: string; reason: string | null }>;
    alerts: Array<{ id: number; category: string; subject: string }>;
  };
}

/** Back to a clean slate: every template APPROVED again and no alert about the catalog. */
export async function restoreCatalog(request: APIRequestContext) {
  await resetFake(request, await loginAsDemoApi(request));
  await refreshTemplatesApi(request);
}

// ── HU-WAP-03 / HU-WAP-07 ─────────────────────────────────────────────────────────────────────

export async function sentEmails(request: APIRequestContext, token: string): Promise<FakeSentEmail[]> {
  const res = await request.get(`${SUPPORT}/emails`, { headers: authHeaders(token) });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as FakeSentEmail[];
}

export async function failNextEmail(request: APIRequestContext, token: string, count = 1) {
  const res = await request.post(`${SUPPORT}/emails/fail-next?count=${count}`, {
    headers: authHeaders(token),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** A phone asked to stop receiving notices (platform-wide), as a BAJA reply will do from HU-WAP-06. */
export async function optOutPhone(request: APIRequestContext, token: string, phone: string) {
  const res = await request.post(`${SUPPORT}/opt-outs`, {
    headers: authHeaders(token),
    data: { phone },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Makes the waiting retries of the caller's salon due now and runs the sweep. */
export async function expediteRetries(request: APIRequestContext, token: string) {
  const res = await request.post(`${SUPPORT}/expedite`, { headers: authHeaders(token) });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function ageMessages(request: APIRequestContext, token: string, days: number) {
  const res = await request.post(`${SUPPORT}/age-messages?days=${days}`, {
    headers: authHeaders(token),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function runRetention(request: APIRequestContext, token: string) {
  const res = await request.post(`${SUPPORT}/retention`, { headers: authHeaders(token) });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function genericClientId(request: APIRequestContext, token: string): Promise<number> {
  const res = await request.get(`${SUPPORT}/generic-client`, { headers: authHeaders(token) });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { id: number }).id;
}

export type ClientDto = {
  id: number;
  fullName: string;
  phone: string | null;
  active: boolean;
  whatsappOptIn: boolean;
  whatsappOptInAt: string | null;
  whatsappOptInSource: string | null;
};

export async function createClientApi(
  request: APIRequestContext,
  token: string,
  fullName: string,
  phone: string | null,
): Promise<ClientDto> {
  return apiPostJson<ClientDto>(request, token, "/api/clients", {
    fullName,
    phone,
    email: null,
    ruc: null,
  });
}

export async function setConsentApi(
  request: APIRequestContext,
  token: string,
  clientId: number,
  optIn: boolean,
) {
  return request.put(`${API_BASE}/api/clients/${clientId}/whatsapp-consent`, {
    headers: authHeaders(token),
    data: { optIn },
  });
}

export async function getClientApi(
  request: APIRequestContext,
  token: string,
  clientId: number,
): Promise<ClientDto> {
  const res = await request.get(`${API_BASE}/api/clients/${clientId}`, {
    headers: authHeaders(token),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as ClientDto;
}

/** A Meta delivery status notification for a message we sent (statuses[] of the "messages" field). */
export function messageStatusEvent(wamid: string, status: string, errorCode?: number) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              statuses: [
                {
                  id: wamid,
                  status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: "595981123456",
                  ...(errorCode ? { errors: [{ code: errorCode, title: "x" }] } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export const CONFIRMED_VARS = ["María", "Salón Bella", "Corte", "viernes 28/11", "15:30", "Laura"];
export const CONFIRMED_LINK = { kind: "URL" as const, index: 0, value: "bella/turno/abc123" };
