import { femmeJson, femmePostJson } from "./femmeClient";

export type SifenCertificateStatus = "VALID" | "EXPIRED" | "NOT_YET_VALID";

export type SifenCertificateRow = {
  id: number;
  uploadedAt: string;
  notBefore: string;
  notAfter: string;
  status: SifenCertificateStatus;
};

/**
 * Certificates are read by the salon's administrator for their own tenant (read-only, no
 * `tenantId`) and loaded ONLY by the platform's root user for a given tenant, through the
 * platform area — there is deliberately no tenant-side upload.
 */
function base(tenantId?: number): string {
  return tenantId != null
    ? `/api/platform/tenants/${tenantId}/sifen/certificates`
    : "/api/sifen/certificates";
}

export function listSifenCertificates(tenantId?: number): Promise<SifenCertificateRow[]> {
  return femmeJson<SifenCertificateRow[]>(base(tenantId));
}

export function uploadSifenCertificate(
  tenantId: number,
  fileBase64: string,
  password: string,
): Promise<SifenCertificateRow> {
  return femmePostJson<SifenCertificateRow>(base(tenantId), { fileBase64, password });
}
