import { authHeaders } from "./authHeaders";
import { apiBaseUrl } from "./baseUrl";

/**
 * Issue #217 "Lista de precios compartible": fetches the tenant's active-services price list PDF
 * and triggers a browser file download. Same shape as {@code downloadInvoicePdf} / {@code
 * downloadSifenKude} — never downloads a corrupt file, throws the raw error body on failure so
 * callers can forward it to translateApiError().
 */
export async function downloadPriceListPdf(): Promise<void> {
  const url = `${apiBaseUrl()}/api/services/price-list/pdf`;
  const res = await fetch(url, { headers: authHeaders({ json: false }) });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download =
    filenameFromContentDisposition(res.headers.get("Content-Disposition")) ?? "lista-precios.pdf";
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
