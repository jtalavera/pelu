/**
 * Best-effort parse of fetch error bodies (plain text or JSON with `message`).
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
    if (typeof j.message === "string" && j.message.length > 0) {
      return j.message;
    }
    if (typeof j.title === "string" && j.title.length > 0) {
      return j.title;
    }
    if (typeof j.error === "string" && j.error.length > 0) {
      return j.error;
    }
  } catch {
    /* not JSON */
  }
  return raw;
}

/** True when the server message likely refers to RUC validation (map to RUC field error). */
export function looksLikeRucValidationError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("ruc") || m.includes("check digit") || m.includes("dígito verificador");
}
