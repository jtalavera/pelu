/** Pure helpers for overlapping appointment cards in the calendar day column (HU-19). */

export type AppointmentLike = {
  id: number;
  startAt: string;
  durationMinutes: number;
};

export type AppointmentLayoutSlot = {
  col: number;
  slotCount: number;
};

export function appointmentEndMs(a: AppointmentLike): number {
  return new Date(a.startAt).getTime() + a.durationMinutes * 60_000;
}

export function appointmentsOverlap(a: AppointmentLike, b: AppointmentLike): boolean {
  const as = new Date(a.startAt).getTime();
  const ae = appointmentEndMs(a);
  const bs = new Date(b.startAt).getTime();
  const be = appointmentEndMs(b);
  return as < be && bs < ae;
}

/**
 * Assigns horizontal columns for overlapping intervals and a shared slot count per connected overlap group,
 * so cards can use width 100/slotCount and left offset col/slotCount.
 */
export function layoutOverlappingInDay(appts: AppointmentLike[]): Map<number, AppointmentLayoutSlot> {
  const result = new Map<number, AppointmentLayoutSlot>();
  if (appts.length === 0) return result;

  const sorted = [...appts].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );

  type Active = { endMs: number; col: number };
  const active: Active[] = [];
  const colById = new Map<number, number>();

  for (const a of sorted) {
    const startMs = new Date(a.startAt).getTime();
    const endMs = appointmentEndMs(a);
    const still: Active[] = [];
    for (const x of active) {
      if (x.endMs > startMs) still.push(x);
    }
    active.length = 0;
    active.push(...still);

    const used = new Set(active.map((x) => x.col));
    let col = 0;
    while (used.has(col)) col += 1;
    active.push({ endMs, col });
    colById.set(a.id, col);
  }

  const idToIdx = new Map<number, number>();
  appts.forEach((a, i) => idToIdx.set(a.id, i));
  const parent = appts.map((_, i) => i);

  function find(i: number): number {
    return parent[i] === i ? i : (parent[i] = find(parent[i]));
  }

  function union(i: number, j: number): void {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  for (let i = 0; i < appts.length; i++) {
    for (let j = i + 1; j < appts.length; j++) {
      if (appointmentsOverlap(appts[i], appts[j])) union(i, j);
    }
  }

  const slotCountByRoot = new Map<number, number>();
  for (let i = 0; i < appts.length; i++) {
    const r = find(i);
    const c = colById.get(appts[i].id) ?? 0;
    slotCountByRoot.set(r, Math.max(slotCountByRoot.get(r) ?? 0, c + 1));
  }

  for (const a of appts) {
    const idx = idToIdx.get(a.id) ?? 0;
    const r = find(idx);
    const slotCount = Math.max(1, slotCountByRoot.get(r) ?? 1);
    result.set(a.id, { col: colById.get(a.id) ?? 0, slotCount });
  }

  return result;
}
