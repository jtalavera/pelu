import { expect, test } from "@playwright/test";
import {
  apiPostJson,
  createAppointmentApi,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  calendarVisibleWeekSlotIso,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-12 · Ver y editar perfil de cliente", () => {
  test("ruta de detalle responde (404 controlado si no hay id)", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients/999999");
    await expect(page.getByText("Could not load client profile.")).toBeVisible();
  });

  test("HU-12 · 1 y 2 listado y columnas visibles", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const name = `E2E Prof ${Date.now()}`;
    const phone = `099${String(Date.now()).slice(-7)}`;
    await apiPostJson(request, token, "/api/clients", {
      fullName: name,
      phone,
      email: null,
      ruc: null,
    });

    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByPlaceholder("Search by name, phone, or RUC…").first().fill(name);
    // Names are stored in UPPERCASE (issue #155 AC3), regardless of the case sent here.
    await expect(page.getByText(name.toUpperCase(), { exact: true }).first()).toBeVisible();
    // The row shows "phone · last visit" in a single secondary line.
    await expect(page.locator('[data-testid^="client-row-"]').filter({ hasText: phone })).toContainText(
      "No visits",
    );
  });

  test("HU-12 · 3 perfil e historial (pestañas)", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const c = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Tabs ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });

    await loginAsDemo(page);
    await page.goto(`/app/clients/${c.id}`);
    // Names are stored in UPPERCASE (issue #155 AC3) — match case-insensitively.
    await expect(page.getByRole("heading", { name: /E2E Tabs/i })).toBeVisible();
    // HU-70: appointments and invoices live in their own tabs.
    await page.getByRole("tab", { name: "Appointments" }).click();
    await expect(page.getByTestId("client-appointments-empty")).toBeVisible();
    await page.getByRole("tab", { name: "Invoices" }).click();
    await expect(page.getByTestId("client-invoices-empty")).toBeVisible();
  });

  test("HU-12 / HU-25 historial con turno (próximo) y comprobante emitido al cliente", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const c = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Hist ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });
    await createAppointmentApi(request, token, {
      clientId: c.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(11, 0),
    });
    const inv = await apiPostJson<{ id: number; invoiceNumberFormatted: string }>(
      request,
      token,
      "/api/invoices",
      {
        clientId: c.id,
        clientDisplayName: null,
        clientRucOverride: null,
        discountType: null,
        discountValue: null,
        lines: [
          { serviceId: null, description: "E2E hist", quantity: 1, unitPrice: 25_000 },
        ],
        payments: [{ method: "CASH", amount: 25_000 }],
      },
    );

    await loginAsDemo(page);
    await page.goto(`/app/clients/${c.id}`);
    await page.getByRole("tab", { name: "Appointments" }).click();
    await expect(page.getByTestId("client-next-appointment")).toContainText(seed.serviceFullName);
    await page.getByRole("tab", { name: "Invoices" }).click();
    const item = page.getByTestId("client-invoice-item");
    await expect(item).toContainText(inv.invoiceNumberFormatted);
    // Invoice total (25.000) must display with dot separator, no decimals
    await expect(item).toContainText("Gs. 25.000");
  });

  test("HU-12 · 4 edición con validación RUC", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const c = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Val ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });

    await loginAsDemo(page);
    await page.goto(`/app/clients/${c.id}`);
    await page.getByTestId("client-section-fiscal-toggle").click();
    await page.locator("#detail-identity-document-number").fill("bad");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Invalid RUC. Use digits, one hyphen, and digits (e.g. 80000005-6).", {
        exact: true,
      }),
    ).toBeVisible();
  });
});
