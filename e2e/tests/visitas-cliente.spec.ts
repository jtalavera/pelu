import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiPostJson,
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
 * summary, HU-67): OPEN and VOIDED records never count.
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
  test("cuenta solo los servicios cerrados en la ficha y en el listado; 'Nuevos este mes' excluye a quien ya vino", async ({
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
    const row = page.locator("tbody tr").filter({ hasText: regular.fullName });
    await expect(row).toContainText("2 visits");
    // "Last visit" shows a date (e.g. "Oct 22, 2026") instead of "—".
    await expect(row).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);

    // "New this month" = clients without visits: the fresh one shows, the regular one doesn't.
    await page.locator("#clients-inline-search").fill(`E2E Visitas ${suffix}`);
    await expect(page.locator("tbody tr").filter({ hasText: fresh.fullName })).toBeVisible();
    await page.getByRole("button", { name: "New this month" }).click();
    await expect(page.locator("tbody tr").filter({ hasText: fresh.fullName })).toBeVisible();
    await expect(page.locator("tbody tr").filter({ hasText: regular.fullName })).toHaveCount(0);
  });
});
