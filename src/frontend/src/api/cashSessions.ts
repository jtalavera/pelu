import { femmeJson, femmePostJson } from "./femmeClient";
import type { PageResponse } from "./pagination";

export type CashSession = {
  id: number;
  tenantId: number;
  openedByUserId: number;
  openedByEmail: string;
  openedAt: string;
  openingCashAmount: string;
  isOpen: boolean;
};

export type CashMovementType = "MANUAL_IN" | "MANUAL_OUT" | "TIP_WITHDRAWAL_OUT";

export type CashMovement = {
  id: number;
  cashSessionId: number;
  type: CashMovementType;
  amount: string;
  reason: string | null;
  createdByEmail: string | null;
  createdAt: string;
  tipWithdrawalId: number | null;
};

export type CashSessionDetail = {
  id: number;
  tenantId: number;
  openedAt: string;
  openedByEmail: string;
  closedAt: string | null;
  closedByEmail: string | null;
  openingCashAmount: string;
  countedCashAmount: string | null;
  expectedCashAmount: string;
  cashDifference: string | null;
  totalInvoiced: string;
  invoiceCount: number;
  paymentSummary: Array<{ method: string; total: string }>;
  movements: CashMovement[];
  isOpen: boolean;
};

export type CashSessionListItem = {
  id: number;
  openedAt: string;
  closedAt: string | null;
  openedByEmail: string;
  closedByEmail: string | null;
  openingCashAmount: string;
  countedCashAmount: string | null;
  expectedCashAmount: string;
  cashDifference: string | null;
  isOpen: boolean;
};

export type CreateCashMovementRequest = {
  type: Extract<CashMovementType, "MANUAL_IN" | "MANUAL_OUT">;
  amount: number;
  reason: string;
};

export function getCurrentSession(): Promise<CashSession | undefined> {
  return femmeJson<CashSession | undefined>("/api/cash-sessions/current");
}

export function openSession(openingCashAmount: number): Promise<CashSession> {
  return femmePostJson<CashSession>("/api/cash-sessions/open", { openingCashAmount });
}

export function closeSession(countedCashAmount: number): Promise<CashSessionDetail> {
  return femmePostJson<CashSessionDetail>("/api/cash-sessions/close", { countedCashAmount });
}

export function createMovement(request: CreateCashMovementRequest): Promise<CashMovement> {
  return femmePostJson<CashMovement>("/api/cash-sessions/current/movements", request);
}

export function listMovements(sessionId: number): Promise<CashMovement[]> {
  return femmeJson<CashMovement[]>(`/api/cash-sessions/${sessionId}/movements`);
}

export function getSessionDetail(sessionId: number): Promise<CashSessionDetail> {
  return femmeJson<CashSessionDetail>(`/api/cash-sessions/${sessionId}`);
}

export type ListCashSessionsParams = {
  from?: string;
  to?: string;
  status?: "OPEN" | "CLOSED";
  q?: string;
  page?: number;
  size?: number;
};

export function listCashSessionsPaged(
  params: ListCashSessionsParams,
  signal?: AbortSignal,
): Promise<PageResponse<CashSessionListItem>> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  if (params.page != null) qs.set("page", String(params.page));
  if (params.size != null) qs.set("size", String(params.size));
  return femmeJson<PageResponse<CashSessionListItem>>(`/api/cash-sessions?${qs.toString()}`, {
    signal,
  });
}
