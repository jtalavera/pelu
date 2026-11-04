import { femmeJson, femmePostJson, femmePutJson } from "./femmeClient";
import type { SalonServiceOption } from "../components/ServiceSearchField";

export type ServiceRecordLine = {
  id: number;
  serviceId: number;
  description: string;
  /** `null` for a professional: she never receives amounts. */
  unitPrice: string | null;
  quantity: number;
  lineTotal: string | null;
  professionalId: number | null;
  professionalName: string | null;
};

export type ServiceRecordTip = {
  professionalId: number;
  professionalName: string;
  amount: string | null;
};

export type ServiceRecordDetail = {
  id: number;
  clientId: number;
  clientFullName: string;
  clientRuc: string | null;
  status: "OPEN" | "CLOSED" | "VOIDED";
  totalAmount: string | null;
  tipsTotal: string | null;
  voidReason: string | null;
  createdAt: string;
  closedAt: string | null;
  invoiceId: number | null;
  invoiceNumberFormatted: string | null;
  lines: ServiceRecordLine[];
  tips: ServiceRecordTip[];
  /** The turno this ficha belongs to (null for a ficha without turno). */
  appointmentId?: number | null;
  appointmentStartAt?: string | null;
  /** Belongs to the generic "cliente ocasional": show the translated label, not clientFullName. */
  clientGeneric?: boolean;
};

export type ServiceRecordListItem = {
  id: number;
  clientId: number;
  clientFullName: string;
  status: "OPEN" | "CLOSED" | "VOIDED";
  totalAmount: string | null;
  createdAt: string;
  /** Distinct service names on the record, comma-separated. */
  servicesSummary?: string | null;
  /** Distinct professional names on the record, comma-separated. */
  professionalsSummary?: string | null;
  appointmentId?: number | null;
  appointmentStartAt?: string | null;
  clientGeneric?: boolean;
};

export type PagedServiceRecordsResponse = {
  content: ServiceRecordListItem[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type ServiceRecordLineInput = {
  serviceId: number;
  professionalId: number | null;
  quantity: number | null;
  unitPrice: number | null;
};
export type ServiceRecordTipInput = { professionalId: number; amount: number };

export type ServiceRecordSaveRequest = {
  /** null = the generic "cliente ocasional" (the server resolves it). */
  clientId: number | null;
  lines: ServiceRecordLineInput[];
  tips: ServiceRecordTipInput[];
};

export type ListServiceRecordsParams = {
  from?: string;
  to?: string;
  clientId?: number | null;
  status?: string | null;
  q?: string | null;
  page?: number;
  size?: number;
};

export function listServiceRecordsPaged(
  params: ListServiceRecordsParams,
): Promise<PagedServiceRecordsResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.clientId != null) qs.set("clientId", String(params.clientId));
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  if (params.page != null) qs.set("page", String(params.page));
  if (params.size != null) qs.set("size", String(params.size));
  return femmeJson<PagedServiceRecordsResponse>(`/api/service-records?${qs.toString()}`);
}

export function getServiceRecord(id: number): Promise<ServiceRecordDetail> {
  return femmeJson<ServiceRecordDetail>(`/api/service-records/${id}`);
}

export function createServiceRecord(
  request: ServiceRecordSaveRequest,
): Promise<ServiceRecordDetail> {
  return femmePostJson<ServiceRecordDetail>("/api/service-records", request);
}

export function updateServiceRecord(
  id: number,
  request: ServiceRecordSaveRequest,
): Promise<ServiceRecordDetail> {
  return femmePutJson<ServiceRecordDetail>(`/api/service-records/${id}`, request);
}

export function voidServiceRecord(id: number, voidReason: string): Promise<ServiceRecordDetail> {
  return femmePostJson<ServiceRecordDetail>(`/api/service-records/${id}/void`, { voidReason });
}

/** Creates the ficha of a turno (client, service and professional of the turno); starts the turno. */
export function createServiceRecordFromAppointment(appointmentId: number): Promise<ServiceRecordDetail> {
  return femmePostJson<ServiceRecordDetail>(`/api/appointments/${appointmentId}/service-record`, {});
}

/** Assigns an open ficha of the turno's client to the turno; starts the turno. */
export function assignServiceRecordToAppointment(
  appointmentId: number,
  serviceRecordId: number,
): Promise<ServiceRecordDetail> {
  return femmePostJson<ServiceRecordDetail>(`/api/appointments/${appointmentId}/service-record/assign`, {
    serviceRecordId,
  });
}

/** Open fichas of today, of the turno's client, that no turno has taken yet. */
export function listAssignableServiceRecords(appointmentId: number): Promise<ServiceRecordListItem[]> {
  return femmeJson<ServiceRecordListItem[]>(`/api/appointments/${appointmentId}/service-record/candidates`);
}

/** The salon's most-used services (last 90 days) for one-tap adding to a ficha. */
export function getFrequentServices(limit = 3): Promise<SalonServiceOption[]> {
  return femmeJson<SalonServiceOption[]>(`/api/service-records/frequent-services?limit=${limit}`);
}
