import { authHeaders } from "./authHeaders";
import { apiBaseUrl } from "./baseUrl";

/**
 * Fetches the invoice PDF, validates the HTTP response, and triggers a browser
 * file download on success. Throws an Error whose message is the raw response
 * body (JSON or plain text) so callers can forward it to translateApiError().
 *
 * Never downloads a corrupt file: if the server returns a non-2xx response the
 * error body is thrown instead of being piped to a .pdf file.
 */
export async function downloadInvoicePdf(invoiceId: number): Promise<void> {
  const url = `${apiBaseUrl()}/api/invoices/${invoiceId}/pdf`;
  const res = await fetch(url, { headers: authHeaders({ json: false }) });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filenameFromContentDisposition(res.headers.get("Content-Disposition")) ?? `invoice-${invoiceId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

/** Extracts the `filename="..."` value the backend proposes (issue #84), e.g. "FACTURA-20260703-12345678-0000007.pdf". */
function filenameFromContentDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = contentDisposition.match(/filename="?([^"]+)"?/);
  return match ? match[1] : null;
}
