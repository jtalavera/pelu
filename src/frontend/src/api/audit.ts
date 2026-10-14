import { femmeJson } from "./femmeClient";
import type { PageResponse } from "./pagination";

/** Issue #284: one row of the audit trail ("quién hizo qué"). Never carries a request body. */
export type AuditLogRow = {
  id: number;
  tenantId: number | null;
  tenantName: string | null;
  userEmail: string | null;
  userRole: string | null;
  httpMethod: string;
  resource: string;
  operation: string | null;
  entityId: string | null;
  statusCode: number;
  createdAt: string;
};

export type AuditLogQuery = {
  /** Root user's view across every salon (and the root users' own actions). */
  platform?: boolean;
  tenantId?: number;
  from?: string;
  to?: string;
  resource?: string;
  q?: string;
  page?: number;
  size?: number;
};

export function listAuditLog(query: AuditLogQuery): Promise<PageResponse<AuditLogRow>> {
  const qs = new URLSearchParams();
  if (query.platform && query.tenantId != null) qs.set("tenantId", String(query.tenantId));
  if (query.from) qs.set("from", query.from);
  if (query.to) qs.set("to", query.to);
  if (query.resource) qs.set("resource", query.resource);
  if (query.q?.trim()) qs.set("q", query.q.trim());
  qs.set("page", String(query.page ?? 0));
  qs.set("size", String(query.size ?? 20));
  const base = query.platform ? "/api/platform/audit" : "/api/audit";
  return femmeJson<PageResponse<AuditLogRow>>(`${base}?${qs.toString()}`);
}
