import type { BaseType, FixedDestination } from "../../api/commissions";

/** HU-COM-14: one rule of a professional for a commission group. */
export type RuleFields = {
  /** % that is paid. */
  paid: number;
  /** % retained for aguinaldo. */
  retention: number;
  /** Fixed amount (costo de producto) deducted from the base, in Gs. */
  fixed: number;
  /** Who gets the fixed amount (already resolved against the salon default). */
  destination: FixedDestination;
};

export type LineCalc = {
  base: number;
  fixed: number;
  fixedToProfessional: boolean;
  paidAmount: number;
  retentionAmount: number;
  /** What the professional is paid now: the paid % plus the fixed amount when it is hers. */
  pays: number;
  /** What is left for the salon: price − pays − retention. */
  salon: number;
};

const IVA_RATE = 10;

/** Half-up rounding to whole guaraníes (same as the backend calculator). */
const round = (n: number) => Math.round(n);

/**
 * Mirror of the backend `CommissionCalculator.amounts` for the live example: base after the fixed
 * amount (never below 0), then the paid % and the retained %. A line without price gets nothing.
 */
export function calcLine(price: number, rule: RuleFields, baseType: BaseType): LineCalc {
  const total = Math.max(0, price);
  const tax = (total * IVA_RATE) / (100 + IVA_RATE);
  const gross = baseType === "NET_OF_TAX" ? Math.max(0, total - tax) : total;
  const fixed = gross > 0 ? round(rule.fixed) : 0;
  const base = Math.max(0, gross - fixed);
  const paidAmount = round((base * rule.paid) / 100);
  const retentionAmount = round((base * rule.retention) / 100);
  const fixedToProfessional = rule.destination === "PROFESSIONAL";
  const pays = paidAmount + (fixedToProfessional ? fixed : 0);
  return {
    base: round(base),
    fixed,
    fixedToProfessional,
    paidAmount,
    retentionAmount,
    pays,
    salon: round(total) - pays - retentionAmount,
  };
}

/** "3.000" / "3000" → 3000; "" → 0; anything else → null. */
export function parseFixedInput(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return 0;
  if (!/^\d{1,3}(\.\d{3})*$|^\d{1,9}$/.test(s)) return null;
  const n = Number(s.replace(/\./g, ""));
  return Number.isSafeInteger(n) && n >= 0 && n <= 999_999_999 ? n : null;
}

/** Serialized rule value of the API: "pago|retención|montoFijo|destino" (empty destination = default). */
export function ruleValue(r: { paid: string; retention: string; fixed: number; destination: "DEFAULT" | FixedDestination }): string {
  const dest = r.destination === "DEFAULT" ? "" : r.destination === "PROFESSIONAL" ? "P" : "S";
  return `${r.paid}|${r.retention === "" ? "0" : r.retention}|${r.fixed}|${dest}`;
}

/** The same rule written differently ("45" vs "45.00") compares equal. */
export function sameRule(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const norm = (v: string) => {
    const [p = "0", r = "0", f = "0", d = ""] = v.split("|");
    return `${Number(p)}|${Number(r)}|${Number(f)}|${d}`;
  };
  return norm(a) === norm(b);
}
