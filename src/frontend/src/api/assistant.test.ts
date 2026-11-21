import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  streamAssistantMessage,
  toAssistantStreamEvent,
  type AssistantStreamEvent,
} from "./assistant";

const encoder = new TextEncoder();

/** A streaming Response whose body arrives in the given chunks. */
function sseResponse(chunks: string[], init?: ResponseInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

const REQUEST = { conversationId: 5, text: "hola", inputMode: "TEXT", currentPage: "hoy" } as const;

describe("streamAssistantMessage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.setItem("accessToken", "jwt-token");
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("posts with the bearer token and delivers each event as it arrives", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'event:tool.status\ndata:{"tool":"turnos_del_dia","state":"running"}\n\n',
        'event:message.delta\ndata:{"text":"Hay "}\n\nevent:message.delta\ndata:{"te',
        'xt":"2 turnos"}\n\nevent:message.done\ndata:{"messageId":9,"usage":{}}\n\n',
      ]),
    );
    const events: AssistantStreamEvent[] = [];

    await streamAssistantMessage(REQUEST, (e) => events.push(e));

    expect(events).toEqual([
      { type: "tool.status", tool: "turnos_del_dia", state: "running" },
      { type: "message.delta", text: "Hay " },
      { type: "message.delta", text: "2 turnos" },
      { type: "message.done", messageId: 9 },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/assistant\/messages$/);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer jwt-token");
    expect(init.headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(init.body)).toEqual(REQUEST);
  });

  it("surfaces an error event of the stream", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['event:error\ndata:{"code":"ASSISTANT_MODEL_UNAVAILABLE"}\n\n']),
    );
    const events: AssistantStreamEvent[] = [];

    await streamAssistantMessage(REQUEST, (e) => events.push(e));

    expect(events).toEqual([{ type: "error", code: "ASSISTANT_MODEL_UNAVAILABLE" }]);
  });

  it("rejects with the backend error code when the request is refused before streaming", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":"ASSISTANT_DISABLED"}', { status: 403, statusText: "Forbidden" }),
    );

    await expect(streamAssistantMessage(REQUEST, () => {})).rejects.toThrow(
      '{"error":"ASSISTANT_DISABLED"}',
    );
  });
});

describe("toAssistantStreamEvent", () => {
  it("ignores unknown events and malformed payloads instead of failing the stream", () => {
    expect(toAssistantStreamEvent({ event: "card.draft", data: "{}" })).toBeNull();
    expect(toAssistantStreamEvent({ event: "message.delta", data: "not json" })).toBeNull();
    expect(toAssistantStreamEvent({ event: "message.delta", data: '{"text":3}' })).toBeNull();
    expect(
      toAssistantStreamEvent({ event: "tool.status", data: '{"tool":"x","state":"weird"}' }),
    ).toBeNull();
  });
});
