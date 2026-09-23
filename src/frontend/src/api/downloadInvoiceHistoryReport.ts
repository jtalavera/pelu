import { authHeaders } from "./authHeaders";
import { apiBaseUrl } from "./baseUrl";

export type InvoiceHistoryReportParams = {
  from?: string;
  to?: string;
  clientId?: number | null;
  status?: string | null;
  q?: string | null;
};

/**
 * Issue #174 AC-05: downloads the currently filtered "Historial de comprobantes" list as an Excel
 * (`xlsx`) or PDF report — header data only. Throws an Error carrying the raw response body on
 * failure so callers can forward it to translateApiError().
 */
export async function downloadInvoiceHistoryReport(
  params: InvoiceHistoryReportParams,
  format: "pdf" | "xlsx",
): Promise<void> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.clientId != null) qs.set("clientId", String(params.clientId));
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  qs.set("format", format);

  const res = await fetch(`${apiBaseUrl()}/api/invoices/report?${qs.toString()}`, {
    headers: authHeaders({ json: false }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download =
    filenameFromContentDisposition(res.headers.get("Content-Disposition")) ??
    `comprobantes.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

function filenameFromContentDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = contentDisposition.match(/filename="?([^"]+)"?/);
  return match ? match[1] : null;
}
