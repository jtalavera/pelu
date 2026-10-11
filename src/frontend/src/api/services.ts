import { femmeJson } from "./femmeClient";
import type { PageResponse } from "./pagination";

export type ListServicesPagedParams = {
  q?: string;
  categoryId?: number;
  active?: boolean;
  /** HU-59: "SERVICE" | "PRODUCT"; omitted = both. */
  kind?: "SERVICE" | "PRODUCT";
  page?: number;
  size?: number;
};

export function listServicesPaged<T>(
  params: ListServicesPagedParams,
): Promise<PageResponse<T>> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.categoryId != null) qs.set("categoryId", String(params.categoryId));
  if (params.active != null) qs.set("active", String(params.active));
  if (params.kind) qs.set("kind", params.kind);
  if (params.page != null) qs.set("page", String(params.page));
  if (params.size != null) qs.set("size", String(params.size));
  return femmeJson<PageResponse<T>>(`/api/services/page?${qs.toString()}`);
}
