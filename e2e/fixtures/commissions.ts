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
  scope:
    | "BASE"
    | "DEFAULT_SERVICE"
    | "DEFAULT_PRODUCT"
    | "PERIODICITY"
    | "RULE"
    | "GROUP_RULE"
    | "FIXED_DESTINATION"
    | "AGUINALDO_ENABLED"
    | "AGUINALDO_DEFAULT"
    | "RETENTION_PROFILE";
  serviceId?: number | null;
  professionalId?: number | null;
  /** HU-COM-14: commission group of a GROUP_RULE. */
  groupId?: number | null;
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
  fixedAmount: number;
  fixedToProfessional: boolean;
  retentionPercent: number;
  retentionAmount: number;
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

// ── Comisiones (HU-COM-15): Inicio · Liquidar · Equipo · Actividad · Configurar ──────────────────

export type CommissionsSection = "home" | "settle" | "team" | "activity" | "setup";

/** Opens Comisiones from the app menu, optionally going straight to one of its five places. */
export async function openCommissions(page: Page, section?: CommissionsSection) {
  await page.getByRole("link", { name: "Commissions" }).click();
  await expect(page.getByTestId("commissions")).toBeVisible();
  if (section && section !== "home") await page.getByTestId(`commissions-nav-${section}`).click();
}

/**
 * Compatibility helper for the places the old «⋯ More» menu used to reach: Reports and Movements
 * live in Activity, Settings in Setup, Aguinaldo inside Team (only when the salon enabled it).
 */
export async function openCommissionsMore(page: Page, name: "Reports" | "Settings" | "Aguinaldo") {
  if (name === "Reports") {
    await page.getByTestId("commissions-nav-activity").click();
    await page.getByTestId("activity-tab-reports").click();
  } else if (name === "Settings") {
    await page.getByTestId("commissions-nav-setup").click();
  } else {
    await page.getByTestId("commissions-nav-team").click();
    await page.getByTestId("team-tab-aguinaldo").click();
  }
}

/**
 * Setup (HU-COM-18): the steps are folded and only the first pending one opens by itself, so this makes
 * sure step N is open (opening it when it is not) before touching what is inside it.
 */
export async function openSetupStep(page: Page, n: 1 | 2 | 3 | 4) {
  const toggle = page.getByTestId(`config-step-${n}-toggle`);
  await expect(toggle).toBeVisible();
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
  }).toPass();
}

/** Setup › «Excepciones por servicio» (HU-COM-16), optionally on its Services or Products view. */
export async function openExceptions(page: Page, kind?: "SERVICE" | "PRODUCT") {
  await openCommissions(page, "setup");
  await page.getByTestId("config-exceptions-link").click();
  await expect(page.getByTestId("commissions-exceptions")).toBeVisible();
  if (kind) await page.getByTestId(`rules-kind-${kind}`).click();
}

/** The row of a professional in «Liquidar» (names come uppercased from the backend). */
export const liquidarRow = (page: Page, name: string) =>
  page.getByTestId("liquidar-row").filter({ hasText: name });

/** Opens one of the stage tabs of Liquidar: only the rows of the open tab are shown. */
export async function liquidarTab(page: Page, status: "UNSETTLED" | "DRAFT" | "APPROVED" | "PAID") {
  await page.getByTestId(`liquidar-tab-${status}`).click();
  await expect(page.getByTestId(`liquidar-tab-${status}`)).toHaveAttribute("aria-selected", "true");
}

/** Voids a draft from its row: «⋯» opens the menu and «Void» is its option (on the «To approve» tab). */
export async function liquidarVoidRow(page: Page, name: string) {
  await liquidarRow(page, name).getByTestId("liquidar-row-more").click();
  await page.getByTestId("liquidar-row-void").click();
}

/** Liquidar › step N (1 generate, 2 approve, 3 pay): opens its tab, uses the main button and confirms. */
export async function liquidarStep(page: Page, step: 1 | 2 | 3) {
  await liquidarTab(page, (["UNSETTLED", "DRAFT", "APPROVED"] as const)[step - 1]);
  await page.getByTestId("liquidar-main-action").click();
  await page.getByTestId("liquidar-confirm").click();
}

/** Opens a professional's page in Equipo, optionally on one of its tabs. */
export async function openProfessional(page: Page, name: string, tab?: "summary" | "rules" | "aguinaldo" | "history") {
  await page.getByTestId("commissions-nav-team").click();
  await page.getByTestId("team-card").filter({ hasText: name }).click();
  await expect(page.getByTestId("commission-professional")).toBeVisible();
  if (tab && tab !== "summary") await page.getByTestId(`pro-tab-${tab}`).click();
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

// ── HU-COM-14: groups, retention and aguinaldo ───────────────────────────────────────────────

export async function createGroup(request: APIRequestContext, token: string, name: string) {
  return apiPostJson<{ id: number; name: string }>(request, token, "/api/commissions/groups", { name });
}

export async function assignToGroup(
  request: APIRequestContext,
  token: string,
  groupId: number,
  serviceIds: number[],
) {
  return apiPostJson<{ changed: number }>(request, token, "/api/commissions/groups/assign", {
    assignments: serviceIds.map((serviceId) => ({ serviceId, groupId })),
  });
}

/** Creates a catalog item (IVA 10 %) in the world's tenant. */
export async function createCatalogItem(
  request: APIRequestContext,
  token: string,
  world: CommissionWorld,
  name: string,
  opts: { kind?: "SERVICE" | "PRODUCT"; price?: number } = {},
): Promise<{ id: number; name: string }> {
  const kind = opts.kind ?? "SERVICE";
  const category = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
    name: `${kind === "PRODUCT" ? "Reventa" : "Cat"} ${name} ${Date.now()}${Math.floor(Math.random() * 1000)}`,
    accentKey: "stone",
    kind,
  });
  return apiPostJson<{ id: number; name: string }>(request, token, "/api/services", {
    name,
    categoryId: category.id,
    taxId: world.taxId,
    priceMinor: opts.price ?? 100000,
    durationMinutes: 30,
    kind,
    sku: kind === "PRODUCT" ? `SKU-${Date.now()}${Math.floor(Math.random() * 1000)}` : null,
  });
}

export async function createProfessional(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<{ id: number; name: string }> {
  const created = await apiPostJson<{ id: number; fullName: string }>(request, token, "/api/professionals", {
    fullName: name,
    phone: null,
    email: null,
    photoDataUrl: null,
  });
  return { id: created.id, name: created.fullName };
}

export type AguinaldoSummary = {
  enabled: boolean;
  totalBalance: number;
  balances: { professionalId: number; professionalName: string; balance: number; paid: number; retained: number }[];
};

export const aguinaldoSummary = (request: APIRequestContext, token: string) =>
  apiGetJson<AguinaldoSummary>(request, token, "/api/commissions/aguinaldo");

/** Approves a settlement through the API (its retention enters the aguinaldo fund). */
export async function approveSettlementApi(request: APIRequestContext, token: string, id: number) {
  const res = await request.post(`${API_BASE}/api/commissions/settlements/${id}/approve`, {
    headers: authHeaders(token),
    data: {},
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}
