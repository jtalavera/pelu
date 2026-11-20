import { describe, expect, it } from "vitest";
import { calcLine, parseFixedInput, ruleValue, sameRule } from "./ruleMath";

const rule = (paid: number, retention: number, fixed: number, destination: "PROFESSIONAL" | "SALON") => ({
  paid,
  retention,
  fixed,
  destination,
});

describe("calcLine (casos del salón, precio con IVA)", () => {
  it("Gaby · Brushing: 45 % se paga y 5 % se retiene", () => {
    const c = calcLine(100_000, rule(45, 5, 0, "PROFESSIONAL"), "TAX_INCLUDED");
    expect(c).toMatchObject({ base: 100_000, paidAmount: 45_000, retentionAmount: 5_000, pays: 45_000, salon: 50_000 });
  });

  it("Gaby · Pestañas: comisiona sobre 30.000 y los 20.000 son de ella", () => {
    const c = calcLine(50_000, rule(45, 5, 20_000, "PROFESSIONAL"), "TAX_INCLUDED");
    expect(c).toMatchObject({ base: 30_000, paidAmount: 13_500, retentionAmount: 1_500, pays: 33_500, salon: 15_000 });
  });

  it("Migue · Manos: 3.000 de producto para ella", () => {
    const c = calcLine(50_000, rule(45, 5, 3_000, "PROFESSIONAL"), "TAX_INCLUDED");
    expect(c).toMatchObject({ base: 47_000, paidAmount: 21_150, retentionAmount: 2_350, pays: 24_150, salon: 23_500 });
  });

  it("Jorgelina · Manos: sin retención", () => {
    const c = calcLine(50_000, rule(50, 0, 3_000, "PROFESSIONAL"), "TAX_INCLUDED");
    expect(c).toMatchObject({ paidAmount: 23_500, retentionAmount: 0, pays: 26_500, salon: 23_500 });
  });

  it("un monto fijo para el salón solo baja la base", () => {
    const c = calcLine(50_000, rule(45, 5, 3_000, "SALON"), "TAX_INCLUDED");
    expect(c).toMatchObject({ base: 47_000, pays: 21_150, fixedToProfessional: false, salon: 26_500 });
  });

  it("si el monto fijo supera el precio la base es 0 y igual lo cobra", () => {
    const c = calcLine(15_000, rule(45, 5, 20_000, "PROFESSIONAL"), "TAX_INCLUDED");
    expect(c).toMatchObject({ base: 0, pays: 20_000, retentionAmount: 0 });
  });

  it("una línea sin precio no genera nada", () => {
    expect(calcLine(0, rule(45, 5, 3_000, "PROFESSIONAL"), "TAX_INCLUDED").pays).toBe(0);
  });

  it("con base sin IVA se calcula sobre el precio sin el 10 %", () => {
    const c = calcLine(110_000, rule(40, 0, 0, "PROFESSIONAL"), "NET_OF_TAX");
    expect(c.base).toBe(100_000);
    expect(c.pays).toBe(40_000);
  });
});

describe("helpers", () => {
  it("parseFixedInput acepta miles con punto y rechaza lo demás", () => {
    expect(parseFixedInput("")).toBe(0);
    expect(parseFixedInput("3.000")).toBe(3000);
    expect(parseFixedInput("20000")).toBe(20000);
    expect(parseFixedInput("3,5")).toBeNull();
    expect(parseFixedInput("-3")).toBeNull();
    expect(parseFixedInput("abc")).toBeNull();
  });

  it("ruleValue y sameRule", () => {
    expect(ruleValue({ paid: "45", retention: "5", fixed: 3000, destination: "PROFESSIONAL" })).toBe("45|5|3000|P");
    expect(ruleValue({ paid: "45", retention: "", fixed: 0, destination: "DEFAULT" })).toBe("45|0|0|");
    expect(sameRule("45.00|5.00|3000|P", "45|5|3000|P")).toBe(true);
    expect(sameRule("45.00", "45|0|0|")).toBe(true);
    expect(sameRule("45|5|0|", "45|5|0|S")).toBe(false);
    expect(sameRule(null, null)).toBe(true);
    expect(sameRule(null, "45")).toBe(false);
  });
});
