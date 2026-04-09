import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  listAppointments,
  createAppointment,
  updateAppointment,
  updateAppointmentStatus,
  getAppointment,
  EDITABLE_STATUSES,
  ALL_STATUSES,
} from "./appointments";

const femmeJsonMock = vi.fn();
const femmePostJsonMock = vi.fn();
const femmePutJsonMock = vi.fn();
const femmePatchJsonMock = vi.fn();

vi.mock("./femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJsonMock(...args),
  femmePostJson: (...args: unknown[]) => femmePostJsonMock(...args),
  femmePutJson: (...args: unknown[]) => femmePutJsonMock(...args),
  femmePatchJson: (...args: unknown[]) => femmePatchJsonMock(...args),
}));

const MOCK_APPOINTMENT = {
  id: 1,
  clientId: null,
  clientName: null,
  professionalId: 10,
  professionalName: "Ana Gomez",
  serviceId: 20,
  serviceName: "Haircut",
  durationMinutes: 60,
  startAt: "2026-04-10T09:00:00Z",
  endAt: "2026-04-10T10:00:00Z",
  status: "PENDING" as const,
  cancelReason: null,
};

describe("appointments API", () => {
  beforeEach(() => {
    femmeJsonMock.mockReset();
    femmePostJsonMock.mockReset();
    femmePutJsonMock.mockReset();
    femmePatchJsonMock.mockReset();
  });

  describe("listAppointments", () => {
    it("calls femmeJson with correct URL without professionalId", async () => {
      femmeJsonMock.mockResolvedValue([MOCK_APPOINTMENT]);
      const result = await listAppointments("2026-04-07T00:00:00Z", "2026-04-14T00:00:00Z");
      expect(femmeJsonMock).toHaveBeenCalledWith(
        expect.stringContaining("from=2026-04-07T00%3A00%3A00Z"),
      );
      expect(femmeJsonMock).toHaveBeenCalledWith(
        expect.stringContaining("to=2026-04-14T00%3A00%3A00Z"),
      );
      expect(result).toEqual([MOCK_APPOINTMENT]);
    });

    it("includes professionalId in URL when provided", async () => {
      femmeJsonMock.mockResolvedValue([]);
      await listAppointments("2026-04-07T00:00:00Z", "2026-04-14T00:00:00Z", 10);
      expect(femmeJsonMock).toHaveBeenCalledWith(
        expect.stringContaining("professionalId=10"),
      );
    });

    it("does not include professionalId when null", async () => {
      femmeJsonMock.mockResolvedValue([]);
      await listAppointments("2026-04-07T00:00:00Z", "2026-04-14T00:00:00Z", null);
      const call = femmeJsonMock.mock.calls[0][0] as string;
      expect(call).not.toContain("professionalId");
    });
  });

  describe("getAppointment", () => {
    it("calls femmeJson with correct path", async () => {
      femmeJsonMock.mockResolvedValue(MOCK_APPOINTMENT);
      const result = await getAppointment(1);
      expect(femmeJsonMock).toHaveBeenCalledWith("/api/appointments/1");
      expect(result).toEqual(MOCK_APPOINTMENT);
    });
  });

  describe("createAppointment", () => {
    it("calls femmePostJson with correct path and body", async () => {
      femmePostJsonMock.mockResolvedValue({ ...MOCK_APPOINTMENT, id: 2 });
      const req = {
        clientId: null,
        professionalId: 10,
        serviceId: 20,
        startAt: "2026-04-10T09:00:00Z",
      };
      const result = await createAppointment(req);
      expect(femmePostJsonMock).toHaveBeenCalledWith("/api/appointments", req);
      expect(result.id).toBe(2);
    });
  });

  describe("updateAppointmentStatus", () => {
    it("calls femmePatchJson with correct path and body", async () => {
      femmePatchJsonMock.mockResolvedValue({ ...MOCK_APPOINTMENT, status: "CONFIRMED" });
      const req = { status: "CONFIRMED" as const };
      const result = await updateAppointmentStatus(1, req);
      expect(femmePatchJsonMock).toHaveBeenCalledWith("/api/appointments/1/status", req);
      expect(result.status).toBe("CONFIRMED");
    });

    it("sends cancelReason when status is CANCELLED", async () => {
      femmePatchJsonMock.mockResolvedValue({ ...MOCK_APPOINTMENT, status: "CANCELLED", cancelReason: "No show" });
      const req = { status: "CANCELLED" as const, cancelReason: "No show" };
      await updateAppointmentStatus(1, req);
      expect(femmePatchJsonMock).toHaveBeenCalledWith("/api/appointments/1/status", req);
    });
  });

  describe("updateAppointment", () => {
    it("calls femmePutJson with correct path and body", async () => {
      femmePutJsonMock.mockResolvedValue(MOCK_APPOINTMENT);
      const req = {
        clientId: null,
        professionalId: 10,
        serviceId: 20,
        startAt: "2026-04-10T10:00:00Z",
      };
      await updateAppointment(1, req);
      expect(femmePutJsonMock).toHaveBeenCalledWith("/api/appointments/1", req);
    });
  });

  describe("EDITABLE_STATUSES", () => {
    it("includes PENDING and CONFIRMED", () => {
      expect(EDITABLE_STATUSES).toContain("PENDING");
      expect(EDITABLE_STATUSES).toContain("CONFIRMED");
    });

    it("does not include COMPLETED or CANCELLED", () => {
      expect(EDITABLE_STATUSES).not.toContain("COMPLETED");
      expect(EDITABLE_STATUSES).not.toContain("CANCELLED");
    });
  });

  describe("ALL_STATUSES", () => {
    it("contains all six appointment statuses", () => {
      expect(ALL_STATUSES).toHaveLength(6);
      expect(ALL_STATUSES).toContain("PENDING");
      expect(ALL_STATUSES).toContain("CONFIRMED");
      expect(ALL_STATUSES).toContain("IN_PROGRESS");
      expect(ALL_STATUSES).toContain("COMPLETED");
      expect(ALL_STATUSES).toContain("CANCELLED");
      expect(ALL_STATUSES).toContain("NO_SHOW");
    });
  });
});
