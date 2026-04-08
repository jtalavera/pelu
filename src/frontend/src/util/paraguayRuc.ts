/** RUC field format only: one or more digits, hyphen, one or more digits (no check-digit validation). */
const RUC_FORMAT = /^\d+-\d+$/;

export function isValidParaguayRuc(input: string): boolean {
  const t = input.trim();
  if (!t) {
    return false;
  }
  return RUC_FORMAT.test(t);
}
