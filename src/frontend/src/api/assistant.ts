import i18n from "../i18n";
import { createSseParser, type SseMessage } from "../assistant/sseParser";
import { apiBaseUrl } from "./baseUrl";
import { authHeaders } from "./authHeaders";
import { femmeJson } from "./femmeClient";

export type AssistantHistoryMessage = {
  id: number;
  role: "USER" | "ASSISTANT";
  content: string;
  inputMode: string | null;
  createdAt: string;
};

export type AssistantDraftStatus =
  | "DRAFT"
  | "SUPERSEDED"
  | "DISCARDED"
  | "EXPIRED"
  | "CONFIRMING"
  | "CONFIRMED";

/** What an invoice draft would charge; every amount is the backend's, not the model's. */
export type InvoiceDraftPayload = {
  clientId: number;
  clientName: string;
  receiverIdentified: boolean;
  lines: {
    serviceId: number | null;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    professionalId: number | null;
    professionalName: string | null;
    /** True when the person typed this unit price on the card. */
    priceEdited?: boolean | null;
    /** The ficha line this one comes from (internal: never shown). */
    sourceId?: number | null;
  }[];
  serviceRecordId: number | null;
  appointmentId: number | null;
  paymentMethod: string | null;
  cardBrand: string | null;
  email: string | null;
  total: number;
};

/** An appointment the assistant proposed; date/time are the salon's, ready to show. */
export type AppointmentDraftPayload = {
  clientId: number;
  clientName: string;
  serviceId: number;
  serviceName: string;
  professionalId: number;
  professionalName: string;
  /** ISO instant the appointment is created with. */
  startAt: string;
  /** yyyy-MM-dd, HH:mm and HH:mm in the salon's zone. */
  date: string;
  time: string;
  endTime: string;
  durationMinutes: number;
  /** Only warns: the agenda does not block booking outside the working hours either. */
  outsideWorkingHours: boolean;
};

/** Another free time offered when the one asked for is taken. */
export type SlotAlternative = {
  time: string;
  professionalId: number;
  professionalName: string;
  startAt: string;
};

/** A proposal waiting for the person's confirmation (the card draws it from this). */
export type AssistantDraft = {
  id: string;
  type: "INVOICE" | "APPOINTMENT";
  status: AssistantDraftStatus;
  createdAt: string;
  expiresAt: string;
  /** What must still be completed before «Confirmar» works: PAYMENT_METHOD, CARD_BRAND, EMAIL. */
  missing: string[];
  /** An {@link InvoiceDraftPayload} for `INVOICE`, an {@link AppointmentDraftPayload} for `APPOINTMENT`. */
  payload: InvoiceDraftPayload | AppointmentDraftPayload;
  resultType: string | null;
  resultId: number | null;
  /** Set when the conversation is reloaded: the assistant message this card belongs to. */
  messageId?: number | null;
};

export type AssistantConversation = {
  conversationId: number;
  messages: AssistantHistoryMessage[];
  drafts?: AssistantDraft[];
};

export type AssistantMessageRequest = {
  conversationId: number;
  text: string;
  inputMode: "TEXT" | "VOICE";
  currentPage: string;
};

/** What the backend streams back for one message. Unknown events (future cards) are ignored. */
export type AssistantStreamEvent =
  | { type: "message.delta"; text: string }
  | { type: "tool.status"; tool: string; state: "running" | "done" }
  | { type: "card.options"; kind: string; options: { label: string; value: string }[] }
  | { type: "card.draft"; draft: AssistantDraft }
  | { type: "card.draft.updated"; id: string; status: AssistantDraftStatus }
  | { type: "message.done"; messageId: number }
  | { type: "error"; code: string };

/** The user's open conversation with its recent history (created on first use). */
export function getCurrentAssistantConversation(): Promise<AssistantConversation> {
  return femmeJson<AssistantConversation>("/api/assistant/conversations/current", {
    json: false,
  });
}

/** «Nueva conversación»: closes the current one and starts an empty one. */
export function startAssistantConversation(): Promise<AssistantConversation> {
  return femmeJson<AssistantConversation>("/api/assistant/conversations", { method: "POST" });
}

/** Short-lived Speech token for dictation: the browser talks to Azure AI Speech with it. */
export function getAssistantSpeechToken(): Promise<{
  token: string;
  region: string;
  expiresInSeconds: number;
}> {
  return femmeJson("/api/assistant/speech-token", { json: false });
}

export function toAssistantStreamEvent(message: SseMessage): AssistantStreamEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(message.data);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  switch (message.event) {
    case "message.delta":
      return typeof p.text === "string" ? { type: "message.delta", text: p.text } : null;
    case "tool.status":
      return typeof p.tool === "string" && (p.state === "running" || p.state === "done")
        ? { type: "tool.status", tool: p.tool, state: p.state }
        : null;
    case "card.options":
      return typeof p.kind === "string" && Array.isArray(p.options)
        ? { type: "card.options", kind: p.kind, options: p.options as { label: string; value: string }[] }
        : null;
    case "card.draft":
      return typeof p.id === "string" ? { type: "card.draft", draft: payload as AssistantDraft } : null;
    case "card.draft.updated":
      return typeof p.id === "string" && typeof p.status === "string"
        ? { type: "card.draft.updated", id: p.id, status: p.status as AssistantDraftStatus }
        : null;
    case "message.done":
      return { type: "message.done", messageId: Number(p.messageId) };
    case "error":
      return typeof p.code === "string" ? { type: "error", code: p.code } : null;
    default:
      return null;
  }
}

/**
 * Sends a message and reports each event as it arrives. `fetch` + a stream reader (not
 * `EventSource`, which cannot send the Authorization header). A refusal before the stream starts
 * (flag off, unknown conversation, empty text…) rejects with `Error(<error code>)`, like the rest
 * of the API, so `translateApiError` works the same.
 */
export async function streamAssistantMessage(
  request: AssistantMessageRequest,
  onEvent: (event: AssistantStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/api/assistant/messages`, {
    method: "POST",
    headers: {
      ...authHeaders({ json: true }),
      Accept: "text/event-stream",
      "Accept-Language": i18n.resolvedLanguage ?? i18n.language ?? "es",
    },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (!res.body) throw new Error("ASSISTANT_STREAM_UNSUPPORTED");

  const parser = createSseParser((message) => {
    const event = toAssistantStreamEvent(message);
    if (event) onEvent(event);
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
}

// ── Drafts: what a person does with the card ─────────────────────────────────────────────────────

/**
 * A refused draft call. `message` is the raw body (so `translateApiError` keeps working); `body`
 * is that JSON parsed — some errors carry what the card needs to recover (the recalculated draft
 * after `ASSISTANT_PRICE_CHANGED`, the original result after `ASSISTANT_DRAFT_ALREADY_CONFIRMED`).
 */
export class AssistantApiError extends Error {
  readonly body: Record<string, unknown>;

  constructor(raw: string) {
    super(raw);
    let parsed: Record<string, unknown> = {};
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value === "object" && value !== null) parsed = value as Record<string, unknown>;
    } catch {
      // not JSON: the message stays the raw text
    }
    this.body = parsed;
  }

  get code(): string | null {
    return typeof this.body.error === "string" ? this.body.error : null;
  }
}

export type DraftConfirmResult = {
  type: "INVOICE" | "APPOINTMENT";
  invoiceId: number | null;
  invoiceNumberFormatted: string | null;
  sifenSubmissionStatus: string | null;
  appointmentId?: number | null;
  startAt?: string | null;
  professionalId?: number | null;
  draft: AssistantDraft;
};

async function draftRequest<T>(
  method: "POST" | "PATCH",
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: {
      ...authHeaders({ json: true }),
      "Accept-Language": i18n.resolvedLanguage ?? i18n.language ?? "es",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new AssistantApiError((await res.text()) || res.statusText);
  }
  return (await res.json()) as T;
}

/** The button: issues the invoice through the regular road. `Idempotency-Key` = the draft id. */
export function confirmAssistantDraft(id: string): Promise<DraftConfirmResult> {
  return draftRequest<DraftConfirmResult>("POST", `/api/assistant/drafts/${id}/confirm`, undefined, {
    "Idempotency-Key": id,
  });
}

export function discardAssistantDraft(id: string): Promise<AssistantDraft> {
  return draftRequest<AssistantDraft>("POST", `/api/assistant/drafts/${id}/discard`);
}

/** Completes what the card asks for (payment method, card brand, e-mail). */
export type DraftPatch = {
  paymentMethod?: string;
  cardBrand?: string;
  email?: string;
  /** Invoice: unit prices typed on the card, by line position (whole guaraníes). */
  linePrices?: { index: number; unitPrice: number }[];
  /** Invoice: positions of the items dropped on the card (at least one always stays). */
  removeLines?: number[];
  /** Appointment: move the draft to another slot (ISO instant) and, optionally, professional. */
  startAt?: string;
  professionalId?: number;
};

export function completeAssistantDraft(id: string, patch: DraftPatch): Promise<AssistantDraft> {
  return draftRequest<AssistantDraft>("PATCH", `/api/assistant/drafts/${id}`, patch);
}
