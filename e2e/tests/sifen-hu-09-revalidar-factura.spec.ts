import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// See sifen-hu-18-cargar-certificado.spec.ts for the "sifen-hu-<n>-<slug>" naming rationale.
//
// HU-09 is 100% UI: it reuses the exact same URL HU-08 already computes/persists as
// Invoice.sifenQrUrl (via SifenQrCodeService) and just opens it in a new tab — no new backend
// logic to unit-test beyond InvoiceServiceTest's assertion that `sifenVerificationUrl` in the
// response is exactly that persisted field (see InvoiceServiceTest,
// getInvoice_exposesTheSameUrlPersistedAsSifenQrUrl). Everything else (AC-01/02/03/05/06) is
// interaction, so it belongs here.
//
// AC-02/03 (opens a new tab pointing at SIFEN's real verification address for the right
// environment) is asserted via Playwright's `popup` event: `window.open`'s target Page is
// available synchronously the instant it's created, before any navigation actually completes —
// so the test can assert on the target URL and close the tab immediately, without depending on
// ekuatia.set.gov.py (a real external government site) actually finishing a page load inside CI.
// This was verified against the real site as part of this story's own manual live check (see
// PROGRESS.md's HU-09 entry): the exact query-string shape this test asserts on (`consultas-test/qr?
// nVersion=150&Id=...`) returns a real HTTP 200 from SIFEN's own "Consultas" Angular app today.
//
// AC-04 (SIFEN's own page shows the result) needs no test at all — by design, this system never
// reads or interprets what's on the other end (that's the entire point of the AC).
// AC-06 (no image upload/scan) has no UI surface to test — verified by absence: no file input or
// "scan" affordance exists anywhere near this button.

test.describe("SIFEN HU-09 · Revalidar en SIFEN una factura desde el sistema", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  async function createInvoice(request: APIRequestContext, token: string) {
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E HU09 ${Date.now()}-${Math.random()}`);
    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 55000,
        },
      ],
      payments: [{ method: "CASH", amount: 55000 }],
    });
    return { invoice, client };
  }

  async function openInvoiceDetail(page: Page, clientFullName: string) {
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(clientFullName);
    const row = page.locator("tbody tr[role=\"button\"]").filter({ hasText: clientFullName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
  }

  test("HU-09 · AC-01/AC-06 sin verificación SIFEN previa no existe botón de revalidar (y no hay carga de imagen)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);
    void invoice;

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await expect(page.getByTestId("sifen-revalidate-button")).toHaveCount(0);
    // AC-06: this feature never offers uploading/scanning a third-party receipt image.
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  });

  test("HU-09 · AC-01/AC-02/AC-03 factura aprobada: el botón abre en una pestaña nueva la dirección real de verificación del ambiente de prueba", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);

    const prep = await request.post(
      `${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    // Issue #163: the revalidate button lives inside its own accordion section — expand it first.
    await page.getByTestId("sifen-tab-revalidate").click();
    const button = page.getByTestId("sifen-revalidate-button");
    await expect(button).toBeVisible();

    const [popup] = await Promise.all([page.waitForEvent("popup"), button.click()]);
    // AC-02: a real new tab, no scanning/reading of any image involved.
    // AC-03: the test-environment invoice must open the test consultation site, never production.
    expect(popup.url()).toContain("https://ekuatia.set.gov.py/consultas-test/qr?");
    expect(popup.url()).toContain("nVersion=150");
    expect(popup.url()).not.toContain("ekuatia.set.gov.py/consultas/qr?");
    await popup.close();
  });

  test("HU-09 · AC-05 el botón también está disponible para una factura no aprobada (no se restringe solo a Aprobado)", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);

    // Fabricates a REJECTED invoice with a persisted verification URL — the closest already-
    // existing "terminal, non-approved" status, standing in for the cancelled state HU-10 (Fase 3)
    // will introduce later. Proves the button's visibility only depends on the URL being
    // persisted, never on the specific SIFEN status value (see InvoiceDetailModal.tsx's
    // `sifenVerificationUrl` doc comment).
    const prep = await request.post(
      `${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-with-status/REJECTED`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    const section = page.getByTestId("sifen-status-section");
    await expect(section).toBeVisible();
    await expect(section.getByText("Not found / Rejected", { exact: true })).toBeVisible();

    // Issue #163: the revalidate button lives inside its own accordion section — expand it first.
    await page.getByTestId("sifen-tab-revalidate").click();
    const button = page.getByTestId("sifen-revalidate-button");
    await expect(button).toBeVisible();

    const [popup] = await Promise.all([page.waitForEvent("popup"), button.click()]);
    expect(popup.url()).toContain("https://ekuatia.set.gov.py/consultas-test/qr?");
    await popup.close();
  });

  test("Issue #167 · AC2 el detalle de Revalidar en SIFEN muestra el texto explicativo antes del botón", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const { invoice, client } = await createInvoice(request, token);

    const prep = await request.post(
      `${process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080"}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await loginAsDemo(page);
    await openInvoiceDetail(page, client.fullName);

    await page.getByTestId("sifen-tab-revalidate").click();
    const section = page.getByTestId("sifen-tab-revalidate");
    await expect(
      section.getByText(
        "Check this invoice directly on SET's official site, for an independent confirmation of its validity.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      section.getByText("Opens in a new tab — the result is shown on that page, not in this system.", {
        exact: false,
      }),
    ).toBeVisible();

    // The explanation must appear before the button in reading order.
    const explanationBox = section.getByText("Check this invoice directly", { exact: false });
    const button = page.getByTestId("sifen-revalidate-button");
    const [explanationY, buttonY] = await Promise.all([
      explanationBox.evaluate((el) => el.getBoundingClientRect().top),
      button.evaluate((el) => el.getBoundingClientRect().top),
    ]);
    expect(explanationY).toBeLessThan(buttonY);
  });
});
