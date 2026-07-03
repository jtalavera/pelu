import { femmeJson } from "./femmeClient";
import type { PageResponse } from "./pagination";

export type ClientListFilterParams = {
  q?: string;
  active?: boolean;
  withRuc?: boolean;
  isNew?: boolean;
};

export type ListClientsPagedParams = ClientListFilterParams & {
  page?: number;
  size?: number;
};

function filterQueryString(params: ClientListFilterParams): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.active != null) qs.set("active", String(params.active));
  if (params.withRuc != null) qs.set("withRuc", String(params.withRuc));
  if (params.isNew != null) qs.set("isNew", String(params.isNew));
  return qs;
}

export function listClientsPaged<T>(
  params: ListClientsPagedParams,
): Promise<PageResponse<T>> {
  const qs = filterQueryString(params);
  if (params.page != null) qs.set("page", String(params.page));
  if (params.size != null) qs.set("size", String(params.size));
  return femmeJson<PageResponse<T>>(`/api/clients/page?${qs.toString()}`);
}

/** Fetches every client matching the filters (no pagination) — used by CSV export. */
export function listClientsAll<T>(params: ClientListFilterParams): Promise<T[]> {
  const qs = filterQueryString(params);
  return femmeJson<T[]>(`/api/clients?${qs.toString()}`);
}
