import { femmeJson } from "./femmeClient";

export type InvoiceListItem = {
  id: number;
  invoiceNumber: number;
  invoiceNumberFormatted: string;
  clientDisplayName: string;
  status: string;
  total: string;
  issuedAt: string;
  servicesSummary?: string | null;
  paymentMethodsSummary?: string | null;
};

export type PagedInvoicesResponse = {
  content: InvoiceListItem[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  /** Sum of `total` for ISSUED invoices across ALL pages matching the current filter. */
  issuedTotal: number | string;
};

export type ListInvoicesParams = {
  from?: string;
  to?: string;
  clientId?: number | null;
  status?: string | null;
  q?: string | null;
  page?: number;
  size?: number;
};

/** Paged invoice list. Covers all four history tables in the app. */
export function listInvoicesPaged(params: ListInvoicesParams): Promise<PagedInvoicesResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.clientId != null) qs.set("clientId", String(params.clientId));
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  if (params.page != null) qs.set("page", String(params.page));
  if (params.size != null) qs.set("size", String(params.size));
  return femmeJson<PagedInvoicesResponse>(`/api/invoices?${qs.toString()}`);
}
