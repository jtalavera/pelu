import { authHeaders } from "./authHeaders";
import { apiBaseUrl } from "./baseUrl";

/**
 * SIFEN HU-08 AC-16: fetches the KuDE PDF for an approved invoice, validates the HTTP response, and
 * triggers a browser file download on success. Same shape as {@code downloadInvoicePdf} — never
 * downloads a corrupt file, throws the raw error body on failure so callers can forward it to
 * translateApiError().
 */
export async function downloadSifenKude(
  invoiceId: number,
  options: { sample?: boolean } = {},
): Promise<void> {
  // `sample=true` asks for the "production-style" preview KuDE — real razón social instead of the
  // test-environment legend, downloaded as MUESTRA-…pdf. Only accepted while SIFEN runs against the
  // test environment (see SifenKudeController).
  const url = `${apiBaseUrl()}/api/invoices/${invoiceId}/sifen/kude${
    options.sample ? "?sample=true" : ""
  }`;
  const res = await fetch(url, { headers: authHeaders({ json: false }) });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filenameFromContentDisposition(res.headers.get("Content-Disposition")) ?? `kude-${invoiceId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

/** SIFEN HU-08 AC-17: emails the same KuDE to {@code email} (or the client's own email if blank). */
export async function sendSifenKudeByEmail(invoiceId: number, email: string): Promise<void> {
  const url = `${apiBaseUrl()}/api/invoices/${invoiceId}/sifen/kude/email`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders({ json: true }),
    body: JSON.stringify({ email: email.trim() === "" ? null : email.trim() }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

/**
 * The SIFEN environment this deployment connects to. The invoice detail screen uses it to only
 * offer the "production-style" sample KuDE while running against SIFEN's test environment.
 */
export async function fetchSifenEnvironment(): Promise<"TEST" | "PRODUCTION"> {
  const res = await fetch(`${apiBaseUrl()}/api/sifen/environment`, {
    headers: authHeaders({ json: false }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const body = (await res.json()) as { environment?: string };
  return body.environment === "PRODUCTION" ? "PRODUCTION" : "TEST";
}

function filenameFromContentDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = contentDisposition.match(/filename="?([^"]+)"?/);
  return match ? match[1] : null;
}
