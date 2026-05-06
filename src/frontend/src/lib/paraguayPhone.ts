/**
 * Paraguay phone number formatting helpers.
 *
 * Local layout: `(0XXX) XXX-XXX` — area code wrapped in parentheses, then a
 * 6-digit subscriber number split with a hyphen at the midpoint.
 *
 * The mask is *progressive*: as the user types digits the format is built
 * incrementally so partial input still reads naturally:
 *   "0"          -> "0"
 *   "098"        -> "(098"
 *   "0981"       -> "(0981)"
 *   "0981123"    -> "(0981) 123"
 *   "0981123456" -> "(0981) 123-456"
 *
 * If the leading "0" is omitted while typing (e.g. user types "981123456"),
 * the formatter assumes the area code starts with the next digit and does NOT
 * inject the leading 0; it just groups what was entered.
 *
 * The formatter never mutates non-digits in cosmetic ways: it strips
 * everything that is not a digit and reapplies the mask.
 */

const SUBSCRIBER_LENGTH = 6;
const AREA_CODE_LENGTH = 4;
const TOTAL_LOCAL_DIGITS = AREA_CODE_LENGTH + SUBSCRIBER_LENGTH; // 10

/** Returns only digit characters from the string. */
export function digitsOnly(raw: string): string {
  return (raw ?? "").replace(/\D+/g, "");
}

/**
 * Formats a Paraguay landline / mobile number using the canonical local
 * pattern `(0XXX) XXX-XXX`. Caps input to 10 digits.
 */
export function formatParaguayPhone(raw: string): string {
  const d = digitsOnly(raw).slice(0, TOTAL_LOCAL_DIGITS);
  if (d.length === 0) return "";
  if (d.length <= AREA_CODE_LENGTH) {
    return `(${d}`;
  }
  const area = d.slice(0, AREA_CODE_LENGTH);
  const rest = d.slice(AREA_CODE_LENGTH);
  if (rest.length <= 3) {
    return `(${area}) ${rest}`;
  }
  const first = rest.slice(0, 3);
  const second = rest.slice(3, 6);
  return `(${area}) ${first}-${second}`;
}

/**
 * `true` when the input has the full local number (4-digit area code + 6-digit
 * subscriber). Other shapes are accepted in the form (international numbers,
 * partial numbers) but this helper recognizes a complete national number.
 */
export function isCompleteParaguayPhone(raw: string): boolean {
  return digitsOnly(raw).length === TOTAL_LOCAL_DIGITS;
}
