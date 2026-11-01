import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Bugfix · "0 visitas": the stored `clients.visit_count` was never incremented, so every client
 * showed 0 visits, the list's "Last visit" was always "—" and the "New this month" filter matched
 * every client. Visits are now the client's CLOSED service records (same rule as the profile
 * summary, HU-67): OPEN and VOIDED records never count. "New this month" now filters by the
 * client's registration date (`clients.created_at`, V87) since the 1st of the current month.
 */
test.describe.configure({ mode: "serial" });

type Seed = { serviceId: number; professionalId: number };

async function serviceRecord(
  request: APIRequestContext,
  token: string,
  clientId: number,
  seed: Seed,
): Promise<{ id: number }> {
  return apiPostJson<{ id: number }>(request, token, "/api/service-records", {
    clientId,
    lines: [{ serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 1, unitPrice: 80_000 }],
    tips: [],
  });
}

/** An invoice that references the record closes it (InvoiceService auto-close). */
async function closedServiceRecord(
  request: APIRequestContext,
  token: string,
  clientId: number,
  seed: Seed,
) {
  const rec = await serviceRecord(request, token, clientId, seed);
  await apiPostJson(request, token, "/api/invoices", {
    clientId,
    clientDisplayName: null,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [
      {
        serviceId: seed.serviceId,
        description: "E2E visitas",
        quantity: 1,
        unitPrice: 80_000,
        discountType: null,
        discountValue: null,
      },
    ],
    payments: [{ method: "CASH", amount: 80_000 }],
    serviceRecordId: rec.id,
    tipsAmount: 0,
  });
}

test.describe("Visitas de la cliente", () => {
  test("cuenta solo los servicios cerrados en la ficha y en el listado; 'Nuevos este mes' filtra por fecha de alta", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const suffix = Date.now();
    const regular = (await seedClient(request, token, `E2E Visitas Regular ${suffix}`)) as {
      id: number;
      fullName: string;
    };
    const fresh = (await seedClient(request, token, `E2E Visitas Nueva ${suffix}`)) as {
      id: number;
      fullName: string;
    };

    // Two closed visits, plus an open and a voided record that must not count.
    await closedServiceRecord(request, token, regular.id, seed);
    await closedServiceRecord(request, token, regular.id, seed);
    await serviceRecord(request, token, regular.id, seed);
    const voided = await serviceRecord(request, token, regular.id, seed);
    await apiPostJson(request, token, `/api/service-records/${voided.id}/void`, {
      voidReason: "E2E visitas anulado",
    });

    await loginAsDemo(page);

    // Profile header.
    await page.goto(`/app/clients/${regular.id}`);
    await expect(page.getByTestId("client-header-facts")).toContainText("2 visits");
    await page.goto(`/app/clients/${fresh.id}`);
    await expect(page.getByTestId("client-header-facts")).toContainText("0 visits");

    // Client list: visits and last visit columns.
    await page.goto("/app/clients");
    await page.locator("#clients-inline-search").fill(`E2E Visitas Regular ${suffix}`);
    // Rows show "phone · Last visit <date>" (the visit count lives in the profile header).
    const row = page.locator('[data-testid^="client-row-"]').filter({ hasText: regular.fullName });
    await expect(row).toContainText(/Last visit [A-Z][a-z]{2} \d{1,2}, \d{4}/);

    // "New this month" = registered since the 1st of this month — visits don't matter. A client
    // registered 40 days ago (always last month or earlier) is excluded.
    const old = (await seedClient(request, token, `E2E Visitas Antigua ${suffix}`)) as {
      id: number;
      fullName: string;
    };
    const backdate = await request.post(
      `${API_BASE}/api/admin/client-test-support/${old.id}/backdate-created/40`,
      { headers: authHeaders(token) },
    );
    expect(backdate.ok(), await backdate.text()).toBeTruthy();

    await page.reload();
    // All three share the run suffix in their names.
    await page.locator("#clients-inline-search").fill(String(suffix));
    await expect(page.locator('[data-testid^="client-row-"]').filter({ hasText: old.fullName })).toBeVisible();
    await page.getByTestId("clients-filter-new").click();
    await expect(page.locator('[data-testid^="client-row-"]').filter({ hasText: fresh.fullName })).toBeVisible();
    await expect(page.locator('[data-testid^="client-row-"]').filter({ hasText: regular.fullName })).toBeVisible();
    await expect(page.locator('[data-testid^="client-row-"]').filter({ hasText: old.fullName })).toHaveCount(0);
  });
});
