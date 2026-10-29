import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { goToInvoiceHistory, openInvoiceSifenTab, searchInvoiceHistory } from "../fixtures/billing";
import {
  apiBaseUrl,
  apiPostJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  loginPlatformAdminApi,
  seedCategoryServiceProfessional,
  seedClient,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo, loginAsPlatformAdmin } from "../fixtures/auth";

// SIFEN · canal de transmisión seleccionable por feature flag (SIFEN_SYNC_SUBMISSION).
//
// SIFEN producción respondió dCodRes=1264 "RUC del emisor no está habilitado para utilizar este
// tipo de servicio" al envío inmediato (SiRecepDE). El flag elige el canal por tenant, con la misma
// resolución que todo flag (global AND tier AND tenant): ON → envío inmediato (SiRecepDE); OFF en
// cualquier nivel → envío por lote (SiRecepLoteDE, un documento por lote) y el resultado se obtiene
// consultando el lote (consulta-lote).
//
// Qué cubre cada capa:
// - Ruteo por flag (ON → SiRecepDE, OFF → SiRecepLoteDE), lote aceptado/no encolado/sin respuesta,
//   y el polling (0361 en proceso → no reenvía; 0362 → resultado; 0360 → consulta por CDC y
//   reenvío): SifenInvoiceSubmissionServiceTest. Parseo real de recibe-lote/consulta-lote contra un
//   HttpsServer local: SifenBatchReceptionClientTest / SifenBatchResultQueryClientTest.
// - Este spec: el flag tal como lo ve y configura la plataforma (global, tier, tenant → efectivo),
//   y el ciclo de vida de una factura enviada por lote en la UI. En e2e SIFEN apunta a un puerto
//   inalcanzable (application-e2e.properties) y no hay un SIFEN falso, así que la respuesta de
//   consulta-lote se fabrica con /api/admin/sifen-test-support/.../simulate-batch-result, que pasa
//   por el mismo mapeo (SifenInvoiceSubmissionService#recordBatchQueryResult) que el polling real.

const DEMO_TENANT_ID = 1;
const SYNC_FLAG = "SIFEN_SYNC_SUBMISSION";
const SIFEN_FLAG = "SIFEN_ELECTRONIC_INVOICING";

type TenantFlagRow = {
  flagKey: string;
  globalEnabled: boolean;
  hasTier: boolean;
  tierEnabled: boolean | null;
  hasOverride: boolean;
  overrideEnabled: boolean | null;
  effectiveEnabled: boolean;
};

async function getGlobalFlag(request: APIRequestContext, token: string, flagKey: string) {
  const res = await request.get(`${apiBaseUrl()}/api/admin/feature-flags`, {
    headers: authHeaders(token),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const rows = (await res.json()) as Array<{
    flagKey: string;
    enabled: boolean;
    description: string | null;
  }>;
  return rows.find((r) => r.flagKey === flagKey);
}

async function createTier(request: APIRequestContext, token: string, name: string) {
  const res = await request.post(`${apiBaseUrl()}/api/platform/tiers`, {
    headers: authHeaders(token),
    data: { name, description: null },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: number };
}

async function createTenant(request: APIRequestContext, token: string, name: string, tierId: number) {
  const res = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
    headers: authHeaders(token),
    data: { name, domain: null, tierId },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: number };
}

async function setTierFlag(
  request: APIRequestContext,
  token: string,
  tierId: number,
  enabled: boolean,
) {
  const res = await request.put(
    `${apiBaseUrl()}/api/platform/tiers/${tierId}/feature-flags/${SYNC_FLAG}`,
    { headers: authHeaders(token), data: { enabled } },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function setTenantFlag(
  request: APIRequestContext,
  token: string,
  tenantId: number,
  enabled: boolean,
) {
  const res = await request.put(
    `${apiBaseUrl()}/api/admin/feature-flags/tenants/${tenantId}/${SYNC_FLAG}`,
    { headers: authHeaders(token), data: { enabled } },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function effectiveSyncFlag(request: APIRequestContext, token: string, tenantId: number) {
  const res = await request.get(`${apiBaseUrl()}/api/admin/feature-flags/tenants/${tenantId}`, {
    headers: authHeaders(token),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const row = ((await res.json()) as TenantFlagRow[]).find((r) => r.flagKey === SYNC_FLAG);
  expect(row, `${SYNC_FLAG} must be listed for the tenant`).toBeTruthy();
  return row!;
}

async function createInvoice(request: APIRequestContext, label: string) {
  const token = await loginAsDemoApi(request);
  const seed = await seedCategoryServiceProfessional(request, token);
  const client = await seedClient(request, token, `${label} ${Date.now()}`);
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
        unitPrice: 50000,
      },
    ],
    payments: [{ method: "CASH", amount: 50000 }],
  });
  return { invoiceId: invoice.id, clientName: client.fullName };
}

async function supportPost(request: APIRequestContext, path: string, data?: unknown) {
  const res = await request.post(`${apiBaseUrl()}/api/admin/sifen-test-support${path}`, {
    data,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function openInvoiceStatus(page: Page, clientName: string) {
  await loginAsDemo(page);
  await page.goto("/app/billing");
  await goToInvoiceHistory(page);
  await searchInvoiceHistory(page, clientName);
  const row = page
    .locator('[data-testid^="invoice-history-row-"]')
    .filter({ hasText: clientName })
    .filter({ visible: true });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await openInvoiceSifenTab(page);
  return page.getByTestId("sifen-status-section");
}

test.describe("SIFEN · canal de envío por feature flag (SIFEN_SYNC_SUBMISSION)", () => {
  test("el flag existe a nivel global, encendido por defecto (envío inmediato) y se ve en Funcionalidades Globales", async ({
    page,
    request,
  }) => {
    const token = await loginPlatformAdminApi(request);
    const flag = await getGlobalFlag(request, token, SYNC_FLAG);
    expect(flag, `${SYNC_FLAG} must be seeded`).toBeTruthy();
    expect(flag!.enabled).toBe(true);
    expect(flag!.description).toContain("SiRecepDE");
    expect(flag!.description).toContain("SiRecepLoteDE");

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/global-feature-flags");
    const row = page.getByTestId(`global-flag-row-${SYNC_FLAG}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("SiRecepLoteDE");
    await expect(page.locator(`#global-flag-${SYNC_FLAG}`)).toBeChecked();
  });

  test("el valor efectivo es global AND tier AND tenant: apagarlo en el tier o en el tenant elige el envío por lote", async ({
    request,
  }) => {
    const token = await loginPlatformAdminApi(request);
    const tier = await createTier(request, token, `E2E Lote Tier ${Date.now()}`);
    const tenant = await createTenant(request, token, `E2E Lote Tenant ${Date.now()}`, tier.id);

    // Global ON, tier and tenant inherit → envío inmediato.
    let row = await effectiveSyncFlag(request, token, tenant.id);
    expect(row.globalEnabled).toBe(true);
    expect(row.hasTier).toBe(false);
    expect(row.hasOverride).toBe(false);
    expect(row.effectiveEnabled).toBe(true);

    // Tenant OFF → envío por lote, for this tenant only.
    await setTenantFlag(request, token, tenant.id, false);
    row = await effectiveSyncFlag(request, token, tenant.id);
    expect(row.effectiveEnabled).toBe(false);
    expect((await effectiveSyncFlag(request, token, DEMO_TENANT_ID)).effectiveEnabled).toBe(true);

    // Tenant ON but tier OFF → still envío por lote (a level can only restrict).
    await setTenantFlag(request, token, tenant.id, true);
    await setTierFlag(request, token, tier.id, false);
    row = await effectiveSyncFlag(request, token, tenant.id);
    expect(row.tierEnabled).toBe(false);
    expect(row.overrideEnabled).toBe(true);
    expect(row.effectiveEnabled).toBe(false);

    // Every level ON → envío inmediato again.
    await setTierFlag(request, token, tier.id, true);
    row = await effectiveSyncFlag(request, token, tenant.id);
    expect(row.effectiveEnabled).toBe(true);
  });

  test.describe("factura enviada por lote", () => {
    test.beforeEach(async ({ request }) => {
      const token = await loginAsDemoApi(request);
      await ensureActiveFiscalStampForInvoices(request, token);
      await ensureCashSessionOpenApi(request, token);
      // Same reason as sifen-hu-07: the invoice's SIFEN state is fabricated below, so issuance must
      // stay a plain (non-SIFEN) one — a real async transmit would race the fabrication calls.
      await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG, false);
    });

    test("mientras el lote no tiene resultado, verificar estado consulta el lote y la factura sigue pendiente de verificación", async ({
      page,
      request,
    }) => {
      test.setTimeout(60_000);
      const { invoiceId, clientName } = await createInvoice(request, "E2E Lote Pend");
      await supportPost(request, `/invoices/${invoiceId}/prepare-pending-in-batch/987654321`);

      const section = await openInvoiceStatus(page, clientName);
      await expect(section.getByText("Pending verification", { exact: true })).toBeVisible();

      const [checkResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/sifen/check-status") && r.request().method() === "POST",
          { timeout: 30_000 },
        ),
        page.getByTestId("sifen-check-status-button").click(),
      ]);
      expect(checkResponse.ok(), await checkResponse.text()).toBeTruthy();

      // consulta-lote is unreachable in e2e → "no answer" → the manual check then also asks by CDC
      // (SiConsDE, unreachable too) → the invoice stays pending (it is never resent while its lote
      // may still be processing).
      await expect(
        page
          .getByText("SIFEN has not answered yet. The invoice is still pending verification.")
          .first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(section.getByText("Pending verification", { exact: true })).toBeVisible();
    });

    test("con el lote todavía en procesamiento, si SIFEN aprueba el CDC la factura queda Aprobada", async ({
      page,
      request,
    }) => {
      test.setTimeout(60_000);
      const { invoiceId, clientName } = await createInvoice(request, "E2E Lote CDC Aprob");
      await supportPost(request, `/invoices/${invoiceId}/prepare-pending-in-batch/987654321`);
      await supportPost(request, `/invoices/${invoiceId}/simulate-cdc-cross-check`, {
        status: "APPROVED",
        resultCode: "0422",
        message: "CDC encontrado",
      });

      const section = await openInvoiceStatus(page, clientName);
      await expect(section.getByText("Approved", { exact: true }).first()).toBeVisible();
    });

    test("con el lote todavía en procesamiento, un CDC 'no existe' (0420) no rechaza la factura: sigue pendiente de verificación", async ({
      page,
      request,
    }) => {
      test.setTimeout(60_000);
      const { invoiceId, clientName } = await createInvoice(request, "E2E Lote CDC 0420");
      await supportPost(request, `/invoices/${invoiceId}/prepare-pending-in-batch/987654321`);
      await supportPost(request, `/invoices/${invoiceId}/simulate-cdc-cross-check`, {
        status: "REJECTED",
        resultCode: "0420",
        message: "Documento No Existe en SIFEN o ha sido Rechazado",
      });

      const section = await openInvoiceStatus(page, clientName);
      await expect(section.getByText("Pending verification", { exact: true })).toBeVisible();
      await expect(section.getByText("Not found / Rejected", { exact: true })).toHaveCount(0);
    });

    test("un lote concluido que aprueba el documento deja la factura Aprobada con su número de protocolo", async ({
      page,
      request,
    }) => {
      test.setTimeout(60_000);
      const { invoiceId, clientName } = await createInvoice(request, "E2E Lote Aprob");
      await supportPost(request, `/invoices/${invoiceId}/prepare-pending-in-batch/987654321`);
      await supportPost(request, `/invoices/${invoiceId}/simulate-batch-result`, {
        batchResultCode: "0362",
        status: "APPROVED",
        protocolNumber: "4455667788",
        resultCode: "0260",
        message: "Autorización del DE satisfactoria",
      });

      const section = await openInvoiceStatus(page, clientName);
      await expect(section.getByText("Approved", { exact: true }).first()).toBeVisible();
      await expect(section).toContainText("4455667788");
      await expect(section).toContainText("Autorización del DE satisfactoria");
    });

    test("un lote concluido que rechaza el documento deja la factura Rechazada con el motivo de SIFEN", async ({
      page,
      request,
    }) => {
      test.setTimeout(60_000);
      const { invoiceId, clientName } = await createInvoice(request, "E2E Lote Rech");
      await supportPost(request, `/invoices/${invoiceId}/prepare-pending-in-batch/987654321`);
      await supportPost(request, `/invoices/${invoiceId}/simulate-batch-result`, {
        batchResultCode: "0362",
        status: "REJECTED",
        protocolNumber: null,
        resultCode: "1264",
        message: "RUC del emisor no está habilitado para utilizar este tipo de servicio",
      });

      const section = await openInvoiceStatus(page, clientName);
      await expect(section.getByText("Not found / Rejected", { exact: true }).first()).toBeVisible();
      await expect(section).toContainText(
        "RUC del emisor no está habilitado para utilizar este tipo de servicio",
      );
    });
  });
});
