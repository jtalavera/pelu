/**
 * Lightweight email validator: accepts inputs that contain non-empty local-part
 * and a domain with at least one dot. This is *not* RFC-5322 strict; it just
 * captures the spirit of the product rule:
 *
 * - At least one character before the `@`.
 * - Exactly one `@`.
 * - Domain has a dot somewhere after `@` (so we reject `user@x` but accept
 *   `user@x.io`).
 *
 * The check is intentionally permissive: the backend authoritatively validates
 * the address. The frontend is only there to nudge the user before they submit.
 */
export function isValidEmail(raw: string): boolean {
  const value = (raw ?? "").trim();
  if (!value) return false;
  if ((value.match(/@/g) ?? []).length !== 1) return false;
  const at = value.indexOf("@");
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length === 0) return false;
  if (domain.length === 0) return false;
  if (!domain.includes(".")) return false;
  if (/\s/.test(value)) return false;
  return true;
}
