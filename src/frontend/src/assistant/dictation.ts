import { getSpeechToken } from "./speechToken";

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

/** Opens the microphone; a refusal is told apart from a network/service failure. */
async function openMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new DictationError("UNSUPPORTED");
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    throw new DictationError(
      name === "NotAllowedError" || name === "SecurityError" ? "MIC_DENIED" : "MIC_UNAVAILABLE",
    );
  }
}

type Sdk = typeof import("microsoft-cognitiveservices-speech-sdk");

let sdkLoad: Promise<Sdk> | null = null;

/** The SDK chunk, downloaded once; a failed download is retried on the next attempt. */
function loadSdk(): Promise<Sdk> {
  sdkLoad ??= import("microsoft-cognitiveservices-speech-sdk").catch((e) => {
    sdkLoad = null;
    throw e;
  });
  return sdkLoad;
}

/**
 * Gets ready before the person taps the microphone (panel opened, pointer or focus on the
 * button): the SDK is downloaded and the token requested, so tapping only has to open the
 * microphone and connect. Never throws, never opens the microphone.
 */
export function prewarmDictation(): void {
  if (SIMULATED) {
    if (window.__assistantDictation) window.__assistantDictation.prewarms += 1;
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) return;
  void loadSdk().catch(() => {});
  void getSpeechToken().catch(() => {});
}

const azureEngine: DictationEngine = async (language, handlers) => {
  const t0 = performance.now();
  // Microphone, token and SDK are independent: they start together and the slowest one sets the
  // pace (before, each waited for the previous one). The microphone's own failure is reported
  // first, since «no permission» says more than «no network».
  const [mic, tokenResult, sdkResult] = await Promise.allSettled([
    openMicrophone(),
    getSpeechToken(),
    loadSdk(),
  ]);
  const stream = mic.status === "fulfilled" ? mic.value : null;
  const releaseStream = () => stream?.getTracks().forEach((track) => track.stop());
  if (mic.status === "rejected") throw mic.reason;
  if (tokenResult.status === "rejected" || sdkResult.status === "rejected") {
    releaseStream();
    throw new DictationError("UNAVAILABLE");
  }
  const speech = tokenResult.value;
  const sdk = sdkResult.value;
  const t1 = performance.now();

  const config = sdk.SpeechConfig.fromAuthorizationToken(speech.token, speech.region);
  config.speechRecognitionLanguage = speechLocale(language);
  const recognizer = new sdk.SpeechRecognizer(config, sdk.AudioConfig.fromStreamInput(stream!));
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      recognizer.close();
      releaseStream();
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
  if (import.meta.env.DEV) {
    // Where the time goes between tapping the microphone and listening (ms).
    console.debug("[dictation] ready", {
      microphoneTokenSdk: Math.round(t1 - t0),
      connect: Math.round(performance.now() - t1),
      total: Math.round(performance.now() - t0),
    });
  }
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
  /** How many times the engine was asked to get ready before a tap (SDK + token). */
  prewarms: number;
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
    prewarms: 0,
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
