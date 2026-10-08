import { femmeJson, femmePostJson } from "./femmeClient";

/** A CSC loaded for a tenant. The secret value is write-only: the API never returns it. */
export type SifenCscRow = {
  idCsc: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * The salon's administrator reads their own tenant's CSCs (read-only, no `tenantId`); loading and
 * activating them is ONLY for the platform's root user, for a given tenant, through the platform
 * area — there is deliberately no tenant-side write.
 */
function base(tenantId?: number): string {
  return tenantId != null ? `/api/platform/tenants/${tenantId}/sifen/csc` : "/api/sifen/csc";
}

export function listSifenCsc(tenantId?: number): Promise<SifenCscRow[]> {
  return femmeJson<SifenCscRow[]>(base(tenantId));
}

export function saveSifenCsc(tenantId: number, idCsc: number, csc: string): Promise<SifenCscRow> {
  return femmePostJson<SifenCscRow>(base(tenantId), { idCsc, csc });
}

export function activateSifenCsc(tenantId: number, idCsc: number): Promise<SifenCscRow> {
  return femmePostJson<SifenCscRow>(`${base(tenantId)}/${idCsc}/activate`, {});
}

export type SifenEnvironment = "TEST" | "PRODUCTION";

export async function fetchSifenEnvironment(): Promise<SifenEnvironment | null> {
  try {
    const res = await femmeJson<{ environment: string }>("/api/sifen/environment");
    return res.environment === "PRODUCTION" ? "PRODUCTION" : "TEST";
  } catch {
    return null;
  }
}
