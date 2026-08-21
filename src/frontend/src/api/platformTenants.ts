import { femmeJson, femmePostJson } from "./femmeClient";
import type { PageResponse } from "./pagination";

export type PlatformTenant = {
  id: number;
  name: string;
  domain: string | null;
  tierId: number | null;
  tierName: string | null;
  status: "ACTIVE" | "SUSPENDED";
};

export type TierOption = {
  id: number;
  name: string;
};

export type ListTenantsPagedParams = {
  page?: number;
  size?: number;
};

export function listTenantsPaged(
  params: ListTenantsPagedParams,
): Promise<PageResponse<PlatformTenant>> {
  const qs = new URLSearchParams();
  if (params.page != null) qs.set("page", String(params.page));
  if (params.size != null) qs.set("size", String(params.size));
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
