import { femmeJson, femmePostJson } from "./femmeClient";

/** A CSC the tenant has loaded. The secret value is write-only: the API never returns it. */
export type SifenCscRow = {
  idCsc: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export function listSifenCsc(): Promise<SifenCscRow[]> {
  return femmeJson<SifenCscRow[]>("/api/sifen/csc");
}

export function saveSifenCsc(idCsc: number, csc: string): Promise<SifenCscRow> {
  return femmePostJson<SifenCscRow>("/api/sifen/csc", { idCsc, csc });
}

export function activateSifenCsc(idCsc: number): Promise<SifenCscRow> {
  return femmePostJson<SifenCscRow>(`/api/sifen/csc/${idCsc}/activate`, {});
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
