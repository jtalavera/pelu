/** One Server-Sent Event: its name (default "message") and its data lines joined by "\n". */
export type SseMessage = { event: string; data: string };

/**
 * Incremental parser for a `text/event-stream` body. Feed it decoded text chunks as they arrive —
 * chunk boundaries may fall anywhere, even between the "\r" and "\n" of a line break — and it calls
 * `onMessage` once per complete event (a blank line ends an event). Spring's `SseEmitter` writes
 * `event:name` / `data:payload` with no space after the colon; the spec's optional single space is
 * accepted too. Comment lines (`:`) are ignored.
 */
export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = "";

  function emit(block: string) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length > 0) onMessage({ event, data: data.join("\n") });
  }

  return {
    push(chunk: string) {
      let text = buffer + chunk;
      // A trailing "\r" may be the first half of "\r\n": hold it back until the next chunk.
      const held = text.endsWith("\r") ? "\r" : "";
      if (held) text = text.slice(0, -1);
      text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      let end = text.indexOf("\n\n");
      while (end !== -1) {
        emit(text.slice(0, end));
        text = text.slice(end + 2);
        end = text.indexOf("\n\n");
      }
      buffer = text + held;
    },
  };
}
