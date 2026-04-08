import type { TFunction } from "i18next";

/**
 * Best-effort parse of fetch error bodies (plain text or JSON with `message` / `error`).
 * Returns the raw error code string from the server (e.g. "INVALID_RUC_FORMAT").
 */
export function parseApiErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }
  const raw = err.message.trim();
  if (!raw) {
    return "";
  }
  try {
    const j = JSON.parse(raw) as { message?: string; error?: string; title?: string };
    if (typeof j.error === "string" && j.error.length > 0) {
      return j.error;
    }
    if (typeof j.message === "string" && j.message.length > 0) {
      return j.message;
    }
    if (typeof j.title === "string" && j.title.length > 0) {
      return j.title;
    }
  } catch {
    /* not JSON */
  }
  return raw;
}

/**
 * Translates a backend error code (e.g. "INVALID_RUC_FORMAT") to a localized string.
 * Falls back to a generic error message if the code has no specific translation.
 */
export function translateApiError(
  err: unknown,
  t: TFunction,
  fallbackKey = "femme.apiErrors.GENERIC",
): string {
  const code = parseApiErrorMessage(err);
  if (!code) return t(fallbackKey);
  const key = `femme.apiErrors.${code}`;
  const translated = t(key, { defaultValue: "" });
  if (translated) return translated;
  return t(fallbackKey);
}

/** True when the server error code refers to RUC validation. */
export function looksLikeRucValidationError(message: string): boolean {
  return message === "INVALID_RUC_FORMAT" || message.toLowerCase().includes("ruc");
}
