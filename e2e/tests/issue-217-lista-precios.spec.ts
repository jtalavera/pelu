import { inflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { API_BASE, apiPostJson, apiPutJson, authHeaders, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// Issue #217 "Lista de precios compartible":
//   - GET /api/services/price-list/pdf returns a PDF with only the tenant's active services.
//   - Prices are formatted like formatGuaraniesGs (no decimals, "." as thousands separator).
//   - The document header is the business's fantasy name (falls back to business name).
//   - A "Download price list" button on the Services page triggers the download.

/**
 * Extracts the plain text drawn by every `(...)Tj` show-text operator across all of a PDF's
 * FlateDecode content streams, by inflating each stream's raw bytes directly with Node's `zlib`.
 *
 * Not using the repo's usual `pdf-parse` (bundles a ~2016-era pdf.js, v1.10.100) here: that
 * library throws "bad XRef entry" on this endpoint's PDF even though it is fully spec-compliant —
 * verified independently with `pdftotext` (poppler) and a byte-level audit of the xref table/
 * trailer/object offsets, which are all correct. The failure reproduces on the same bytes outside
 * Playwright entirely, so it's a limitation of that old bundled parser with this particular
 * minimal (single content-stream, non-sequential object numbering) document shape, not a defect
 * in the endpoint. Other specs in this repo only ever fed `pdf-parse` much larger, multi-object
 * KuDE PDFs (fonts, embedded QR image, several tables), which happen not to trigger it.
 * Decompressing the content stream ourselves keeps the check real (byte-for-byte from the actual
 * response) without depending on that library for this endpoint.
 */
function extractPdfShowTextContent(pdf: Buffer): string {
  const latin1 = pdf.toString("latin1");
  let out = "";
  let searchFrom = 0;
  for (;;) {
    const streamAt = latin1.indexOf("stream", searchFrom);
    if (streamAt === -1) break;
    let start = streamAt + "stream".length;
    if (latin1[start] === "\r") start++;
    if (latin1[start] === "\n") start++;
    const end = latin1.indexOf("endstream", start);
    if (end === -1) break;
    const raw = latin1.slice(start, end).replace(/[\r\n]+$/, "");
    try {
      out += inflateSync(Buffer.from(raw, "latin1")).toString("latin1") + "\n";
    } catch {
      // Not a (deflate-compressed) content stream — e.g. an image XObject. Skip it.
    }
    searchFrom = end + "endstream".length;
  }
  return out;
}

test.describe("Issue #217 · Lista de precios compartible", () => {
  test.describe.configure({ mode: "serial" });

  test("shows the 'Download price list' button on the Services page", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    const button = page.getByTestId("download-price-list-button");
    await expect(button).toBeVisible({ timeout: 10_000 });
    await expect(button).toBeEnabled();
  });

  test("downloads a PDF with only active services, Gs.-formatted prices, and the business's fantasy name as header", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const suffix = Date.now();

    // AC: fantasy name is the document header.
    const fantasyName = `Salón Fantasía ${suffix}`;
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: `Demo salon ${suffix}`,
      ruc: null,
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
      taxpayerType: null,
      economicActivityCode: null,
      economicActivityDescription: null,
      sifenDepartmentCode: null,
      sifenDepartmentName: null,
      sifenCityCode: null,
      sifenCityName: null,
      sifenFantasyName: fantasyName,
      kudeFooterMessage: null,
    });

    const category = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
      name: `E2E Cat 217 ${suffix}`,
      accentKey: "stone",
    });

    // AC: only active services appear — this one stays active and must be included.
    const activeServiceName = `E2E Corte Activo ${suffix}`;
    await apiPostJson<{ id: number }>(request, token, "/api/services", {
      name: activeServiceName,
      categoryId: category.id,
      priceMinor: 125000,
      durationMinutes: 30,
    });

    // AC: an inactive service is created and then deactivated — must be EXCLUDED.
    const inactiveServiceName = `E2E Corte Inactivo ${suffix}`;
    const inactiveService = await apiPostJson<{ id: number }>(request, token, "/api/services", {
      name: inactiveServiceName,
      categoryId: category.id,
      priceMinor: 99000,
      durationMinutes: 30,
    });
    await apiPostJson(request, token, `/api/services/${inactiveService.id}/deactivate`, {});

    // ── Direct API check: 200 + Content-Type: application/pdf + correct, filtered content ──
    const apiRes = await request.get(`${API_BASE}/api/services/price-list/pdf`, {
      headers: authHeaders(token),
    });
    expect(apiRes.status()).toBe(200);
    expect(apiRes.headers()["content-type"]).toContain("application/pdf");
    const apiBody = await apiRes.body();
    expect(apiBody.slice(0, 4).toString("latin1")).toBe("%PDF");

    const apiText = extractPdfShowTextContent(apiBody);
    expect(apiText).toContain(fantasyName);
    expect(apiText).toContain(activeServiceName);
    expect(apiText).toContain("125.000");
    expect(apiText).not.toContain(inactiveServiceName);

    // ── UI check: the button on the Services page actually triggers a browser download ──
    await loginAsDemo(page);
    await page.goto("/app/services");
    const button = page.getByTestId("download-price-list-button");
    await expect(button).toBeVisible({ timeout: 10_000 });

    const [download, response] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      page.waitForResponse(
        (res) => res.url().includes("/api/services/price-list/pdf") && res.request().method() === "GET",
      ),
      button.click(),
    ]);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");

    const path = await download.path();
    expect(path).not.toBeNull();
    const fs = await import("fs/promises");
    const buf = await fs.readFile(path!);
    expect(buf.slice(0, 4).toString("latin1")).toBe("%PDF");

    await expect(page.getByTestId("price-list-error")).not.toBeVisible();
  });
});
