import { describe, expect, it } from "vitest";
import type { EntryView } from "../../api/commissions";
import { buildSettlementDays, compose, dayKey } from "./settlementDays";

const entry = (id: number, accrualAt: string, over: Partial<EntryView> = {}): EntryView =>
  ({
    id,
    professionalId: 1,
    professionalName: "Ana",
    sourceType: "INVOICE_LINE",
    revision: 1,
    reasonCode: null,
    invoiceId: 10,
    invoiceLineId: id,
    invoiceNumber: "0000013",
    itemName: "Spa de pies",
    itemKind: "SERVICE",
    commissionAmount: 1000,
    fixedAmount: 0,
    retentionPercent: 0,
    retentionAmount: 0,
    accrualAt,
    reversesEntryId: null,
    reassignable: true,
    note: null,
    ...over,
  }) as EntryView;

describe("dayKey", () => {
  it("uses the Paraguay day, not the UTC one", () => {
    // 01:30 UTC of the 6th is still the 5th (22:30) in Asunción (GMT-3).
    expect(dayKey("2026-11-06T01:30:00Z")).toBe("2026-11-05");
    expect(dayKey("2026-11-06T04:00:00Z")).toBe("2026-11-06");
  });
});

describe("buildSettlementDays", () => {
  const entries = [
    entry(1, "2026-11-16T15:00:00Z", { commissionAmount: 29091, itemName: "Brushing" }),
    entry(2, "2026-11-05T15:00:00Z", { commissionAmount: 47273 }),
    entry(3, "2026-11-14T15:00:00Z", { commissionAmount: 163636, itemName: "Mechas" }),
    entry(4, "2026-11-14T15:05:00Z", { commissionAmount: 5909, itemName: "Spray", itemKind: "PRODUCT" }),
    // A sale recalculated from 40 % to 50 %: original, its reversal and the new commission share a line.
    entry(5, "2026-11-16T14:00:00Z", { invoiceLineId: 50, commissionAmount: 18182, reassignable: false }),
    entry(6, "2026-11-16T14:01:00Z", { invoiceLineId: 50, commissionAmount: -18182, sourceType: "REVERSAL", reasonCode: "RECALCULATION", reassignable: false, reversesEntryId: 5 }),
    entry(7, "2026-11-16T14:02:00Z", { invoiceLineId: 50, commissionAmount: 22727, revision: 2 }),
  ];
  const adjustments = [entry(8, "2026-11-16T16:00:00Z", { sourceType: "ADJUSTMENT", invoiceLineId: null, commissionAmount: 50000, note: "bono" })];
  const days = buildSettlementDays(entries, adjustments);

  it("groups by day, oldest first", () => {
    expect(days.map((d) => d.key)).toEqual(["2026-11-05", "2026-11-14", "2026-11-16"]);
  });

  it("counts a recalculated sale once and nets its reversal", () => {
    const last = days[2];
    expect(last.sales).toHaveLength(2); // Brushing + the recalculated sale
    const recalculated = last.sales.find((g) => g.changed)!;
    expect(recalculated.entries).toHaveLength(3);
    expect(recalculated.net).toBe(22727);
    expect(recalculated.current?.id).toBe(7);
  });

  it("puts each adjustment in its day and adds it to the day total", () => {
    expect(days[2].adjustments).toHaveLength(1);
    expect(days[2].total).toBe(29091 + 22727 + 50000);
    expect(days[0].total).toBe(47273);
    expect(days[1].total).toBe(163636 + 5909);
  });

  it("composes services + products + adjustments into the settlement total", () => {
    const c = compose(days);
    expect(c.services).toEqual({ amount: 47273 + 163636 + 29091 + 22727, count: 4 });
    expect(c.products).toEqual({ amount: 5909, count: 1 });
    expect(c.adjustments).toEqual({ amount: 50000, count: 1 });
    expect(c.services.amount + c.products.amount + c.adjustments.amount).toBe(318636);
  });
});
