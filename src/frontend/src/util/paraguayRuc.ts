/**
 * Paraguay RUC (SET modulo 11). Format: eight digits, hyphen, one check digit.
 */
export function computeParaguayRucVerificationDigit(eightDigits: string): number {
  const baseMax = 11;
  let k = 2;
  let total = 0;
  for (let i = eightDigits.length - 1; i >= 0; i--) {
    if (k > baseMax) k = 2;
    const v = Number.parseInt(eightDigits.charAt(i), 10);
    total += v * k;
    k++;
  }
  const rest = total % 11;
  if (rest > 1) {
    return 11 - rest;
  }
  return 0;
}

export function isValidParaguayRuc(input: string): boolean {
  const trimmed = input.trim();
  if (!/^\d{8}-\d$/.test(trimmed)) {
    return false;
  }
  const [base, dvStr] = trimmed.split("-");
  const expected = computeParaguayRucVerificationDigit(base);
  const dv = Number.parseInt(dvStr, 10);
  return expected === dv;
}
