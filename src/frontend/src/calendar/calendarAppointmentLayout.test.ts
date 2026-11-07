import { describe, expect, it } from "vitest";
import {
  appointmentEndMs,
  appointmentsOverlap,
  layoutOverlappingInDay,
  layoutWithOverflow,
  type AppointmentLike,
} from "./calendarAppointmentLayout";

function appt(id: number, start: string, durationMinutes: number): AppointmentLike {
  return { id, startAt: start, durationMinutes };
}

describe("calendarAppointmentLayout", () => {
  it("computes end time from start and duration", () => {
    const a = appt(1, "2026-04-15T10:00:00.000Z", 60);
    const start = new Date(a.startAt).getTime();
    expect(appointmentEndMs(a)).toBe(start + 60 * 60_000);
  });

  it("detects overlapping intervals", () => {
    const a = appt(1, "2026-04-15T10:00:00.000Z", 60);
    const b = appt(2, "2026-04-15T10:30:00.000Z", 60);
    expect(appointmentsOverlap(a, b)).toBe(true);
  });

  it("detects non-overlapping intervals", () => {
    const a = appt(1, "2026-04-15T10:00:00.000Z", 60);
    const b = appt(2, "2026-04-15T11:00:00.000Z", 30);
    expect(appointmentsOverlap(a, b)).toBe(false);
  });

  it("assigns two columns when two appointments overlap", () => {
    const a = appt(1, "2026-04-15T10:00:00.000Z", 60);
    const b = appt(2, "2026-04-15T10:30:00.000Z", 60);
    const layout = layoutOverlappingInDay([a, b]);
    expect(layout.get(1)?.slotCount).toBe(2);
    expect(layout.get(2)?.slotCount).toBe(2);
    expect([layout.get(1)?.col, layout.get(2)?.col].sort()).toEqual([0, 1]);
  });

  it("uses one column when appointments do not overlap", () => {
    const a = appt(1, "2026-04-15T10:00:00.000Z", 60);
    const b = appt(2, "2026-04-15T12:00:00.000Z", 60);
    const layout = layoutOverlappingInDay([a, b]);
    expect(layout.get(1)?.slotCount).toBe(1);
    expect(layout.get(2)?.slotCount).toBe(1);
    expect(layout.get(1)?.col).toBe(0);
    expect(layout.get(2)?.col).toBe(0);
  });
});

describe("layoutWithOverflow", () => {
  it("folds a cluster that needs more than two columns into one group and leaves the rest alone", () => {
    const list = [
      appt(1, "2026-04-15T10:00:00.000Z", 60),
      appt(2, "2026-04-15T10:00:00.000Z", 60),
      appt(3, "2026-04-15T10:00:00.000Z", 60),
      appt(4, "2026-04-15T13:00:00.000Z", 60),
    ];
    const { layout, groups } = layoutWithOverflow(list, 2);
    // The crowded hour is ONE group (none of its turnos is drawn on its own)...
    expect(layout.has(1)).toBe(false);
    expect(layout.has(2)).toBe(false);
    expect(layout.has(3)).toBe(false);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(groups[0].anchorId).toBe(1);
    // ...and the lone turno keeps its normal card.
    expect(layout.get(4)).toEqual({ col: 0, slotCount: 1 });
  });

  it("makes no group when two turnos at once are enough", () => {
    const { layout, groups } = layoutWithOverflow(
      [appt(1, "2026-04-15T10:00:00.000Z", 60), appt(2, "2026-04-15T10:30:00.000Z", 60)],
      2,
    );
    expect(groups).toHaveLength(0);
    expect(layout.get(1)).toEqual({ col: 0, slotCount: 2 });
    expect(layout.get(2)).toEqual({ col: 1, slotCount: 2 });
  });
});
