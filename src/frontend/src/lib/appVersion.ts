/** Build identifier baked in via Vite `define` — git SHA (CI) or timestamp (local). */
export const APP_VERSION = __APP_VERSION__;

// Exposed for diagnostics / e2e assertions; not sensitive, harmless to always set.
if (typeof window !== "undefined") {
  (window as typeof window & { __APP_VERSION__?: string }).__APP_VERSION__ = APP_VERSION;
}
