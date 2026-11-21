import { describe, expect, it } from "vitest";
import { createSseParser, type SseMessage } from "./sseParser";

function collect() {
  const messages: SseMessage[] = [];
  const parser = createSseParser((m) => messages.push(m));
  return { messages, parser };
}

describe("createSseParser", () => {
  it("parses Spring's format (no space after the colon)", () => {
    const { messages, parser } = collect();
    parser.push('event:message.delta\ndata:{"text":"Hola"}\n\n');
    expect(messages).toEqual([{ event: "message.delta", data: '{"text":"Hola"}' }]);
  });

  it("accepts the optional space after the colon", () => {
    const { messages, parser } = collect();
    parser.push('event: tool.status\ndata: {"tool":"x"}\n\n');
    expect(messages).toEqual([{ event: "tool.status", data: '{"tool":"x"}' }]);
  });

  it("emits several events found in one chunk, in order", () => {
    const { messages, parser } = collect();
    parser.push("event:a\ndata:1\n\nevent:b\ndata:2\n\n");
    expect(messages.map((m) => m.event)).toEqual(["a", "b"]);
  });

  it("waits for the blank line before emitting, whatever the chunk boundaries", () => {
    const { messages, parser } = collect();
    parser.push("event:message.de");
    parser.push('lta\ndata:{"te');
    parser.push('xt":"a"}\n');
    expect(messages).toHaveLength(0);
    parser.push("\n");
    expect(messages).toEqual([{ event: "message.delta", data: '{"text":"a"}' }]);
  });

  it("copes with CRLF line breaks, even split between two chunks", () => {
    const { messages, parser } = collect();
    parser.push("event:a\r\ndata:1\r");
    parser.push("\n\r\n");
    expect(messages).toEqual([{ event: "a", data: "1" }]);
  });

  it("joins multi-line data with a line break and defaults the event name to «message»", () => {
    const { messages, parser } = collect();
    parser.push("data:line one\ndata:line two\n\n");
    expect(messages).toEqual([{ event: "message", data: "line one\nline two" }]);
  });

  it("ignores comments and blocks without data", () => {
    const { messages, parser } = collect();
    parser.push(": keep-alive\n\nevent:orphan\n\n");
    expect(messages).toEqual([]);
  });

  it("keeps accented text intact", () => {
    const { messages, parser } = collect();
    parser.push('event:message.delta\ndata:{"text":"¿Qué turnos hay hoy? ñandú"}\n\n');
    expect(JSON.parse(messages[0].data).text).toBe("¿Qué turnos hay hoy? ñandú");
  });
});
