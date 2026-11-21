import { getAssistantSpeechToken } from "../api/assistant";

/**
 * Dictation (HU-AST-07). One «session» = the microphone listening until it is stopped. The real
 * engine talks to Azure AI Speech straight from the browser with a short-lived token the backend
 * issues (the SDK is loaded only when someone dictates). Playwright cannot speak, so a simulated
 * engine — selected by the same `VITE_PLAYWRIGHT` flag the app already uses — lets a test inject
 * partial/final transcripts and failures through `window.__assistantDictation`.
 */

export type DictationErrorCode =
  | "MIC_DENIED"
  | "MIC_UNAVAILABLE"
  | "NETWORK"
  | "UNAVAILABLE"
  | "UNSUPPORTED";

export class DictationError extends Error {
  readonly code: DictationErrorCode;
  constructor(code: DictationErrorCode) {
    super(code);
    this.code = code;
  }
}

export type DictationHandlers = {
  /** Text recognized so far for the current utterance (replaced by the next partial). */
  onPartial: (text: string) => void;
  /** A finished utterance: it stays. */
  onFinal: (text: string) => void;
  /** The session failed while listening (it is over). */
  onError: (code: DictationErrorCode) => void;
  /** The session ended by itself (not because of `stop`). */
  onEnded: () => void;
};

export type DictationSession = { stop: () => Promise<void> };

/** Starts listening; rejects with a {@link DictationError} if it cannot. */
export type DictationEngine = (
  language: string,
  handlers: DictationHandlers,
) => Promise<DictationSession>;

/** The speech locale for the UI language: Paraguayan Spanish for `es`, US English otherwise. */
export function speechLocale(language: string): string {
  return language.toLowerCase().startsWith("es") ? "es-PY" : "en-US";
}

// ── Real engine (Azure AI Speech) ───────────────────────────────────────────────────────────────

/** Asks for the microphone first, so a refusal is told apart from a network/service failure. */
async function requireMicrophone(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new DictationError("UNSUPPORTED");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    throw new DictationError(
      name === "NotAllowedError" || name === "SecurityError" ? "MIC_DENIED" : "MIC_UNAVAILABLE",
    );
  }
}

const azureEngine: DictationEngine = async (language, handlers) => {
  await requireMicrophone();
  let speech: { token: string; region: string };
  try {
    speech = await getAssistantSpeechToken();
  } catch {
    throw new DictationError("UNAVAILABLE");
  }
  const sdk = await import("microsoft-cognitiveservices-speech-sdk").catch(() => {
    throw new DictationError("UNAVAILABLE");
  });

  const config = sdk.SpeechConfig.fromAuthorizationToken(speech.token, speech.region);
  config.speechRecognitionLanguage = speechLocale(language);
  const recognizer = new sdk.SpeechRecognizer(config, sdk.AudioConfig.fromDefaultMicrophoneInput());
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      recognizer.close();
    }
  };

  recognizer.recognizing = (_s, e) => handlers.onPartial(e.result.text);
  recognizer.recognized = (_s, e) => {
    if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
      handlers.onFinal(e.result.text);
    }
  };
  recognizer.canceled = (_s, e) => {
    if (e.reason !== sdk.CancellationReason.Error) return;
    const code =
      e.errorCode === sdk.CancellationErrorCode.AuthenticationFailure
        ? "UNAVAILABLE"
        : "NETWORK";
    close();
    handlers.onError(code);
  };
  recognizer.sessionStopped = () => {
    if (!closed) {
      close();
      handlers.onEnded();
    }
  };

  await new Promise<void>((resolve, reject) =>
    recognizer.startContinuousRecognitionAsync(resolve, () => {
      close();
      reject(new DictationError("NETWORK"));
    }),
  );
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        if (closed) return resolve();
        recognizer.stopContinuousRecognitionAsync(
          () => {
            close();
            resolve();
          },
          () => {
            close();
            resolve();
          },
        );
      }),
  };
};

// ── Simulated engine (Playwright only) ──────────────────────────────────────────────────────────

/** What a Playwright test drives: it speaks for the person. */
export type SimulatedDictationControl = {
  /** True while a session is listening. */
  listening: boolean;
  /** Text of the utterance in progress. */
  partial: (text: string) => void;
  /** A finished utterance. */
  final: (text: string) => void;
  /** The listening session fails. */
  fail: (code: DictationErrorCode) => void;
  /** The next attempt to start fails (e.g. permission denied). */
  failNextStart: (code: DictationErrorCode) => void;
  /** How many times a session was started (to assert nothing restarts by itself). */
  starts: number;
};

declare global {
  interface Window {
    __assistantDictation?: SimulatedDictationControl;
  }
}

const SIMULATED = import.meta.env.VITE_PLAYWRIGHT === "1";

let activeHandlers: DictationHandlers | null = null;
let nextStartError: DictationErrorCode | null = null;

if (SIMULATED && typeof window !== "undefined") {
  const control: SimulatedDictationControl = {
    listening: false,
    starts: 0,
    partial: (text) => activeHandlers?.onPartial(text),
    final: (text) => activeHandlers?.onFinal(text),
    fail: (code) => {
      const handlers = activeHandlers;
      activeHandlers = null;
      control.listening = false;
      handlers?.onError(code);
    },
    failNextStart: (code) => {
      nextStartError = code;
    },
  };
  window.__assistantDictation = control;
}

const simulatedEngine: DictationEngine = async (_language, handlers) => {
  if (nextStartError) {
    const code = nextStartError;
    nextStartError = null;
    throw new DictationError(code);
  }
  activeHandlers = handlers;
  const control = window.__assistantDictation;
  if (control) {
    control.listening = true;
    control.starts += 1;
  }
  return {
    stop: async () => {
      activeHandlers = null;
      if (control) control.listening = false;
    },
  };
};

/** The engine the app uses: the simulated one under Playwright, Azure AI Speech otherwise. */
export const startDictation: DictationEngine = (language, handlers) =>
  (SIMULATED ? simulatedEngine : azureEngine)(language, handlers);
