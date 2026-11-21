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

export type AssistantConversation = {
  conversationId: number;
  messages: AssistantHistoryMessage[];
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
