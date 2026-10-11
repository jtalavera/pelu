import { femmeJson } from "./femmeClient";

/** HU-65: short-lived handoff token for the Stock SPA. */
export type StockSsoToken = { token: string; expiresInSeconds: number };

export function requestStockSso(): Promise<StockSsoToken> {
  return femmeJson<StockSsoToken>("/api/sso/stock", { method: "POST" });
}

/** HU-66: availability of the products among `serviceIds`. */
export type StockAvailabilityItem = {
  serviceId: number;
  mapped: boolean;
  available: number | null;
  onHand: number | null;
  uom: string | null;
  belowMinimum: boolean | null;
};

export type StockAvailabilityResponse = {
  enabled: boolean;
  unavailable: boolean;
  items: StockAvailabilityItem[];
};

export function fetchStockAvailability(serviceIds: number[]): Promise<StockAvailabilityResponse> {
  const qs = new URLSearchParams({ serviceIds: serviceIds.join(",") });
  return femmeJson<StockAvailabilityResponse>(`/api/stock/availability?${qs.toString()}`, {
    json: false,
  });
}

/** One line of a delivery's history: a code plus parameters, translated by the UI. */
export type StockOutboxMessage = {
  at: string;
  level: "INFO" | "WARN" | "ERROR";
  code: string;
  params: Record<string, string | number | null | undefined>;
};

/** HU-67: platform outbox panel. */
export type StockOutboxRow = {
  id: number;
  tenantId: number;
  tenantName: string;
  eventType: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  nextAttemptAt: string | null;
  doneAt: string | null;
  idempotencyKey: string;
  /** Everything that happened to this delivery, oldest first (empty for pre-history rows). */
  messages: StockOutboxMessage[];
  /** Id of the earlier open delivery of the same salon this one is waiting behind, if any. */
  blockedByEventId: number | null;
};

export type StockOutboxPage = {
  content: StockOutboxRow[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export function listStockOutbox(params: {
  tenantId?: number | null;
  status?: string | null;
  page: number;
  size: number;
}): Promise<StockOutboxPage> {
  const qs = new URLSearchParams({ page: String(params.page), size: String(params.size) });
  if (params.tenantId != null) qs.set("tenantId", String(params.tenantId));
  if (params.status) qs.set("status", params.status);
  return femmeJson<StockOutboxPage>(`/api/platform/stock/outbox?${qs.toString()}`, { json: false });
}

export function retryStockOutboxEvent(id: number): Promise<StockOutboxRow> {
  return femmeJson<StockOutboxRow>(`/api/platform/stock/outbox/${id}/retry`, { method: "POST" });
}

export function discardStockOutboxEvent(id: number): Promise<StockOutboxRow> {
  return femmeJson<StockOutboxRow>(`/api/platform/stock/outbox/${id}/discard`, { method: "POST" });
}

export type StockOutboxSummary = { failed: number; pending: number };

export function fetchStockOutboxSummary(): Promise<StockOutboxSummary> {
  return femmeJson<StockOutboxSummary>("/api/platform/stock/summary", { json: false });
}

/** HU-62: per-tenant Stock status + manual catalog sync. */
export type TenantStockStatus = {
  tenantId: number;
  stockEnabled: boolean;
  linked: boolean;
  provisionedAt: string | null;
  catalogSyncedAt: string | null;
  flagsVersion: number;
  lastError: string | null;
  failedEvents: number;
};

export function fetchTenantStockStatus(tenantId: number): Promise<TenantStockStatus> {
  return femmeJson<TenantStockStatus>(`/api/platform/tenants/${tenantId}/stock`, { json: false });
}

export function requestTenantCatalogSync(tenantId: number): Promise<TenantStockStatus> {
  return femmeJson<TenantStockStatus>(`/api/platform/tenants/${tenantId}/stock/catalog-sync`, {
    method: "POST",
  });
}
