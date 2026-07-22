import { femmeJson, femmePostJson, femmePutJson } from "./femmeClient";

export type ServiceRecordLine = {
  id: number;
  serviceId: number;
  description: string;
  unitPrice: string;
  professionalId: number;
  professionalName: string;
};

export type ServiceRecordTip = {
  professionalId: number;
  professionalName: string;
  amount: string;
};

export type ServiceRecordDetail = {
  id: number;
  clientId: number;
  clientFullName: string;
  status: "OPEN" | "CLOSED" | "VOIDED";
  totalAmount: string;
  tipsTotal: string;
  voidReason: string | null;
  createdAt: string;
  closedAt: string | null;
  invoiceId: number | null;
  invoiceNumberFormatted: string | null;
  lines: ServiceRecordLine[];
  tips: ServiceRecordTip[];
};

export type ServiceRecordListItem = {
  id: number;
  clientId: number;
  clientFullName: string;
  status: "OPEN" | "CLOSED" | "VOIDED";
  totalAmount: string;
  createdAt: string;
};

export type PagedServiceRecordsResponse = {
  content: ServiceRecordListItem[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type ServiceRecordLineInput = { serviceId: number; professionalId: number };
export type ServiceRecordTipInput = { professionalId: number; amount: number };

export type ServiceRecordSaveRequest = {
  clientId: number;
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
