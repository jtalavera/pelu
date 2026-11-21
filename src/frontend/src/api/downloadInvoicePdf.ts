import { authHeaders } from "./authHeaders";
import { apiBaseUrl } from "./baseUrl";
import { triggerBrowserDownload } from "./downloadSifenKude";

/** The non-fiscal receipt comes as an A4 sheet or as an 80 mm ticket (thermal printer). */
export type ReceiptFormat = "A4" | "TICKET";

/**
 * Fetches the NON-fiscal receipt PDF (the KuDE has its own download) and validates the HTTP
 * response. Throws an Error whose message is the raw response body (JSON or plain text) so callers
 * can forward it to translateApiError(). Never returns a corrupt file: a non-2xx response throws its
 * error body instead.
 */
export async function fetchInvoicePdfBlob(
  invoiceId: number,
  format: ReceiptFormat = "A4",
): Promise<{ blob: Blob; filename: string }> {
  const url = `${apiBaseUrl()}/api/invoices/${invoiceId}/pdf?format=${format}`;
  const res = await fetch(url, { headers: authHeaders({ json: false }) });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return {
    blob: await res.blob(),
    filename:
      filenameFromContentDisposition(res.headers.get("Content-Disposition")) ??
      `comprobante-${invoiceId}.pdf`,
  };
}

/** Fetches the receipt PDF and triggers a browser file download on success. */
export async function downloadInvoicePdf(invoiceId: number, format: ReceiptFormat = "A4"): Promise<void> {
  const { blob, filename } = await fetchInvoicePdfBlob(invoiceId, format);
  triggerBrowserDownload(blob, filename);
}

/**
 * «Compartir con el cliente» by e-mail for a non-fiscal receipt. With a blank address the backend
 * uses the one on the invoice or the client's own (400 `RECEIPT_EMAIL_REQUIRED` when there is none).
 */
export async function sendInvoiceReceiptByEmail(
  invoiceId: number,
  email: string,
  format: ReceiptFormat = "A4",
): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/api/invoices/${invoiceId}/pdf/email`, {
    method: "POST",
    headers: authHeaders({ json: true }),
    body: JSON.stringify({ email: email.trim() === "" ? null : email.trim(), format }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

/** Extracts the `filename="..."` value the backend proposes (issue #84), e.g. "COMPROBANTE-NO-FISCAL-20260703-001-001-0000007.pdf". */
function filenameFromContentDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = contentDisposition.match(/filename="?([^"]+)"?/);
  return match ? match[1] : null;
}
