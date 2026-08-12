import { expect, test } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  isoDateLocal,
  listFiscalStamps,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";

test.describe.configure({ mode: "serial" });

async function setValidBusinessRuc(request: import("@playwright/test").APIRequestContext, token: string) {
  await apiPutJson(request, token, "/api/business-profile", {
    businessName: "Demo salon",
    ruc: "80000005-6",
    address: null,
    phone: null,
    contactEmail: null,
    logoDataUrl: null,
  });
}

test.describe("Issue #143 · Ajustes en pantalla de Clientes y timbrado", () => {
  test("AC1 · cliente inactivo no aparece en el buscador de clientes de Facturación", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await setValidBusinessRuc(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    const client = await seedClient(request, token, `E2E143 Inactive ${Date.now()}`);
    const deactivateRes = await request.post(`${API_BASE}/api/clients/${client.id}/deactivate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deactivateRes.ok()).toBeTruthy();

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 10));
    await expect(page.getByRole("button", { name: client.fullName })).toHaveCount(0);
  });

  test("AC2 · alerta de éxito al editar cliente usa el estilo verde (variant success)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E143 Green ${Date.now()}`);
    const phone = `098${String(Date.now()).slice(-7)}`;

    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    await page.locator("#detail-phone").fill(phone);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const alert = page.getByRole("alert").filter({ hasText: "Client updated successfully." });
    await expect(alert).toBeVisible();
    await expect(alert).toHaveClass(/emerald/);
  });

  test("AC3-4 · tabla de timbrados: activo primero, columnas visibles y acciones según estado", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const stamps = await listFiscalStamps(request, token);
    const active = stamps.find((s) => s.active);
    expect(active).toBeTruthy();

    const stampNumber = `1${Date.now().toString().slice(-7)}`;
    const inactive = await apiPostJson<{ id: number }>(request, token, "/api/fiscal-stamps", {
      stampNumber,
      validFrom: isoDateLocal(new Date()),
      validUntil: isoDateLocal(new Date(Date.now() + 365 * 86_400_000)),
      rangeFrom: 9_000_000,
      rangeTo: 9_000_100,
      initialEmissionNumber: 9_000_000,
    });

    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");

    await expect(page.getByRole("columnheader", { name: "Stamp no." })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("columnheader", { name: "Validity start" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Validity end" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "No. from" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "No. to" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Starting invoice no." })).toBeVisible();

    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow.getByText(active!.stampNumber, { exact: true })).toBeVisible();
    await expect(firstRow.getByText("Active", { exact: true })).toBeVisible();

    const inactiveRow = page.getByTestId(`fiscal-stamp-row-${inactive.id}`);
    await expect(inactiveRow.getByRole("button", { name: "Activate", exact: true })).toBeEnabled();
    await expect(inactiveRow.getByRole("button", { name: "Deactivate" })).toBeDisabled();

    const activeRow = page.getByTestId(`fiscal-stamp-row-${active!.id}`);
    await expect(activeRow.getByRole("button", { name: "Activate", exact: true })).toBeDisabled();
    await expect(activeRow.getByRole("button", { name: "Deactivate" })).toBeEnabled();
  });

  test("AC5 · Borrar solo aparece y funciona para timbrados sin facturas asociadas", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await setValidBusinessRuc(request, token);

    const freeStampNumber = `2${Date.now().toString().slice(-7)}`;
    const freeStamp = await apiPostJson<{ id: number }>(request, token, "/api/fiscal-stamps", {
      stampNumber: freeStampNumber,
      validFrom: isoDateLocal(new Date()),
      validUntil: isoDateLocal(new Date(Date.now() + 365 * 86_400_000)),
      rangeFrom: 9_100_000,
      rangeTo: 9_100_100,
      initialEmissionNumber: 9_100_000,
    });

    const usedStampNumber = `4${Date.now().toString().slice(-7)}`;
    const usedStamp = await apiPostJson<{ id: number }>(request, token, "/api/fiscal-stamps", {
      stampNumber: usedStampNumber,
      validFrom: isoDateLocal(new Date()),
      validUntil: isoDateLocal(new Date(Date.now() + 365 * 86_400_000)),
      rangeFrom: 9_200_000,
      rangeTo: 9_200_100,
      initialEmissionNumber: 9_200_000,
    });
    await apiPostJson(request, token, `/api/fiscal-stamps/${usedStamp.id}/activate`, {});
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E143 Used ${Date.now()}`);
    await apiPostJson(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: client.fullName,
      clientRucOverride: null,
      clientIdentityDocumentOverride: null,
      lines: [
        {
          serviceId: seed.serviceId,
          description: seed.serviceFullName,
          quantity: 1,
          unitPrice: 55_000,
        },
      ],
      payments: [{ method: "CASH", amount: 55_000 }],
    });

    // API-level guard: deleting a stamp with an associated invoice must be rejected.
    const rejectedDelete = await request.delete(`${API_BASE}/api/fiscal-stamps/${usedStamp.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(rejectedDelete.status()).toBe(409);

    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");

    const usedRow = page.getByTestId(`fiscal-stamp-row-${usedStamp.id}`);
    await expect(usedRow).toBeVisible({ timeout: 30_000 });
    await expect(usedRow.getByRole("button", { name: "Delete" })).toHaveCount(0);

    const freeRow = page.getByTestId(`fiscal-stamp-row-${freeStamp.id}`);
    await expect(freeRow).toBeVisible();
    await freeRow.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();

    await expect(page.getByTestId(`fiscal-stamp-row-${freeStamp.id}`)).toHaveCount(0);
    await expect(page.getByText("Stamp deleted successfully.")).toBeVisible();
  });

  test("AC6 · Cancelar aparece junto a Anular ficha y cancela la anulación sin anular la ficha", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E143 Void ${Date.now()}`);
    const record = await apiPostJson<{ id: number; status: string }>(
      request,
      token,
      "/api/service-records",
      {
        clientId: client.id,
        lines: [
          {
            serviceId: seed.serviceId,
            professionalId: seed.professionalId,
            quantity: 1,
            unitPrice: 50_000,
          },
        ],
        tips: [{ professionalId: seed.professionalId, amount: 0 }],
      },
    );

    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await page.locator("#service-record-history-text-filter").fill(client.fullName);
    await page.getByRole("button", { name: "View" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const voidBtn = dialog.getByRole("button", { name: "Void record" });
    await expect(voidBtn).toBeVisible();
    await voidBtn.click();

    // Cancelar now shows up in the same action row, right next to Anular ficha (which stays
    // visible but disabled while the void-reason form is open).
    const cancelBtn = dialog.getByRole("button", { name: "Cancel", exact: true });
    await expect(cancelBtn).toBeVisible();
    await expect(voidBtn).toBeVisible();
    await expect(voidBtn).toBeDisabled();

    await cancelBtn.click();
    await expect(dialog.getByText("Void service record")).toHaveCount(0);
    await expect(voidBtn).toBeEnabled();

    const refreshed = await request.get(`${API_BASE}/api/service-records/${record.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(refreshed.ok()).toBeTruthy();
    const refreshedBody = (await refreshed.json()) as { status: string };
    expect(refreshedBody.status).toBe("OPEN");
  });
});
