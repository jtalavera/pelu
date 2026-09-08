import { authHeaders } from "./authHeaders";
import { apiBaseUrl } from "./baseUrl";

/**
 * HU-55 (Épica E — Importación de datos vía Excel): fetches the ready-to-fill example `.xlsx` for
 * one importable entity and triggers a browser file download on success. Throws an Error whose
 * message is the raw response body so callers can forward it to translateApiError() — never
 * downloads a corrupt file on a non-2xx response, same pattern as downloadInvoicePdf.ts.
 */
export async function downloadImportExampleFile(entity: string): Promise<void> {
  const url = `${apiBaseUrl()}/api/platform/import-templates/${encodeURIComponent(entity)}/example-file`;
  const res = await fetch(url, { headers: authHeaders({ json: false }) });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download =
    filenameFromContentDisposition(res.headers.get("Content-Disposition")) ?? `${entity}-example.xlsx`;
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
