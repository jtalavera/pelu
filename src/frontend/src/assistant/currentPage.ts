/**
 * The screen the user is looking at, as a short name the assistant gets as context
 * ("hoy", "calendar", "clients"…): the first segment after `/app`, `resumen` for the home, and
 * empty anywhere else. Only `[a-z0-9_-]` survives — the backend discards anything else.
 */
export function deriveAssistantPage(pathname: string): string {
  const match = /^\/app(?:\/([^/?#]+))?/.exec(pathname);
  if (!match) return "";
  const segment = match[1]?.toLowerCase();
  if (!segment) return "resumen";
  return /^[a-z0-9_-]{1,40}$/.test(segment) ? segment : "";
}
