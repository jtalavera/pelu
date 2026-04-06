import { apiBaseUrl } from "../api/baseUrl";
import { authHeaders } from "../api/authHeaders";

export type TenantAdminTenant = {
  tenantId: number;
  shortName: string;
  legalName: string;
};

export type PostLoginMe = {
  privileged: boolean;
  tenantAdminTenants: TenantAdminTenant[];
};

/** Loads current user after access token is in sessionStorage. */
export async function fetchPostLoginMe(): Promise<PostLoginMe | null> {
  const res = await fetch(`${apiBaseUrl()}/api/me`, {
    headers: authHeaders({ json: false }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    privileged?: boolean;
    tenantAdminTenants?: TenantAdminTenant[];
  };
  return {
    privileged: !!data.privileged,
    tenantAdminTenants: Array.isArray(data.tenantAdminTenants) ? data.tenantAdminTenants : [],
  };
}

/** @deprecated Prefer fetchPostLoginMe for tenant-admin routing. */
export async function fetchPrivilegedFlag(): Promise<boolean> {
  const me = await fetchPostLoginMe();
  return me?.privileged ?? false;
}

/** Safe path from React Router `location.state.from.pathname`. */
export function safeReturnPath(fromPathname: string | undefined): string {
  const raw = fromPathname;
  if (raw && raw !== "/login" && raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return "/";
}

/**
 * After sign-in: honour safe return path when present (UH-7). Sysadmins default to `/admin`.
 * Active tenant administrators default to their first tenant admin workspace when the return
 * path is the generic home `/` (UH-33).
 */
export function targetAfterLogin(opts: {
  privileged: boolean;
  tenantAdminTenants: TenantAdminTenant[];
  fromPathname: string | undefined;
}): string {
  const safe = safeReturnPath(opts.fromPathname);
  if (opts.privileged) {
    if (safe.startsWith("/admin")) return safe;
    return "/admin";
  }
  if (safe !== "/") {
    return safe;
  }
  if (opts.tenantAdminTenants.length > 0) {
    return `/tenant-admin/${opts.tenantAdminTenants[0].tenantId}`;
  }
  return "/";
}
