import { getAssistantSpeechToken } from "../api/assistant";

/**
 * The Speech token, kept in memory so dictating does not wait for the backend each time. The
 * backend tells how many seconds the token has left; it is reused only while there is room to
 * listen for the whole maximum dictation (2 minutes) plus margin.
 */
export const TOKEN_REUSE_MARGIN_MS = 150_000;

type SpeechToken = { token: string; region: string };

let cached: (SpeechToken & { expiresAt: number }) | null = null;
let inFlight: Promise<SpeechToken> | null = null;

/** A usable token: the one in memory, one already being requested, or a new one. */
export function getSpeechToken(): Promise<SpeechToken> {
  if (cached && cached.expiresAt - Date.now() >= TOKEN_REUSE_MARGIN_MS) {
    return Promise.resolve({ token: cached.token, region: cached.region });
  }
  if (inFlight) return inFlight;
  const request = getAssistantSpeechToken()
    .then((t) => {
      cached = { token: t.token, region: t.region, expiresAt: Date.now() + t.expiresInSeconds * 1000 };
      return { token: t.token, region: t.region };
    })
    .finally(() => {
      inFlight = null; // a failure is not remembered: the next attempt asks again
    });
  inFlight = request;
  return request;
}

/** For tests and for leaving the session. */
export function resetSpeechTokenCache(): void {
  cached = null;
  inFlight = null;
}
