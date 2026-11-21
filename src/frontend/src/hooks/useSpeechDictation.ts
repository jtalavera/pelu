import { useCallback, useEffect, useRef, useState } from "react";
import {
  DictationError,
  startDictation,
  type DictationEngine,
  type DictationErrorCode,
  type DictationSession,
} from "../assistant/dictation";

/** A dictation that nobody stops ends by itself (cost and privacy: the microphone is not left on). */
export const MAX_LISTEN_MS = 120_000;

export type DictationState = "idle" | "starting" | "listening";

/**
 * Dictation for one text box. It only reports what was heard: the caller decides where the text
 * goes, and nothing here ever sends a message. `stop` is safe to call at any time (even before
 * the microphone finished starting, in which case the start is cancelled).
 */
export function useSpeechDictation({
  language,
  onPartial,
  onFinal,
  onError,
  engine = startDictation,
}: {
  language: string;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (code: DictationErrorCode) => void;
  engine?: DictationEngine;
}) {
  const [state, setState] = useState<DictationState>("idle");
  const stateRef = useRef<DictationState>("idle");
  const sessionRef = useRef<DictationSession | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always the latest callbacks, without restarting a session when they change.
  const handlersRef = useRef({ onPartial, onFinal, onError });
  useEffect(() => {
    handlersRef.current = { onPartial, onFinal, onError };
  });

  const update = useCallback((next: DictationState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const stop = useCallback(async () => {
    attemptRef.current += 1; // a start still in flight must not turn into a listening session
    clearTimer();
    const session = sessionRef.current;
    sessionRef.current = null;
    update("idle");
    await session?.stop();
  }, [update]);

  const start = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    const attempt = ++attemptRef.current;
    update("starting");
    try {
      const session = await engine(language, {
        onPartial: (text) => {
          if (attemptRef.current === attempt) handlersRef.current.onPartial(text);
        },
        onFinal: (text) => {
          if (attemptRef.current === attempt) handlersRef.current.onFinal(text);
        },
        onError: (code) => {
          if (attemptRef.current !== attempt) return;
          attemptRef.current += 1;
          clearTimer();
          sessionRef.current = null;
          update("idle");
          handlersRef.current.onError(code);
        },
        onEnded: () => {
          if (attemptRef.current !== attempt) return;
          attemptRef.current += 1;
          clearTimer();
          sessionRef.current = null;
          update("idle");
        },
      });
      if (attemptRef.current !== attempt) {
        await session.stop(); // stopped while the microphone was starting
        return;
      }
      sessionRef.current = session;
      update("listening");
      timerRef.current = setTimeout(() => void stop(), MAX_LISTEN_MS);
    } catch (e) {
      if (attemptRef.current !== attempt) return;
      update("idle");
      handlersRef.current.onError(e instanceof DictationError ? e.code : "UNAVAILABLE");
    }
  }, [engine, language, stop, update]);

  // Leaving the screen (or closing the panel) turns the microphone off.
  useEffect(
    () => () => {
      attemptRef.current += 1;
      clearTimer();
      void sessionRef.current?.stop();
      sessionRef.current = null;
    },
    [],
  );

  return { state, listening: state === "listening", starting: state === "starting", start, stop };
}
