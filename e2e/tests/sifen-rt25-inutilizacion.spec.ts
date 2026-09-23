import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiBaseUrl,
  apiGetJson,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  ensureValidSifenIssuerProfile,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

const DEMO_TENANT_ID = 1;
const SIFEN_FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";

// RT-25 (Hardening_SIFEN.md): "Inutilización de numeración" governance. SifenNumberVoidingService
// automatically records a PENDING voiding entry the moment a real transmit attempt resolves
// REJECTED (SifenSubmissionQueueListener's handleResult) — but application-e2e.properties points
// SIFEN at an unreachable endpoint, so a real e2e attempt only ever lands in PENDING_VERIFICATION
// (HU-06 AC-05's "no response" branch), never REJECTED. POST
// /api/admin/sifen-test-support/invoices/{id}/simulate-sifen-rejection fabricates that terminal
// outcome and calls the real trigger directly — see that endpoint's own javadoc. The listener→
// trigger wiring itself (only REJECTED calls it, not APPROVED/CONFLICT) is covered at the JUnit
// level in SifenSubmissionQueueListenerTest.
//
// Every test in this file shares the same demo tenant/H2 instance as every other SIFEN spec, so
// each locates its own row by the fabricated invoice's own number (range "FACTURA <n>") rather than
// assuming it's the only — or the first/last — pending row on the page.

type IssuedInvoice = { id: number };

// Issue #194: Configuración → SIFEN is now split into "Certificate" and "Voided numbering" tabs
// (same tab pattern as the Facturación page). Everything RT-25 touches lives under the second one.
async function openVoidingTab(page: Page) {
  await page.goto("/app/settings/sifen");
  await page.getByRole("tab", { name: "Voided numbering" }).click();
}

async function createInvoice(request: APIRequestContext, token: string): Promise<IssuedInvoice> {
  const seed = await seedCategoryServiceProfessional(request, token);
  const client = await seedClient(request, token, `E2E RT25 ${Date.now()}-${Math.random()}`);
  return apiPostJson<IssuedInvoice>(request, token, "/api/invoices", {
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
}

async function rejectAndGetVoidingRow(page: Page, request: APIRequestContext, token: string) {
  const invoice = await createInvoice(request, token);
  const rejectRes = await request.post(
    `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/simulate-sifen-rejection`,
  );
  expect(rejectRes.ok(), await rejectRes.text()).toBeTruthy();
  const detail = await apiGetJson<{ invoiceNumber: number }>(
    request,
    token,
    `/api/invoices/${invoice.id}`,
  );

  await loginAsDemo(page);
  await openVoidingTab(page);
  await expect(page.getByTestId("sifen-number-voiding-section")).toBeVisible();
  return page
    .getByTestId("sifen-number-voiding-row")
    .filter({ hasText: `FACTURA ${detail.invoiceNumber}` });
}

test.describe("RT-25 · Inutilización de numeración", () => {
  // Every test here either creates a SIFEN invoice (signs synchronously once the tenant flag is
  // on) or views Configuración → SIFEN (itself gated on that same flag) — self-contained rather
  // than relying on some other spec having left the flag/profile/certificate ready.
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, true);
    await ensureValidSifenIssuerProfile(request, token);
    await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support/ensure-valid-certificate`);
  });
  test.afterEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, false);
  });

  test("RT-25 · una factura rechazada por SIFEN registra automáticamente una inutilización pendiente", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const row = await rejectAndGetVoidingRow(page, request, token);

    await expect(row).toBeVisible();
    await expect(row.getByText("Pending submission")).toBeVisible();
    await expect(row.getByText("Automatic")).toBeVisible();
  });

  test("RT-25 · el motivo debe tener al menos 5 caracteres antes de enviar a SIFEN", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const row = await rejectAndGetVoidingRow(page, request, token);
    await row.getByLabel("Reason").fill("ab");
    await row.getByRole("button", { name: "Submit to SIFEN" }).click();

    await expect(row.getByText("Enter a reason of at least 5 characters.")).toBeVisible();
  });

  test("RT-25 · enviar a SIFEN con un motivo válido intenta la transmisión real y muestra el resultado", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const row = await rejectAndGetVoidingRow(page, request, token);
    await row.getByLabel("Reason").fill("Factura rechazada, numeración inutilizada por prueba e2e");
    await row.getByRole("button", { name: "Submit to SIFEN" }).click();

    // application-e2e.properties points SIFEN at an unreachable endpoint — a real synchronous
    // attempt (SifenNumberVoidingService.submit, unlike RT-20's async invoice path) always gets no
    // response, surfacing the real 502 error through the UI rather than a fabricated result.
    await expect(
      row.getByText("SIFEN did not respond to the voiding request. Try again shortly."),
    ).toBeVisible();
  });

  // ── Follow-up: manual voiding, deadline summary + dashboard alert, revenue exclusion ──────

  test("RT-25 · un ADMIN registra una inutilización manual para un rango de números no usados", async ({
    page,
    request,
  }) => {
    // A range well above any issued number, unique per run, inside the stamp's 1–9,999,999 range.
    const from = 9_500_000 + (Date.now() % 400_000);
    const to = from + 4;

    await loginAsDemo(page);
    await openVoidingTab(page);
    const form = page.getByTestId("sifen-number-voiding-manual-form");
    await expect(form).toBeVisible();
    await form.locator("#manual-range-from").fill(String(from));
    await form.locator("#manual-range-to").fill(String(to));
    await form.getByLabel("Reason").fill("Numeración saltada por un error del sistema");
    await form.getByRole("button", { name: "Register" }).click();

    await expect(page.getByTestId("sifen-number-voiding-manual-success")).toBeVisible();
    const row = page
      .getByTestId("sifen-number-voiding-row")
      .filter({ hasText: `FACTURA ${from}` });
    await expect(row).toBeVisible();
    await expect(row.getByText("Pending submission")).toBeVisible();
    await expect(row.getByText("Automatic")).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Submit to SIFEN" })).toBeVisible();
  });

  /**
   * Bug report: the "Motivo" textarea displays `voidingReasons[id] ?? row.reason ?? ""`, so a
   * range's own creation reason shows up pre-filled even if the admin never edits the field — but
   * `submitVoiding` validated only `voidingReasons[id]` with no such fallback, so clicking "Submit
   * to SIFEN" without first touching the (already-filled-looking) textarea wrongly reported "Enter
   * a reason of at least 5 characters."
   */
  test("RT-25 · enviar a SIFEN sin tocar el motivo precargado de una inutilización manual no muestra 'motivo muy corto'", async ({
    page,
  }) => {
    const from = 9_500_000 + (Date.now() % 400_000) + 1000;
    const to = from + 2;

    await loginAsDemo(page);
    await openVoidingTab(page);
    const form = page.getByTestId("sifen-number-voiding-manual-form");
    await form.locator("#manual-range-from").fill(String(from));
    await form.locator("#manual-range-to").fill(String(to));
    await form.getByLabel("Reason").fill("Numeración saltada por un error del sistema");
    await form.getByRole("button", { name: "Register" }).click();
    await expect(page.getByTestId("sifen-number-voiding-manual-success")).toBeVisible();

    const row = page
      .getByTestId("sifen-number-voiding-row")
      .filter({ hasText: `FACTURA ${from}` });
    await expect(row).toBeVisible();
    // The textarea already shows the creation reason — submit without editing it at all.
    await expect(row.getByLabel("Reason")).toHaveValue(
      "Numeración saltada por un error del sistema",
    );
    await row.getByRole("button", { name: "Submit to SIFEN" }).click();

    await expect(row.getByText("Enter a reason of at least 5 characters.")).toHaveCount(0);
    // Reaches the real (unreachable-in-e2e) submission attempt instead — same outcome the
    // existing "motivo válido" test above expects once past validation.
    await expect(
      row.getByText("SIFEN did not respond to the voiding request. Try again shortly."),
    ).toBeVisible();
  });

  test("RT-25 · rechaza inutilizar manualmente un rango que incluye un número ya emitido", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const invoice = await createInvoice(request, token);
    const detail = await apiGetJson<{ invoiceNumber: number }>(
      request,
      token,
      `/api/invoices/${invoice.id}`,
    );

    await loginAsDemo(page);
    await openVoidingTab(page);
    const form = page.getByTestId("sifen-number-voiding-manual-form");
    await form.locator("#manual-range-from").fill(String(detail.invoiceNumber));
    await form.locator("#manual-range-to").fill(String(detail.invoiceNumber));
    await form.getByLabel("Reason").fill("Intento inválido de inutilización");
    await form.getByRole("button", { name: "Register" }).click();

    await expect(
      form.getByText("That range includes already-issued invoice numbers; it can't be voided."),
    ).toBeVisible();
  });

  test("RT-25 · la sección resume las inutilizaciones pendientes y el dashboard alerta", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const invoice = await createInvoice(request, token);
    const rej = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/simulate-sifen-rejection`,
    );
    expect(rej.ok(), await rej.text()).toBeTruthy();

    // Backend: the dashboard now carries the pending-voiding alert.
    const dash = await apiGetJson<{ fiscalAlerts: { messageKey: string }[] }>(
      request,
      token,
      "/api/dashboard",
    );
    expect(dash.fiscalAlerts.map((a) => a.messageKey)).toContain("sifenVoidingPending");

    // UI: the SIFEN settings section shows the summary line.
    await loginAsDemo(page);
    await openVoidingTab(page);
    await expect(page.getByTestId("sifen-number-voiding-summary")).toBeVisible();
    await expect(page.getByTestId("sifen-number-voiding-summary")).toContainText(
      "pending submission",
    );
  });

  test("Follow-up: una factura rechazada por SIFEN sale del total facturado", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E RT25 revenue ${Date.now()}`);
    const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 55000 },
      ],
      payments: [{ method: "CASH", amount: 55000 }],
    });

    const filter = `/api/invoices?q=${encodeURIComponent(client.fullName)}`;
    const before = await apiGetJson<{ issuedTotal: number | string }>(request, token, filter);
    expect(Number(before.issuedTotal)).toBe(55_000);

    const rej = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/simulate-sifen-rejection`,
    );
    expect(rej.ok(), await rej.text()).toBeTruthy();

    const after = await apiGetJson<{ issuedTotal: number | string }>(request, token, filter);
    // The invoice row is still listed (status ISSUED) but no longer counts as facturación.
    expect(Number(after.issuedTotal)).toBe(0);
  });
});
