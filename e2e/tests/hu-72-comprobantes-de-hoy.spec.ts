import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiBaseUrl,
  apiGetJson,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { goToBillingHome } from "../fixtures/billing";

// HU-72 · «Comprobantes de hoy»: recarga al cerrar el detalle, botón «Actualizar», hora de la
// última actualización, fecha y hora de emisión por fila y menú «Más acciones» (KuDE) por fila.
//
// SIFEN is unreachable in e2e: the states below are fabricated through
// /api/admin/sifen-test-support (e2e profile only). The flag is turned off so issuing an invoice
// stays a plain one and no real async transmit races those fabrications (same as sifen-hu-08).

const DEMO_TENANT_ID = 1;
const SIFEN_FLAG = "SIFEN_ELECTRONIC_INVOICING";
/** The paged list endpoint (`GET /api/invoices?…`), not the single-invoice one. */
const LIST_URL = /\/api\/invoices\?/;

type Seed = Awaited<ReturnType<typeof seedCategoryServiceProfessional>>;

async function supportPost(request: APIRequestContext, path: string) {
  const res = await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support${path}`);
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Creates an invoice for a new client (optionally with phone and email) and gives it a SIFEN state. */
async function createInvoice(
  request: APIRequestContext,
  token: string,
  seed: Seed,
  label: string,
  sifenStatus: "APPROVED" | "REJECTED" | "PENDING_VERIFICATION",
  contact: { phone?: string; email?: string } = {},
) {
  const fullName = `${label} ${Date.now()}`;
  const client = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
    fullName,
    phone: contact.phone ?? null,
    email: contact.email ?? null,
    ruc: null,
  });
  const invoice = await apiPostJson<{ id: number; invoiceNumberFormatted: string; issuedAt: string }>(
    request,
    token,
    "/api/invoices",
    {
      clientId: client.id,
      clientDisplayName: fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 45000 },
      ],
      payments: [{ method: "CASH", amount: 45000 }],
    },
  );
  await supportPost(request, `/invoices/${invoice.id}/prepare-with-status/${sifenStatus}`);
  return { ...invoice, fullName };
}

function todayRow(page: Page, invoiceId: number) {
  return page.getByTestId(`billing-today-row-${invoiceId}`);
}

async function openToday(page: Page) {
  await loginAsDemo(page);
  await page.goto("/app/billing");
  await goToBillingHome(page);
}

test.describe("HU-72 · Comprobantes de hoy: actualizar, fecha y hora y compartir KuDE", () => {
  let token: string;
  let seed: Seed;

  test.beforeEach(async ({ request }) => {
    token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG, false);
    seed = await seedCategoryServiceProfessional(request, token);
  });

  test("AC1 · al cerrar el detalle la lista se recarga y la fila muestra el estado actual", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    // Approved: not in flight, so nothing refreshes this list on its own.
    const inv = await createInvoice(request, token, seed, "E2E HU72 cierre", "APPROVED");
    await openToday(page);
    const row = todayRow(page, inv.id);
    await expect(row.getByText("Approved", { exact: true })).toBeVisible({ timeout: 30_000 });

    await row.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The state changes in the backend while the detail is open.
    await supportPost(request, `/invoices/${inv.id}/prepare-with-status/REJECTED`);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await expect(row.getByText("Needs attention", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("Approved", { exact: true })).toHaveCount(0);
  });

  test("AC2 · «Actualizar» vuelve a leer la lista sin esconder las filas", async ({ page, request }) => {
    test.setTimeout(60_000);
    const inv = await createInvoice(request, token, seed, "E2E HU72 actualizar", "APPROVED");
    await openToday(page);
    const row = todayRow(page, inv.id);
    await expect(row.getByText("Approved", { exact: true })).toBeVisible({ timeout: 30_000 });

    const refresh = page.getByTestId("billing-today-refresh");
    await expect(refresh).toBeVisible();
    await expect(refresh).toHaveText("Refresh");
    await expect(refresh).toBeEnabled();

    await supportPost(request, `/invoices/${inv.id}/prepare-with-status/REJECTED`);
    // Nothing refreshes it by itself: still the old state until the user asks.
    await expect(row.getByText("Approved", { exact: true })).toBeVisible();

    // Hold the list response so the «Refreshing…» state can be observed, then let it through.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(LIST_URL, async (route) => {
      await gate;
      await route.continue();
    });
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(refresh).toHaveText("Refreshing…");
    // No «Loading…» swap: the rows stay on screen meanwhile.
    await expect(row).toBeVisible();
    release();

    await expect(row.getByText("Needs attention", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(refresh).toBeEnabled();
    await expect(refresh).toHaveText("Refresh");
    await page.unroute(LIST_URL);
  });

  test("AC2 · si la recarga falla se avisa con un error y las filas se conservan", async ({ page, request }) => {
    test.setTimeout(60_000);
    const inv = await createInvoice(request, token, seed, "E2E HU72 error", "APPROVED");
    await openToday(page);
    const row = todayRow(page, inv.id);
    await expect(row).toBeVisible({ timeout: 30_000 });

    await page.route(LIST_URL, (route) => route.abort());
    await page.getByTestId("billing-today-refresh").click();

    await expect(page.getByTestId("billing-today-notice")).toBeVisible();
    await expect(row).toBeVisible();
    await expect(page.getByTestId("billing-today-refresh")).toBeEnabled();
    await page.unroute(LIST_URL);
  });

  test("AC3 · se muestra «Actualizado a las HH:mm» y cambia con cada lectura de la lista", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const inv = await createInvoice(request, token, seed, "E2E HU72 hora", "APPROVED");
    await openToday(page);
    await expect(todayRow(page, inv.id)).toBeVisible({ timeout: 30_000 });

    const updatedAt = page.getByTestId("billing-today-updated-at");
    await expect(updatedAt).toHaveText(/^Updated at \d{2}:\d{2}$/);

    // The shown time follows the Paraguay clock (GMT-3), the same one used for the invoices.
    const asuncionNow = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Asuncion",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
    const [h, m] = asuncionNow.split(":").map(Number);
    const [shownH, shownM] = ((await updatedAt.textContent()) ?? "").replace("Updated at ", "").split(":").map(Number);
    const diffMinutes = Math.abs(h * 60 + m - (shownH * 60 + shownM));
    expect(Math.min(diffMinutes, 1440 - diffMinutes)).toBeLessThanOrEqual(2);

    // A manual refresh reads the list again and keeps the line.
    const listResponse = page.waitForResponse(
      (r) => r.url().includes("/api/invoices?") && r.request().method() === "GET",
    );
    await page.getByTestId("billing-today-refresh").click();
    await listResponse;
    await expect(updatedAt).toHaveText(/^Updated at \d{2}:\d{2}$/);
  });

  test("AC4 · cada fila muestra la fecha y hora de emisión en lugar de la forma de pago", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const inv = await createInvoice(request, token, seed, "E2E HU72 fecha", "APPROVED");
    const detail = await apiGetJson<{ issuedAt: string }>(request, token, `/api/invoices/${inv.id}`);
    const expected = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Asuncion",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(detail.issuedAt));

    await openToday(page);
    const row = todayRow(page, inv.id);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`billing-today-issued-at-${inv.id}`)).toHaveText(expected);
    // The payment method (paid in cash) is no longer on the row.
    await expect(row).not.toContainText("Cash");
  });

  test("AC5 · cada fila tiene «Más acciones» con WhatsApp, correo, descarga de KuDE y ver detalle, sin abrir el detalle", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const inv = await createInvoice(request, token, seed, "E2E HU72 menu", "APPROVED");
    await openToday(page);
    await expect(todayRow(page, inv.id)).toBeVisible({ timeout: 30_000 });

    const trigger = page.getByTestId(`billing-today-menu-${inv.id}`);
    await expect(trigger).toHaveAccessibleName("More actions");
    const box = await trigger.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await trigger.click();
    const menu = page.getByTestId(`billing-today-menu-panel-${inv.id}`);
    await expect(menu).toBeVisible();
    await expect(page.getByTestId(`billing-today-menu-whatsapp-${inv.id}`)).toHaveText(/Send by WhatsApp/);
    await expect(page.getByTestId(`billing-today-menu-email-${inv.id}`)).toHaveText(/Send by email/);
    await expect(page.getByTestId(`billing-today-menu-email-${inv.id}`)).toHaveText(/To the client's email/);
    await expect(page.getByTestId(`billing-today-menu-download-${inv.id}`)).toHaveText(/Download KuDE \(PDF\)/);
    await expect(page.getByTestId(`billing-today-menu-detail-${inv.id}`)).toHaveText(/View details/);
    // Opening the menu did not open the row's detail.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByTestId(`billing-today-menu-detail-${inv.id}`).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(inv.invoiceNumberFormatted);
  });

  test("AC6 · las acciones de KuDE están habilitadas si está aprobado o en proceso y deshabilitadas, con nota, si requiere atención", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const approved = await createInvoice(request, token, seed, "E2E HU72 aprobada", "APPROVED");
    const inProcess = await createInvoice(request, token, seed, "E2E HU72 proceso", "PENDING_VERIFICATION");
    const rejected = await createInvoice(request, token, seed, "E2E HU72 rechazada", "REJECTED");
    await openToday(page);
    await expect(todayRow(page, rejected.id)).toBeVisible({ timeout: 30_000 });

    for (const inv of [approved, inProcess]) {
      await page.getByTestId(`billing-today-menu-${inv.id}`).click();
      for (const action of ["whatsapp", "email", "download"]) {
        await expect(page.getByTestId(`billing-today-menu-${action}-${inv.id}`)).toBeEnabled();
      }
      await page.keyboard.press("Escape");
      await expect(page.getByTestId(`billing-today-menu-panel-${inv.id}`)).toHaveCount(0);
    }

    await page.getByTestId(`billing-today-menu-${rejected.id}`).click();
    for (const action of ["whatsapp", "email", "download"]) {
      const item = page.getByTestId(`billing-today-menu-${action}-${rejected.id}`);
      await expect(item).toBeDisabled();
      await expect(item).toContainText("Not available: no approved KuDE");
    }
    await expect(page.getByTestId(`billing-today-menu-detail-${rejected.id}`)).toBeEnabled();
  });

  test("AC7 · «Descargar KuDE» descarga el PDF del comprobante de esa fila", async ({ page, request }) => {
    test.setTimeout(60_000);
    const inv = await createInvoice(request, token, seed, "E2E HU72 descarga", "APPROVED");
    await openToday(page);
    await expect(todayRow(page, inv.id)).toBeVisible({ timeout: 30_000 });

    await page.getByTestId(`billing-today-menu-${inv.id}`).click();
    const [download, kudeResponse] = await Promise.all([
      page.waitForEvent("download"),
      page.waitForResponse(
        (r) => r.url().includes(`/api/invoices/${inv.id}/sifen/kude`) && r.request().method() === "GET",
      ),
      page.getByTestId(`billing-today-menu-download-${inv.id}`).click(),
    ]);
    expect(kudeResponse.ok(), await kudeResponse.text()).toBeTruthy();
    expect(download.suggestedFilename()).toMatch(/^KUDE-.*\.pdf$/);
    // Picking an option closes the menu and does not open the detail.
    await expect(page.getByTestId(`billing-today-menu-panel-${inv.id}`)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId(`billing-today-menu-${inv.id}`)).toBeEnabled();
  });

  test("AC7 · «Enviar por correo» lo manda al correo cargado del cliente y confirma", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const inv = await createInvoice(request, token, seed, "E2E HU72 correo", "APPROVED", {
      email: "cliente-hu72@example.com",
    });
    await openToday(page);
    await expect(todayRow(page, inv.id)).toBeVisible({ timeout: 30_000 });

    await page.getByTestId(`billing-today-menu-${inv.id}`).click();
    const [emailResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/api/invoices/${inv.id}/sifen/kude/email`) && r.request().method() === "POST",
      ),
      page.getByTestId(`billing-today-menu-email-${inv.id}`).click(),
    ]);
    // The success response is 204 No Content.
    expect(emailResponse.status()).toBe(204);
    // No address typed: the backend uses the client's own.
    expect(emailResponse.request().postDataJSON()).toEqual({ email: null });
    await expect(page.getByTestId("billing-today-notice")).toContainText("KuDE sent by email.");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("AC7 · «Enviar por WhatsApp» abre el chat del contacto del cliente con el KuDE descargado", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const inv = await createInvoice(request, token, seed, "E2E HU72 whatsapp", "APPROVED", {
      phone: "0981123456",
    });
    // Stub `window.open` so the test asserts the exact WhatsApp URL instead of leaving the app.
    await page.addInitScript(() => {
      const w = window as unknown as { __waCalls: { url: string; target: string }[] };
      w.__waCalls = [];
      window.open = ((url?: string | URL, target?: string) => {
        w.__waCalls.push({ url: String(url ?? ""), target: String(target ?? "") });
        return null;
      }) as typeof window.open;
    });
    await openToday(page);
    await expect(todayRow(page, inv.id)).toBeVisible({ timeout: 30_000 });

    await page.getByTestId(`billing-today-menu-${inv.id}`).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId(`billing-today-menu-whatsapp-${inv.id}`).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^KUDE-.*\.pdf$/);

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __waCalls: unknown[] }).__waCalls.length))
      .toBeGreaterThan(0);
    const calls = await page.evaluate(
      () => (window as unknown as { __waCalls: { url: string; target: string }[] }).__waCalls,
    );
    // The list row carries no phone: it read the invoice, so the chat opens against the client's contact.
    expect(calls[0].url).toContain("https://web.whatsapp.com/send?phone=595981123456");
    expect(calls[0].target).toBe("femme-whatsapp");
    const message = decodeURIComponent(calls[0].url.split("text=")[1]);
    expect(message).toContain(inv.fullName);
    expect(message).toContain(inv.invoiceNumberFormatted);
    expect(message).toMatch(/Gs\.\s?45\.000\b/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("AC7 · si la acción falla se muestra un aviso de error y el botón ⋯ vuelve a quedar disponible", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const inv = await createInvoice(request, token, seed, "E2E HU72 falla", "APPROVED");
    await openToday(page);
    await expect(todayRow(page, inv.id)).toBeVisible({ timeout: 30_000 });

    await page.route(`**/api/invoices/${inv.id}/sifen/kude`, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"KUDE_FAILED"}' }),
    );
    await page.getByTestId(`billing-today-menu-${inv.id}`).click();
    await page.getByTestId(`billing-today-menu-download-${inv.id}`).click();

    await expect(page.getByTestId("billing-today-notice")).toBeVisible();
    await expect(page.getByTestId(`billing-today-menu-${inv.id}`)).toBeEnabled();
    await page.unroute(`**/api/invoices/${inv.id}/sifen/kude`);
  });
});
