import { femmeJson, femmePatchJson, femmePostJson, femmePutJson } from "./femmeClient";
import type { PageResponse } from "./pagination";

export type TenantTierChange = {
  changedAt: string;
  changedByEmail: string;
  previousTierName: string | null;
  newTierName: string | null;
};

export type TenantStatus = "ACTIVE" | "SUSPENDED";

export type TenantStatusChange = {
  changedAt: string;
  changedByEmail: string;
  previousStatus: TenantStatus;
  newStatus: TenantStatus;
};

export type PlatformTenant = {
  id: number;
  name: string;
  domain: string | null;
  tierId: number | null;
  tierName: string | null;
  status: TenantStatus;
  lastTierChange: TenantTierChange | null;
  lastStatusChange: TenantStatusChange | null;
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

/** HU-40 AC-1/AC-4: suspend or reactivate a tenant. */
export function updateTenantStatus(id: number, status: TenantStatus): Promise<PlatformTenant> {
  return femmePatchJson<PlatformTenant>(`/api/platform/tenants/${id}/status`, { status });
}

/** HU-41 AC-1/AC-6: response confirming the tenant ADMIN invite was created and emailed. */
export type CreateTenantAdminResult = {
  userId: number;
  email: string;
  invitationSent: boolean;
  rawToken: string;
};

/** HU-41 AC-1/AC-4: Platform Admin creates a tenant ADMIN user and invites them to activate. */
export function createTenantAdmin(
  tenantId: number,
  email: string,
): Promise<CreateTenantAdminResult> {
  return femmePostJson<CreateTenantAdminResult>(`/api/platform/tenants/${tenantId}/admins`, {
    email,
  });
}

/**
 * HU-42 AC-3: one user (admin or professional with access) assigned to a tenant. HU-43: `activated`
 * distinguishes, when `enabled` is false, a user who never completed their invite (still "pending
 * activation") from one who did and was later deactivated (genuinely "disabled").
 */
export type TenantUser = {
  userId: number;
  email: string;
  role: "ADMIN" | "PROFESSIONAL";
  enabled: boolean;
  activated: boolean;
};

/**
 * HU-42 AC-3: lists every user assigned to a tenant, so the Platform Admin can see all admins
 * currently assigned to it (no artificial one-admin limit, AC-1) alongside professionals with
 * login access.
 */
export function listTenantAdmins(tenantId: number): Promise<TenantUser[]> {
  return femmeJson<TenantUser[]>(`/api/platform/tenants/${tenantId}/admins`);
}

/**
 * HU-43 AC-1/AC-3: deactivates or reactivates a single tenant user (admin or professional with
 * access), without affecting the rest of the tenant's users.
 */
export function updateTenantUserStatus(
  tenantId: number,
  userId: number,
  enabled: boolean,
): Promise<TenantUser> {
  return femmePatchJson<TenantUser>(
    `/api/platform/tenants/${tenantId}/admins/${userId}/status`,
    { enabled },
  );
}

/**
 * HU-44 AC-1/AC-2/AC-3/AC-4: confirms a resend action — `passwordReset` tells the caller whether
 * this was a fresh activation invite (user never activated) or a password-reset trigger (user
 * already activated but lost access), so the UI can show the matching confirmation message.
 */
export type ResendInvitationResult = {
  userId: number;
  email: string;
  passwordReset: boolean;
  rawToken: string;
};

/**
 * HU-44 AC-1/AC-2/AC-3: resends the activation invite, or triggers a password reset, for a single
 * tenant user — invalidating any previously issued unused link either way.
 */
export function resendTenantUserInvitation(
  tenantId: number,
  userId: number,
): Promise<ResendInvitationResult> {
  return femmePostJson<ResendInvitationResult>(
    `/api/platform/tenants/${tenantId}/admins/${userId}/resend-invitation`,
    {},
  );
}
