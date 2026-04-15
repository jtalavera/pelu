import { describe, expect, it } from "vitest";
import {
  appointmentEndMs,
  appointmentsOverlap,
  layoutOverlappingInDay,
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
