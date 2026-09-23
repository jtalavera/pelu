import { femmeJson, femmePostJson } from "./femmeClient";
import { authHeaders } from "./authHeaders";
import { apiBaseUrl } from "./baseUrl";
import type { PageResponse } from "./pagination";

export type TipReportRow = {
  professionalId: number;
  professionalName: string;
  amount: number;
  clientName: string;
  serviceDateTime: string;
};

export type TipReportProfessionalTotal = {
  professionalId: number;
  professionalName: string;
  total: number;
};

export type TipReportResponse = {
  rows: TipReportRow[];
  professionalTotals: TipReportProfessionalTotal[];
  grandTotal: number;
  withdrawalsTotal: number;
  withdrawalsByProfessional: TipReportProfessionalTotal[];
};

export type ProfessionalTipBalance = {
  professionalId: number;
  professionalName: string;
  balance: number;
};

export type TipWithdrawalHistoryItem = {
  id: number;
  professionalName: string;
  amount: number;
  withdrawnAt: string;
};

export type CreateTipWithdrawalResponse = {
  withdrawal: TipWithdrawalHistoryItem;
  newBalance: number;
};

export type TipsReportParams = {
  from?: string;
  to?: string;
  professionalIds?: number[];
};

function buildReportQuery(params: TipsReportParams): string {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.professionalIds && params.professionalIds.length > 0) {
    qs.set("professionalIds", params.professionalIds.join(","));
  }
  return qs.toString();
}

export function getTipsReport(params: TipsReportParams): Promise<TipReportResponse> {
  return femmeJson<TipReportResponse>(`/api/propinas/report?${buildReportQuery(params)}`);
}

/** Fetches the tips report PDF and triggers a browser file download on success. */
export async function downloadTipsReportPdf(params: TipsReportParams): Promise<void> {
  const url = `${apiBaseUrl()}/api/propinas/report/pdf?${buildReportQuery(params)}`;
  const res = await fetch(url, { headers: authHeaders({ json: false }) });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filenameFromContentDisposition(res.headers.get("Content-Disposition")) ?? "propinas.pdf";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

function filenameFromContentDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = contentDisposition.match(/filename="?([^"]+)"?/);
  return match ? match[1] : null;
}

export function getProfessionalTipBalance(professionalId: number): Promise<ProfessionalTipBalance> {
  return femmeJson<ProfessionalTipBalance>(`/api/propinas/balance?professionalId=${professionalId}`);
}

export function createTipWithdrawal(
  professionalId: number,
  amount: number,
): Promise<CreateTipWithdrawalResponse> {
  return femmePostJson<CreateTipWithdrawalResponse>("/api/propinas/withdrawals", {
    professionalId,
    amount,
  });
}

export type ListTipWithdrawalsParams = {
  /** Omit to get the tenant-wide history (all professionals) for the last 3 months. */
  professionalId?: number;
  page?: number;
  size?: number;
};

export function listTipWithdrawalsPaged(
  params: ListTipWithdrawalsParams,
): Promise<PageResponse<TipWithdrawalHistoryItem>> {
  const qs = new URLSearchParams();
  if (params.professionalId != null) qs.set("professionalId", String(params.professionalId));
  if (params.page != null) qs.set("page", String(params.page));
  if (params.size != null) qs.set("size", String(params.size));
  return femmeJson<PageResponse<TipWithdrawalHistoryItem>>(`/api/propinas/withdrawals?${qs.toString()}`);
}
