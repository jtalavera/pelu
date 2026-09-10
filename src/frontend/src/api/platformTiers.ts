import { femmeDeleteJson, femmeJson, femmePostJson, femmePutJson } from "./femmeClient";

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

/**
 * HU-46 (Épica D — Tiers y Feature Flags): a tier's feature-flag matrix — every global flag with
 * the global default, this tier's value for it, the effective value at the tier level
 * (`globalEnabled && tierEnabled`, HU-47's conjunctive resolution), and the last time it changed.
 */
export type TierFeatureFlagChange = {
  changedAt: string;
  changedByEmail: string;
  previousIncluded: boolean;
  newIncluded: boolean;
};

export type TierFeatureFlagRow = {
  flagKey: string;
  description: string | null;
  globalEnabled: boolean;
  tierEnabled: boolean;
  effectiveEnabled: boolean;
  lastChange: TierFeatureFlagChange | null;
};

export function listTierFeatureFlags(tierId: number): Promise<TierFeatureFlagRow[]> {
  return femmeJson<TierFeatureFlagRow[]>(`/api/platform/tiers/${tierId}/feature-flags`);
}

/** HU-46 AC-1/AC-2: sets this tier's value (ON/OFF) for a flag. OFF restricts it for the tier's tenants. */
export function setTierFeatureFlagValue(
  tierId: number,
  flagKey: string,
  enabled: boolean,
): Promise<void> {
  return femmePutJson<void>(
    `/api/platform/tiers/${tierId}/feature-flags/${encodeURIComponent(flagKey)}`,
    { enabled },
  );
}
