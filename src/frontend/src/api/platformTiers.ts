import {
  femmeDeleteJson,
  femmeJson,
  femmePostJson,
  femmePutJson,
} from "./femmeClient";

/**
 * HU-45 (Épica D — Tiers y Feature Flags): full tier CRUD for the Platform Admin. `tenantCount`
 * drives both the listing (AC-4) and the "N tenants use this tier" message on a blocked deletion
 * (AC-3) — no extra round-trip needed since it's already on the row the delete action was clicked
 * from.
 */
export type PlatformTier = {
  id: number;
  name: string;
  description: string | null;
  tenantCount: number;
};

export function listPlatformTiers(): Promise<PlatformTier[]> {
  return femmeJson<PlatformTier[]>("/api/platform/tiers");
}

export type CreateTierPayload = {
  name: string;
  description: string | null;
};

export function createPlatformTier(payload: CreateTierPayload): Promise<PlatformTier> {
  return femmePostJson<PlatformTier>("/api/platform/tiers", payload);
}

export type UpdateTierPayload = {
  name: string;
  description: string | null;
};

export function updatePlatformTier(
  id: number,
  payload: UpdateTierPayload,
): Promise<PlatformTier> {
  return femmePutJson<PlatformTier>(`/api/platform/tiers/${id}`, payload);
}

/** HU-45 AC-3: rejected (409 `TIER_IN_USE`) when at least one tenant uses this tier. */
export function deletePlatformTier(id: number): Promise<void> {
  return femmeDeleteJson<void>(`/api/platform/tiers/${id}`);
}
