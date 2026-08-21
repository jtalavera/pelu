import { femmeJson, femmePostJson, femmePutJson } from "./femmeClient";
import type { PageResponse } from "./pagination";

export type TenantTierChange = {
  changedAt: string;
  changedByEmail: string;
  previousTierName: string | null;
  newTierName: string | null;
};

export type PlatformTenant = {
  id: number;
  name: string;
  domain: string | null;
  tierId: number | null;
  tierName: string | null;
  status: "ACTIVE" | "SUSPENDED";
  lastTierChange: TenantTierChange | null;
};

export type TierOption = {
  id: number;
  name: string;
};

export type ListTenantsPagedParams = {
  page?: number;
  size?: number;
  /** HU-39 AC-2: filters by name or domain, server-side. */
  q?: string;
};

export function listTenantsPaged(
  params: ListTenantsPagedParams,
): Promise<PageResponse<PlatformTenant>> {
  const qs = new URLSearchParams();
  if (params.page != null) qs.set("page", String(params.page));
  if (params.size != null) qs.set("size", String(params.size));
  if (params.q != null && params.q.trim().length > 0) qs.set("q", params.q.trim());
  return femmeJson<PageResponse<PlatformTenant>>(`/api/platform/tenants?${qs.toString()}`);
}

export function listTiers(): Promise<TierOption[]> {
  return femmeJson<TierOption[]>("/api/platform/tenants/tiers");
}

export type CreateTenantPayload = {
  name: string;
  domain: string | null;
  tierId: number | null;
};

export function createTenant(payload: CreateTenantPayload): Promise<PlatformTenant> {
  return femmePostJson<PlatformTenant>("/api/platform/tenants", payload);
}

export type UpdateTenantPayload = {
  name: string;
  domain: string | null;
  tierId: number | null;
};

export function updateTenant(
  id: number,
  payload: UpdateTenantPayload,
): Promise<PlatformTenant> {
  return femmePutJson<PlatformTenant>(`/api/platform/tenants/${id}`, payload);
}
