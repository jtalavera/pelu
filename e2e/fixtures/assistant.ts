import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  API_BASE,
  apiPostJson,
  apiPutJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
} from "./api";
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
  messages: Array<{ id: number; role: "USER" | "ASSISTANT"; content: string; inputMode: string | null }>;
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
  // A message sent while the assistant is still answering is ignored: wait for the box to be free.
  await expect(page.getByTestId("assistant-composer")).toHaveAttribute("data-busy", "false", { timeout: 30_000 });
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
  // The app swaps its active conversation right after the response; until then a message would go
  // to the old (closed) one.
  await expect(page.getByTestId("assistant-composer")).toHaveAttribute("data-busy", "false");
  await expect(assistantBubbles(page)).toHaveCount(0);
  await expect(page.getByTestId("assistant-welcome")).toBeVisible();
}

// ── Invoice drafts (phase 2) ─────────────────────────────────────────────────────────────────────


/** What the demo salon needs to issue an invoice: an active fiscal stamp and an open cash register. */
export async function prepareInvoicing(request: APIRequestContext, token: string) {
  await ensureActiveFiscalStampForInvoices(request, token);
  await ensureCashSessionOpenApi(request, token);
}

/** An open ficha with one service line (no price: it takes the catalog's), ready to be charged. */
export async function createOpenFicha(
  request: APIRequestContext,
  token: string,
  body: { clientId: number; serviceId: number; professionalId: number },
): Promise<number> {
  const ficha = await apiPostJson<{ id: number }>(request, token, "/api/service-records", {
    clientId: body.clientId,
    lines: [
      { serviceId: body.serviceId, professionalId: body.professionalId, quantity: 1, unitPrice: null },
    ],
    tips: [],
  });
  return ficha.id;
}

export type InvoiceRow = { id: number; status: string; total: string | number };

export async function clientInvoicesApi(
  request: APIRequestContext,
  token: string,
  clientId: number,
): Promise<InvoiceRow[]> {
  const res = await request.get(`${API_BASE}/api/invoices?clientId=${clientId}&size=100`, {
    headers: authHeaders(token),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { content: InvoiceRow[] }).content;
}

export type DraftDto = {
  id: string;
  type: string;
  status: string;
  missing: string[];
  payload: { total: number; clientName: string; lines: Array<{ name: string; lineTotal: number }> };
};

/** Asks the assistant (API) and returns the draft card it produced, if any. */
export async function proposeViaApi(
  request: APIRequestContext,
  token: string,
  text: string,
): Promise<{ draft: DraftDto | null; answer: AssistantAnswer }> {
  const { conversationId } = await currentConversationApi(request, token);
  const answer = await askAssistantApi(request, token, conversationId, text);
  const card = answer.events.find((e) => e.event === "card.draft");
  return { draft: card ? (card.data as unknown as DraftDto) : null, answer };
}

export async function completeDraftApi(
  request: APIRequestContext,
  token: string,
  id: string,
  patch: Record<string, string>,
) {
  const res = await request.patch(`${API_BASE}/api/assistant/drafts/${id}`, {
    headers: authHeaders(token),
    data: patch,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export function confirmDraftApi(request: APIRequestContext, token: string, id: string) {
  return request.post(`${API_BASE}/api/assistant/drafts/${id}/confirm`, {
    headers: { ...authHeaders(token), "Idempotency-Key": id },
  });
}

/** Moves the draft's 24 h expiry into the past (e2e-only support endpoint). */
export async function expireDraftApi(request: APIRequestContext, token: string, id: string) {
  const res = await request.post(`${API_BASE}/api/admin/assistant-test-support/drafts/${id}/expire`, {
    headers: authHeaders(token),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function updateServicePriceApi(
  request: APIRequestContext,
  token: string,
  service: { id: number; name: string; categoryId: number },
  priceMinor: number,
) {
  await apiPutJson(request, token, `/api/services/${service.id}`, {
    name: service.name,
    categoryId: service.categoryId,
    priceMinor,
    durationMinutes: 60,
  });
}

// ── Agenda: availability and appointment drafts (HU-AST-05/06) ──────────────────────────────────

/** Scripted model: «availability <day> [morning|afternoon] for <service> [with <pro>]» and
 *  «book <client> for <service> <day> at HH:mm [with <pro>]». */
export type AppointmentDraftDto = {
  id: string;
  type: string;
  status: string;
  payload: {
    clientName: string;
    serviceName: string;
    professionalId: number;
    professionalName: string;
    startAt: string;
    date: string;
    time: string;
    endTime: string;
    outsideWorkingHours: boolean;
  };
};

/** The salon's tomorrow as `YYYY-MM-DD` (what «tomorrow» means to the assistant). */
export function businessTomorrow(): string {
  const [y, m, d] = businessDate(new Date()).split("-").map(Number);
  return businessDate(new Date(Date.UTC(y, m - 1, d + 1, 12)));
}

/** The instant of `HH:mm` on `date` in the salon's zone (no hard-coded UTC offset). */
export function businessInstant(date: string, hhmm: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Asuncion",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asLocal - guess));
}

/** ISO weekday (Monday=1 … Sunday=7) of a `YYYY-MM-DD`. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** 09:00–17:00 every day of the week (or every day but `except`). */
export function workingWeek(except?: number) {
  return [1, 2, 3, 4, 5, 6, 7]
    .filter((day) => day !== except)
    .map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "17:00" }));
}

/** Asks the assistant through the API and returns the appointment draft it produced, if any. */
export async function proposeAppointmentViaApi(
  request: APIRequestContext,
  token: string,
  text: string,
): Promise<{ draft: AppointmentDraftDto | null; answer: AssistantAnswer }> {
  const { conversationId } = await currentConversationApi(request, token);
  const answer = await askAssistantApi(request, token, conversationId, text);
  const card = answer.events.find((e) => e.event === "card.draft");
  return { draft: card ? (card.data as unknown as AppointmentDraftDto) : null, answer };
}

/** Labels of the tappable options (free times) the answer carried. */
export function optionLabels(answer: AssistantAnswer): string[] {
  const card = answer.events.find((e) => e.event === "card.options");
  return card ? (card.data.options as Array<{ label: string }>).map((o) => o.label) : [];
}

export const optionChips = (page: Page) => page.getByTestId("assistant-option");

export const draftCards = (page: Page) => page.getByTestId("assistant-draft-card");
export const lastDraftCard = (page: Page) => draftCards(page).last();

// ── Dictation (HU-AST-07) ────────────────────────────────────────────────────────────────────────
//
// Playwright cannot speak: the Vite build used by the e2e (VITE_PLAYWRIGHT=1) swaps Azure AI Speech
// for a simulated engine a test drives through `window.__assistantDictation`.

type Dictation = {
  listening: boolean;
  starts: number;
  prewarms: number;
  partial: (text: string) => void;
  final: (text: string) => void;
  fail: (code: string) => void;
  failNextStart: (code: string) => void;
};
type WithDictation = Window & { __assistantDictation?: Dictation };

export const micButton = (page: Page) => page.getByTestId("assistant-mic");
export const assistantInput = (page: Page) => page.getByTestId("assistant-input");
export const dictatedMarks = (page: Page) => page.getByTestId("assistant-message-dictated");

/** What the person says, while the microphone is listening (replaces the utterance in progress). */
export const speakPartial = (page: Page, text: string) =>
  page.evaluate((t) => (window as WithDictation).__assistantDictation!.partial(t), text);
/** A finished utterance. */
export const speakFinal = (page: Page, text: string) =>
  page.evaluate((t) => (window as WithDictation).__assistantDictation!.final(t), text);
/** The listening session fails. */
export const failDictation = (page: Page, code: string) =>
  page.evaluate((c) => (window as WithDictation).__assistantDictation!.fail(c), code);
/** The next attempt to start dictating fails (e.g. the browser's permission was denied). */
export const failNextDictationStart = (page: Page, code: string) =>
  page.evaluate((c) => (window as WithDictation).__assistantDictation!.failNextStart(c), code);
export const microphoneOpen = (page: Page) =>
  page.evaluate(() => (window as WithDictation).__assistantDictation!.listening);
export const dictationStarts = (page: Page) =>
  page.evaluate(() => (window as WithDictation).__assistantDictation!.starts);

/** How many times the panel got the dictation ready before a tap (SDK + token). */
export const dictationPrewarms = (page: Page) =>
  page.evaluate(() => (window as WithDictation).__assistantDictation!.prewarms);

/** Taps the microphone and waits until it is really listening. */
export async function startDictating(page: Page) {
  await micButton(page).click();
  await expect(micButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => microphoneOpen(page)).toBe(true);
}
