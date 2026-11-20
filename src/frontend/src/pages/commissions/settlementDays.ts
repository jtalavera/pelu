import type { EntryView } from "../../api/commissions";
import { PARAGUAY_TIMEZONE } from "../../lib/paraguayDateTime";
import { groupMovements, type MovementGroup } from "./movementGroups";

/** HU-COM-32: everything a settlement holds, grouped by the day it happened (Paraguay time), oldest first. */
export type SettlementDay = {
  /** YYYY-MM-DD */
  key: string;
  /** An instant inside the day, to format its label. */
  iso: string;
  sales: MovementGroup[];
  adjustments: EntryView[];
  /** What the day adds up to: the net of its sales plus its adjustments. */
  total: number;
};

export type Composition = {
  services: { amount: number; count: number };
  products: { amount: number; count: number };
  adjustments: { amount: number; count: number };
};

const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: PARAGUAY_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? DAY_FORMAT.format(d) : iso.slice(0, 10);
}

const byTime = (a: { iso: string; id: number }, b: { iso: string; id: number }) => {
  const d = Date.parse(a.iso) - Date.parse(b.iso);
  return d !== 0 ? d : a.id - b.id;
};

export function buildSettlementDays(entries: EntryView[], adjustments: EntryView[]): SettlementDay[] {
  const days = new Map<string, SettlementDay>();
  const dayOf = (iso: string) => {
    const key = dayKey(iso);
    let day = days.get(key);
    if (!day) {
      day = { key, iso, sales: [], adjustments: [], total: 0 };
      days.set(key, day);
    }
    return day;
  };
  for (const g of groupMovements(entries)) {
    const day = dayOf(g.rep.accrualAt);
    day.sales.push(g);
    day.total += g.net;
  }
  for (const a of adjustments) {
    const day = dayOf(a.accrualAt);
    day.adjustments.push(a);
    day.total += a.commissionAmount;
  }
  const list = [...days.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const day of list) {
    day.sales.sort((a, b) => byTime({ iso: a.rep.accrualAt, id: a.rep.id }, { iso: b.rep.accrualAt, id: b.rep.id }));
    day.adjustments.sort((a, b) => byTime({ iso: a.accrualAt, id: a.id }, { iso: b.accrualAt, id: b.id }));
  }
  return list;
}

/** Services + products + adjustments: the sum that makes the settlement total. */
export function compose(days: SettlementDay[]): Composition {
  const out: Composition = {
    services: { amount: 0, count: 0 },
    products: { amount: 0, count: 0 },
    adjustments: { amount: 0, count: 0 },
  };
  for (const day of days) {
    for (const g of day.sales) {
      const bucket = g.rep.itemKind === "PRODUCT" ? out.products : out.services;
      bucket.amount += g.net;
      bucket.count += 1;
    }
    for (const a of day.adjustments) {
      out.adjustments.amount += a.commissionAmount;
      out.adjustments.count += 1;
    }
  }
  return out;
}
