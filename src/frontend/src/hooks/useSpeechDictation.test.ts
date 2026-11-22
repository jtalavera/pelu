import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DictationError, speechLocale, type DictationEngine } from "../assistant/dictation";
import { MAX_LISTEN_MS, useSpeechDictation } from "./useSpeechDictation";

function setup(engine: DictationEngine) {
  const calls = { partial: vi.fn(), final: vi.fn(), error: vi.fn() };
  const hook = renderHook(() =>
    useSpeechDictation({
      language: "es",
      engine,
      onPartial: calls.partial,
      onFinal: calls.final,
      onError: calls.error,
    }),
  );
  return { ...hook, calls };
}

describe("speechLocale", () => {
  it("maps the UI language to a speech locale", () => {
    expect(speechLocale("es")).toBe("es-PY");
    expect(speechLocale("es-AR")).toBe("es-PY");
    expect(speechLocale("en")).toBe("en-US");
    expect(speechLocale("pt")).toBe("en-US");
  });
});

describe("useSpeechDictation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("goes starting → listening → idle and passes the language to the engine", async () => {
    const stop = vi.fn(async () => {});
    const engine = vi.fn(async () => ({ stop })) as unknown as DictationEngine;
    const { result } = setup(engine);

    let started: Promise<void> = Promise.resolve();
    act(() => {
      started = result.current.start();
    });
    expect(result.current.state).toBe("starting");
    await act(async () => started);
    expect(result.current.state).toBe("listening");
    expect(engine).toHaveBeenCalledWith("es", expect.any(Object));

    await act(async () => result.current.stop());
    expect(result.current.state).toBe("idle");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stopping while the microphone is still starting cancels it: it never listens", async () => {
    let release: (s: { stop: () => Promise<void> }) => void = () => {};
    const stop = vi.fn(async () => {});
    const engine = (() => new Promise((resolve) => (release = resolve))) as unknown as DictationEngine;
    const { result } = setup(engine);

    act(() => void result.current.start());
    await act(async () => result.current.stop());
    await act(async () => release({ stop }));

    expect(result.current.state).toBe("idle");
    expect(stop).toHaveBeenCalledTimes(1); // the late session was shut down right away
  });

  it("an engine failure ends in idle and reports the code (an unknown failure is UNAVAILABLE)", async () => {
    const denied = setup((async () => {
      throw new DictationError("MIC_DENIED");
    }) as DictationEngine);
    await act(async () => denied.result.current.start());
    expect(denied.calls.error).toHaveBeenCalledWith("MIC_DENIED");
    expect(denied.result.current.state).toBe("idle");

    const broken = setup((async () => {
      throw new Error("boom");
    }) as DictationEngine);
    await act(async () => broken.result.current.start());
    expect(broken.calls.error).toHaveBeenCalledWith("UNAVAILABLE");
  });

  it("forwards what is heard only while it is the current session", async () => {
    let handlers!: Parameters<DictationEngine>[1];
    const { result, calls } = setup((async (_l, h) => {
      handlers = h;
      return { stop: async () => {} };
    }) as DictationEngine);
    await act(async () => result.current.start());

    act(() => handlers.onPartial("hola"));
    act(() => handlers.onFinal("hola mundo"));
    expect(calls.partial).toHaveBeenCalledWith("hola");
    expect(calls.final).toHaveBeenCalledWith("hola mundo");

    await act(async () => result.current.stop());
    act(() => handlers.onPartial("tarde")); // a straggler after stop is ignored
    expect(calls.partial).toHaveBeenCalledTimes(1);
  });

  it("a failure while listening ends the session and reports it", async () => {
    let handlers!: Parameters<DictationEngine>[1];
    const { result, calls } = setup((async (_l, h) => {
      handlers = h;
      return { stop: async () => {} };
    }) as DictationEngine);
    await act(async () => result.current.start());

    act(() => handlers.onError("NETWORK"));

    expect(result.current.state).toBe("idle");
    expect(calls.error).toHaveBeenCalledWith("NETWORK");
  });

  it("a session that nobody stops ends by itself after the limit", async () => {
    const stop = vi.fn(async () => {});
    const { result } = setup((async () => ({ stop })) as DictationEngine);
    await act(async () => result.current.start());
    expect(result.current.listening).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_LISTEN_MS + 10);
    });

    expect(result.current.state).toBe("idle");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("starting twice does not open two sessions", async () => {
    const engine = vi.fn(async () => ({ stop: async () => {} })) as unknown as DictationEngine;
    const { result } = setup(engine);

    await act(async () => {
      void result.current.start();
      void result.current.start();
    });

    expect(engine).toHaveBeenCalledTimes(1);
  });

  it("unmounting turns the microphone off", async () => {
    const stop = vi.fn(async () => {});
    const { result, unmount } = setup((async () => ({ stop })) as DictationEngine);
    await act(async () => result.current.start());

    unmount();

    expect(stop).toHaveBeenCalledTimes(1);
  });
});
