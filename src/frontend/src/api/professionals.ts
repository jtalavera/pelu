import { femmeJson } from "./femmeClient";
import type { PageResponse } from "./pagination";

export type ListProfessionalsPagedParams = {
  q?: string;
  page?: number;
  size?: number;
};

export function listProfessionalsPaged<T>(
  params: ListProfessionalsPagedParams,
): Promise<PageResponse<T>> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.page != null) qs.set("page", String(params.page));
  if (params.size != null) qs.set("size", String(params.size));
  return femmeJson<PageResponse<T>>(`/api/professionals/page?${qs.toString()}`);
}
