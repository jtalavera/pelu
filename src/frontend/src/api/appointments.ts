import { femmeJson, femmePostJson, femmePutJson, femmePatchJson } from "./femmeClient";

export type AppointmentStatus =
  | "PENDING"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

export type Appointment = {
  id: number;
  clientId: number | null;
  clientName: string | null;
  professionalId: number;
  professionalName: string;
  serviceId: number;
  serviceName: string;
  durationMinutes: number;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  cancelReason: string | null;
};

export type AppointmentCreateRequest = {
  clientId: number | null;
  professionalId: number;
  serviceId: number;
  startAt: string;
};

export type AppointmentUpdateRequest = {
  clientId: number | null;
  professionalId: number;
  serviceId: number;
  startAt: string;
};

export type AppointmentStatusUpdateRequest = {
  status: AppointmentStatus;
  cancelReason?: string | null;
};

export function listAppointments(
  from: string,
  to: string,
  professionalId?: number | null,
  clientId?: number | null,
): Promise<Appointment[]> {
  const params = new URLSearchParams({ from, to });
  if (professionalId != null) {
    params.set("professionalId", String(professionalId));
  }
  if (clientId != null) {
    params.set("clientId", String(clientId));
  }
  return femmeJson<Appointment[]>(`/api/appointments?${params.toString()}`);
}

export function getAppointment(id: number): Promise<Appointment> {
  return femmeJson<Appointment>(`/api/appointments/${id}`);
}

export function createAppointment(req: AppointmentCreateRequest): Promise<Appointment> {
  return femmePostJson<Appointment>("/api/appointments", req);
}

export function updateAppointmentStatus(
  id: number,
  req: AppointmentStatusUpdateRequest,
): Promise<Appointment> {
  return femmePatchJson<Appointment>(`/api/appointments/${id}/status`, req);
}

export function updateAppointment(id: number, req: AppointmentUpdateRequest): Promise<Appointment> {
  return femmePutJson<Appointment>(`/api/appointments/${id}`, req);
}

export const EDITABLE_STATUSES: AppointmentStatus[] = ["PENDING", "CONFIRMED"];

export const ALL_STATUSES: AppointmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

/** Statuses shown on the week calendar grid (HU-19). */
export const CALENDAR_GRID_STATUSES: AppointmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
];
