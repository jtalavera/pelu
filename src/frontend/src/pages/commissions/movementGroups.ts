import type { EntryView } from "../../api/commissions";

/**
 * HU-COM-29: a sale whose commission was recalculated (or reassigned, or whose invoice was voided) leaves several
 * entries: the original, its reversal and the new one. They are shown as ONE movement with the commission that is
 * in force, and the others as its history.
 */
export type MovementGroup = {
  key: string;
  /** What the row shows: the commission in force or, with none, the last one that existed. */
  rep: EntryView;
  /** The commission in force (a live invoice line), or null when everything was reversed. */
  current: EntryView | null;
  /** All the entries of the sale, oldest first (the reversal sits right after the line it undoes). */
  entries: EntryView[];
  /** What the sale really adds up to: reversals subtract what they undo. */
  net: number;
  retained: number;
  /** More than one entry: it has a history to show. */
  changed: boolean;
  /** Why the latest reversal happened (RECALCULATION, REASSIGNMENT, VOID, CORRECTION…), if any. */
  reason: string | null;
};

const byTime = (a: EntryView, b: EntryView) => {
  const d = Date.parse(a.accrualAt) - Date.parse(b.accrualAt);
  return d !== 0 ? d : a.id - b.id;
};

/** Groups the entries of one invoice line; adjustments and entries without a line stay on their own. */
export function groupMovements(entries: EntryView[]): MovementGroup[] {
  const buckets = new Map<string, EntryView[]>();
  for (const e of entries) {
    const grouped = e.invoiceLineId != null && (e.sourceType === "INVOICE_LINE" || e.sourceType === "REVERSAL");
    const key = grouped ? `line:${e.invoiceLineId}` : `entry:${e.id}`;
    const list = buckets.get(key);
    if (list) list.push(e);
    else buckets.set(key, [e]);
  }
  const groups: MovementGroup[] = [];
  for (const [key, list] of buckets) {
    const sorted = [...list].sort(byTime);
    const current = sorted.find((e) => e.sourceType === "INVOICE_LINE" && e.reassignable) ?? null;
    const lines = sorted.filter((e) => e.sourceType === "INVOICE_LINE");
    const rep = current ?? lines[lines.length - 1] ?? sorted[sorted.length - 1];
    const reversals = sorted.filter((e) => e.sourceType === "REVERSAL");
    groups.push({
      key,
      rep,
      current,
      entries: sorted,
      net: sorted.reduce((s, e) => s + e.commissionAmount, 0),
      retained: sorted.reduce((s, e) => s + e.retentionAmount, 0),
      changed: sorted.length > 1,
      reason: reversals.length > 0 ? (reversals[reversals.length - 1].reasonCode ?? null) : null,
    });
  }
  return groups;
}
