import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { API_BASE, apiPostJson, authHeaders } from "./api";
import { setGlobalFlag } from "./commissions";

/**
 * Conversational assistant (requirements/asistente/plan_asistente.md, HU-AST-*). The e2e/mt
 * backends run the scripted model (app.femme.assistant.model=fake): it answers by PATTERNS in the
 * text — "appointments <date|today|tomorrow>", "appointments of <name>", "search <text>",
 * "services", "professionals", "model fails" — and trickles the answer out when the text contains
 * "slowly". English keywords are used here because Playwright forces the UI language to English;
 * the model's answers are always Spanish.
 */
export const ASSISTANT_FLAG = "ASSISTANT_CHATBOT";

// The effective flag is global AND tier AND tenant (HU-47) and it is born OFF globally, so a spec
// switches it on globally and puts it back afterwards.
export const enableAssistantGlobally = (request: APIRequestContext) =>
  setGlobalFlag(request, ASSISTANT_FLAG, true);
export const restoreAssistantGlobal = (request: APIRequestContext) =>
  setGlobalFlag(request, ASSISTANT_FLAG, false);

// ── SSE over the API ─────────────────────────────────────────────────────────────────────────────

export type SseEvent = { event: string; data: Record<string, unknown> };

export function parseSse(body: string): SseEvent[] {
  return body
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5));
      }
      return { event, data: JSON.parse(data.join("\n")) as Record<string, unknown> };
    });
}

export type AssistantConversationDto = {
  conversationId: number;
  messages: Array<{ id: number; role: "USER" | "ASSISTANT"; content: string }>;
};

export async function currentConversationApi(
  request: APIRequestContext,
  token: string,
): Promise<AssistantConversationDto> {
  const res = await request.get(`${API_BASE}/api/assistant/conversations/current`, {
    headers: authHeaders(token),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as AssistantConversationDto;
}

export type AssistantAnswer = {
  status: number;
  raw: string;
  events: SseEvent[];
  /** The assistant's text: every message.delta joined. */
  text: string;
};

export async function askAssistantApi(
  request: APIRequestContext,
  token: string,
  conversationId: number,
  text: string,
  currentPage = "hoy",
): Promise<AssistantAnswer> {
  const res = await request.post(`${API_BASE}/api/assistant/messages`, {
    headers: { ...authHeaders(token), Accept: "text/event-stream" },
    data: { conversationId, text, inputMode: "TEXT", currentPage },
  });
  const raw = await res.text();
  const events = res.status() === 200 ? parseSse(raw) : [];
  const answer = events
    .filter((e) => e.event === "message.delta")
    .map((e) => String(e.data.text))
    .join("");
  return { status: res.status(), raw, events, text: answer };
}

// ── Appointments on a day the assistant can be asked about ───────────────────────────────────────

/** `YYYY-MM-DD` of an instant in the salon's business zone (the backend resolves days there). */
export function businessDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Books an appointment tomorrow (business zone) in a random five-minute slot around 15:00 UTC —
 * midday in Paraguay whatever the DST rules — retrying when the slot is taken, and returns the day
 * to ask the assistant about.
 */
export async function bookAppointmentTomorrow(
  request: APIRequestContext,
  token: string,
  body: { clientId: number; professionalId: number; serviceId: number },
): Promise<{ appointmentId: number; date: string }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    // "Tomorrow" is the business zone's tomorrow, not UTC's: late in the evening they differ.
    const [y, m, d] = businessDate(new Date()).split("-").map(Number);
    const start = new Date(
      Date.UTC(y, m - 1, d + 1, 13 + Math.floor(Math.random() * 5), Math.floor(Math.random() * 12) * 5),
    );
    const res = await request.post(`${API_BASE}/api/appointments`, {
      headers: authHeaders(token),
      data: { ...body, startAt: start.toISOString() },
    });
    if (res.status() === 409) continue;
    expect(res.ok(), await res.text()).toBeTruthy();
    const created = (await res.json()) as { id: number };
    return { appointmentId: created.id, date: businessDate(start) };
  }
  throw new Error("no free slot found for the assistant appointment");
}

export async function createClientWithPhone(
  request: APIRequestContext,
  token: string,
  fullName: string,
): Promise<{ id: number; phone: string; fullName: string }> {
  const phone = `09${String(Date.now()).slice(-8)}`;
  const created = await apiPostJson<{ id: number; fullName: string; phone: string }>(
    request,
    token,
    "/api/clients",
    { fullName, phone, email: null, ruc: null },
  );
  return { id: created.id, phone: created.phone ?? phone, fullName: created.fullName };
}

// ── UI ───────────────────────────────────────────────────────────────────────────────────────────

export const assistantPanel = (page: Page) => page.getByTestId("assistant-panel");

export async function openAssistantPanel(page: Page) {
  await page.getByTestId("topbar-assistant").click();
  await expect(assistantPanel(page)).toBeVisible();
}

/** Types in the assistant's message box and presses Enter. */
export async function askAssistantUi(page: Page, text: string) {
  const input = page.getByTestId("assistant-input");
  await input.fill(text);
  await input.press("Enter");
}

export const assistantBubbles = (page: Page) => page.getByTestId("assistant-message");
export const assistantAnswers = (page: Page) =>
  page.locator('[data-testid="assistant-message"][data-role="ASSISTANT"]');
export const userBubbles = (page: Page) =>
  page.locator('[data-testid="assistant-message"][data-role="USER"]');

/** «Nueva conversación»: waits until the new (empty) conversation exists, so the next message goes to it. */
export async function startNewConversationUi(page: Page) {
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/assistant/conversations") && r.request().method() === "POST",
  );
  await page.getByTestId("assistant-new-conversation").click();
  await created;
  await expect(assistantBubbles(page)).toHaveCount(0);
  await expect(page.getByTestId("assistant-welcome")).toBeVisible();
}
