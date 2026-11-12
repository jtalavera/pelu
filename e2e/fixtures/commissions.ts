import { expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  API_BASE,
  apiGetJson,
  apiPostJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginPlatformAdminApi,
} from "./api";
import { loginAs } from "./auth";

/**
 * Módulo de comisiones e2e world (requirements/prds/femme_modulo_comisiones_v1.md).
 *
 * Each spec file provisions its OWN tenant (so commission settings, rules and settlements never
 * leak into the shared demo tenant or between specs) and turns the COMMISSIONS flag on globally
 * for the duration of the file (`enableCommissionsGlobally` / `restoreCommissionsGlobal`) — the
 * flag starts OFF globally (HU-COM-11) and resolves as global AND tier AND tenant.
 */
export const COMMISSIONS_FLAG = "COMMISSIONS";
export const PASSWORD = "ValidPass1!";

export type CommissionWorld = {
  tenantId: number;
  adminEmail: string;
  adminToken: string;
  taxId: number;
  service: { id: number; name: string };
  service2: { id: number; name: string };
  product: { id: number; name: string };
  ana: { id: number; name: string };
  bea: { id: number; name: string };
};

export async function setGlobalFlag(request: APIRequestContext, key: string, enabled: boolean) {
  const token = await loginPlatformAdminApi(request);
  const res = await request.put(`${API_BASE}/api/admin/feature-flags/${key}`, {
    headers: authHeaders(token),
    data: { enabled },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function setTenantFlag(
  request: APIRequestContext,
  tenantId: number,
  key: string,
  enabled: boolean,
) {
  const token = await loginPlatformAdminApi(request);
  const res = await request.put(`${API_BASE}/api/admin/feature-flags/tenants/${tenantId}/${key}`, {
    headers: authHeaders(token),
    data: { enabled },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export const enableCommissionsGlobally = (request: APIRequestContext) =>
  setGlobalFlag(request, COMMISSIONS_FLAG, true);
export const restoreCommissionsGlobal = (request: APIRequestContext) =>
  setGlobalFlag(request, COMMISSIONS_FLAG, false);

export async function loginApi(request: APIRequestContext, email: string, password = PASSWORD) {
  const res = await request.post(`${API_BASE}/api/auth/login`, { data: { email, password } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { accessToken: string }).accessToken;
}

/** Creates a tenant with an activated admin, commissions ON and SIFEN OFF, plus seed data. */
export async function provisionCommissionWorld(
  request: APIRequestContext,
  label: string,
  opts: { commissionsEnabled?: boolean } = {},
): Promise<CommissionWorld> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const platform = await loginPlatformAdminApi(request);
  const tiers = await apiGetJson<{ id: number }[]>(request, platform, "/api/platform/tenants/tiers");
  const tenant = await apiPostJson<{ id: number }>(request, platform, "/api/platform/tenants", {
    name: `${label} ${suffix}`,
    domain: null,
    tierId: tiers[0].id,
  });
  const adminEmail = `com-${suffix}@test.com`;
  const invite = await apiPostJson<{ rawToken: string }>(
    request,
    platform,
    `/api/platform/tenants/${tenant.id}/admins`,
    { email: adminEmail },
  );
  const act = await request.post(`${API_BASE}/api/auth/activate`, {
    data: { token: invite.rawToken, password: PASSWORD, confirmPassword: PASSWORD, fullName: "Admin Comisiones" },
  });
  expect(act.ok(), await act.text()).toBeTruthy();
  await setTenantFlag(request, tenant.id, "SIFEN_ELECTRONIC_INVOICING", false);
  await setTenantFlag(request, tenant.id, COMMISSIONS_FLAG, opts.commissionsEnabled ?? true);

  const token = await loginApi(request, adminEmail);
  await ensureCashSessionOpenApi(request, token);
  await ensureActiveFiscalStampForInvoices(request, token);
  const taxes = await apiGetJson<{ id: number; rate: number }[]>(request, token, "/api/taxes");
  const iva10 = taxes.find((t) => Number(t.rate) === 10) ?? taxes[0];

  const svcCat = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
    name: `Peluquería ${suffix}`,
    accentKey: "stone",
    kind: "SERVICE",
  });
  const prodCat = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
    name: `Reventa ${suffix}`,
    accentKey: "stone",
    kind: "PRODUCT",
  });
  const mk = async (name: string, categoryId: number, kind: string) =>
    apiPostJson<{ id: number; name: string }>(request, token, "/api/services", {
      name,
      categoryId,
      taxId: iva10.id,
      priceMinor: 110000,
      durationMinutes: 30,
      kind,
      sku: kind === "PRODUCT" ? `SKU-${suffix}` : null,
    });
  const service = await mk(`Corte ${suffix}`, svcCat.id, "SERVICE");
  const service2 = await mk(`Color ${suffix}`, svcCat.id, "SERVICE");
  const product = await mk(`Shampoo ${suffix}`, prodCat.id, "PRODUCT");
  const prof = async (name: string) =>
    apiPostJson<{ id: number; fullName: string }>(request, token, "/api/professionals", {
      fullName: name,
      phone: null,
      email: null,
      photoDataUrl: null,
    });
  const ana = await prof(`Ana ${suffix}`);
  const bea = await prof(`Bea ${suffix}`);
  return {
    tenantId: tenant.id,
    adminEmail,
    adminToken: token,
    taxId: iva10.id,
    service: { id: service.id, name: service.name },
    service2: { id: service2.id, name: service2.name },
    product: { id: product.id, name: product.name },
    ana: { id: ana.id, name: ana.fullName },
    bea: { id: bea.id, name: bea.fullName },
  };
}

export type LineSpec = {
  serviceId: number;
  name: string;
  price?: number;
  professionalId?: number | null;
  discountPercent?: number;
};

/** Issues a plain invoice (occasional client, cash) through the API. */
export async function issueInvoice(
  request: APIRequestContext,
  token: string,
  lines: LineSpec[],
): Promise<{ id: number }> {
  const net = (l: LineSpec) => {
    const gross = l.price ?? 110000;
    return l.discountPercent ? gross - Math.round((gross * l.discountPercent) / 100) : gross;
  };
  const total = lines.reduce((sum, l) => sum + net(l), 0);
  return apiPostJson<{ id: number }>(request, token, "/api/invoices", {
    clientId: null,
    clientDisplayName: "Cliente Comisiones E2E",
    clientRucOverride: null,
    discountType: "NONE",
    discountValue: null,
    lines: lines.map((l) => ({
      serviceId: l.serviceId,
      description: l.name,
      quantity: 1,
      unitPrice: l.price ?? 110000,
      discountType: l.discountPercent ? "PERCENT" : null,
      discountValue: l.discountPercent ?? null,
      professionalId: l.professionalId ?? null,
    })),
    payments: [{ method: "CASH", amount: total, cardBrand: null, cardBrandOtherDescription: null }],
  });
}

export async function voidInvoice(request: APIRequestContext, token: string, invoiceId: number) {
  const res = await request.post(`${API_BASE}/api/invoices/${invoiceId}/void`, {
    headers: authHeaders(token),
    data: { voidReason: "Anulación e2e comisiones" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export type Change = {
  scope: "BASE" | "DEFAULT_SERVICE" | "DEFAULT_PRODUCT" | "PERIODICITY" | "RULE";
  serviceId?: number | null;
  professionalId?: number | null;
  value: string | null;
};

export async function applyChanges(
  request: APIRequestContext,
  token: string,
  changes: Change[],
  applyMode: "IMMEDIATE" | "NEXT_PERIOD" | "PERIOD_START" | null = "IMMEDIATE",
  opts: { replacePending?: boolean; preview?: boolean } = {},
) {
  return apiPostJson<{
    applyMode: string;
    effectiveFrom: string;
    recalculation: { entriesRecalculated: number; entriesExcluded: number; deltaAmount: number } | null;
  }>(request, token, "/api/commissions/changes", {
    changes,
    applyMode,
    replacePending: opts.replacePending ?? false,
    preview: opts.preview ?? false,
  });
}

export type Entry = {
  id: number;
  professionalId: number;
  sourceType: string;
  reasonCode: string | null;
  invoiceId: number | null;
  serviceId: number | null;
  itemKind: string | null;
  baseType: string | null;
  baseAmount: number | null;
  percentApplied: number | null;
  ruleOrigin: string | null;
  commissionAmount: number;
  revision: number;
  settlementId: number | null;
  settlementStatus: string | null;
};

/** Commission entries of the tenant (today's month, default filters). Waits for accrual. */
export async function entries(request: APIRequestContext, token: string, query = ""): Promise<Entry[]> {
  return apiGetJson<Entry[]>(request, token, `/api/commissions/entries${query}`);
}

export async function entriesOfInvoice(
  request: APIRequestContext,
  token: string,
  invoiceId: number,
  expectedCount?: number,
): Promise<Entry[]> {
  let found: Entry[] = [];
  await expect
    .poll(
      async () => {
        found = (await entries(request, token)).filter((e) => e.invoiceId === invoiceId);
        return expectedCount === undefined ? found.length > 0 : found.length === expectedCount;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found;
}

export const sum = (es: Entry[]) => es.reduce((s, e) => s + Number(e.commissionAmount), 0);

export function todayYmd(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function generateSettlements(
  request: APIRequestContext,
  token: string,
  professionalIds: number[] = [],
  from = todayYmd(),
  to = todayYmd(),
) {
  return apiPostJson<{ id: number; status: string; totalAmount: number; professionalId: number }[]>(
    request,
    token,
    "/api/commissions/settlements/generate",
    { periodFrom: from, periodTo: to, professionalIds },
  );
}

export async function loginAdminUi(page: Page, world: CommissionWorld) {
  await loginAs(page, world.adminEmail, PASSWORD);
}

/** Creates a professional with system access (HU-23) and returns its id + email. */
export async function professionalWithAccess(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<{ id: number; email: string }> {
  const email = `com-prof-${Date.now()}${Math.floor(Math.random() * 1000)}@test.com`;
  const created = await apiPostJson<{ id: number }>(request, token, "/api/professionals", {
    fullName: name,
    email,
  });
  const grant = await apiPostJson<{ rawToken: string }>(
    request,
    token,
    `/api/professionals/${created.id}/grant-access`,
    {},
  );
  const act = await request.post(`${API_BASE}/api/auth/activate`, {
    data: { token: grant.rawToken, password: PASSWORD, confirmPassword: PASSWORD },
  });
  expect(act.ok(), await act.text()).toBeTruthy();
  return { id: created.id, email };
}

// ── Redesigned Comisiones screen (3 tabs + «⋯ More» menu) ────────────────────────────────────────

/** Opens a section of the «More» menu (Preview / Reports / Settings) on the Comisiones screen. */
export async function openCommissionsMore(page: Page, name: "Preview" | "Reports" | "Settings") {
  await page.getByTestId("commissions-more-trigger").click();
  await page.getByRole("menuitem", { name }).click();
}

/** Opens the «Generate settlements» dialog (the form lives in a dialog now). */
export async function openGenerateSettlements(page: Page) {
  await page.getByTestId("commission-generate-open").click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** Expands a folded section by its test id when it is collapsed. */
export async function expandSection(page: Page, toggleTestId: string) {
  const toggle = page.getByTestId(toggleTestId);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

/** Opens the «⋯» menu of a list row and picks an action by its visible name. */
export async function rowMenuAction(page: Page, row: ReturnType<Page["locator"]>, action: string) {
  await row.getByRole("button", { name: /actions/i }).click();
  await page.getByRole("menuitem", { name: action }).click();
}
