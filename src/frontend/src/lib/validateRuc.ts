/** Paraguay RUC: digits, hyphen, digits (e.g. 80000005-6). */
const PARAGUAY_RUC_PATTERN = /^\d+-\d+$/;

export function validateRuc(ruc: string): boolean {
  return PARAGUAY_RUC_PATTERN.test(ruc.trim());
}
