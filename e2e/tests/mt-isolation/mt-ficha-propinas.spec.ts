import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  apiGetJson,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
} from "../../fixtures/api";
import { loginAs } from "../../fixtures/auth";
import { raceAcrossTenants } from "../../fixtures/mt/concurrent";
import {
  expectCrossTenantForbidden,
  expectMoneyFormat,
  expectScopedList,
  expectUnchanged,
  snapshotTenant,
} from "../../fixtures/mt/probe";
import { getMtWorld, mtLoginToken } from "../../fixtures/mt/world";

/**
 * Task 7 — mt-ficha-propinas: service sheet (ficha de servicio) & tips (propinas) isolation.
 *
 * Five scenarios proving that a ficha / tip / tip-withdrawal in one tenant never bleeds into another:
 *  1. (anchor) The ficha history endpoint is tenant-scoped (cross-probe both ways) and a single
 *     foreign ficha is not individually addressable; the UI mirrors it — T-A opens its own ficha
 *     detail, T-B never sees the A ficha's client in its ficha history.
 *  2. `GET /api/propinas/report` is a per-tenant view: A's closed tip shows only in A's report, B's
 *     only in B's, and the amount renders in the house money format (dot thousands, no decimals).
 *  3. A tip withdrawal in A leaves a before/after fingerprint of B byte-identical.
 *  4. Emitting an invoice from a ficha in A advances A's own numbering sequence (a plain A invoice
 *     right after is consecutive); B is untouched.
 *  5. Simultaneous tip withdrawals in A and B both succeed, and each tenant's post-race balance
 *     reflects only its own withdrawal — never the other tenant's.
 *
 * All raw HTTP goes to `API_BASE` (= the :8081 mt backend — the mt config points
 * `PLAYWRIGHT_API_BASE_URL` there). Every assertion is "contains / excludes THIS id / value", never
 * an absolute count of a tenant's totals. A failing isolation assertion here (B's report shows A's
 * tip / A's withdrawal moves B's balance / B sees A's ficha / a cross-tenant GET returns 200) is a
 * suspected PRODUCT BUG — reported with evidence, never weakened.
 *
 * T-A specifics (its tier enables SIFEN e-invoicing):
 *  - `world.ts` provisioning gives T-A a valid SIFEN certificate + full issuer profile + active
 *    fiscal stamp, so `POST /api/invoices` actually creates & numbers an invoice.
 *  - A ficha always carries a `clientId` (identified receiver), so every T-A ficha-closing invoice
 *    body includes a run-unique `email` to satisfy SIFEN's `SIFEN_RECIPIENT_EMAIL_REQUIRED` guard.
 *    SIFEN transmit is pointed at an unreachable port, so the invoice is still created and numbered
 *    (the async submission just queues / fails). T-B (SIFEN off) needs no email.
 *
 * Re-run note: the mt backend is reused across local runs (`reuseExistingServer`). Fichas / invoices
 * / withdrawals cannot be deleted, so nothing here asserts on absolute totals — every check is a
 * delta or an id membership. Scenarios are independent: each seeds its own closed tip rather than
 * leaning on a sibling's side effects.
 */

const world = getMtWorld();

/** `Instant.parse`-compatible bounds wide enough to capture every tip row regardless of clock. */
const WIDE_REPORT_QUERY = "from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z";

/** Per-run seed so re-runs against a reused mt backend never collide on recipient emails. */
const RUN_SEED = Date.now();
let uniqueCounter = 0;
const runUnique = (): string => `${RUN_SEED}-${++uniqueCounter}`;

/** Numeric tail of a formatted invoice number (`"001-001-0000123"` → `123`). */
function parseInvoiceNumber(formatted: string): number {
  return Number(formatted.split("-").at(-1));
}

/** A RegExp matching `s` as a literal substring. */
function rxExact(s: string): RegExp {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

type Ficha = { id: number; status: string };
type EmittedInvoice = {
  id: number;
  invoiceNumber: number;
  invoiceNumberFormatted: string;
  total: string;
};
type TipReportResponse = {
  professionalTotals: Array<{ professionalId: number; professionalName: string; total: string }>;
  grandTotal: string;
};
type TipBalanceResponse = { professionalId: number; professionalName: string; balance: string };
type CreateTipWithdrawalResponse = {
  withdrawal: { id: number; professionalName: string; amount: string };
  newBalance: string;
};

/**
 * Creates an OPEN ficha de servicio with one line and (optionally) a tip for that line's
 * professional. Body shape verified against `issue-53` / `issue-120` seed helpers.
 */
async function createFicha(
  request: APIRequestContext,
  token: string,
  params: {
    clientId: number;
    serviceId: number;
    professionalId: number;
    unitPrice: number;
    tip?: number;
  },
): Promise<Ficha> {
  return apiPostJson<Ficha>(request, token, "/api/service-records", {
    clientId: params.clientId,
    lines: [
      {
        serviceId: params.serviceId,
        professionalId: params.professionalId,
        quantity: 1,
        unitPrice: params.unitPrice,
      },
    ],
    tips:
      params.tip && params.tip > 0
        ? [{ professionalId: params.professionalId, amount: params.tip }]
        : [],
  });
}

/**
 * Closes a ficha by emitting an invoice that references it — Propinas only reports / accumulates
 * tips on CLOSED records. `sifenEmail` is required for T-A (SIFEN on, identified receiver).
 */
async function closeFichaViaInvoice(
  request: APIRequestContext,
  token: string,
  params: {
    fichaId: number;
    clientId: number;
    serviceId: number;
    unitPrice: number;
    tipsAmount: number;
    sifenEmail?: string;
  },
): Promise<EmittedInvoice> {
  return apiPostJson<EmittedInvoice>(request, token, "/api/invoices", {
    clientId: params.clientId,
    clientDisplayName: null,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [
      {
        serviceId: params.serviceId,
        description: "MT ficha svc",
        quantity: 1,
        unitPrice: params.unitPrice,
        discountType: null,
        discountValue: null,
      },
    ],
    payments: [{ method: "CASH", amount: params.unitPrice }],
    serviceRecordId: params.fichaId,
    tipsAmount: params.tipsAmount,
    ...(params.sifenEmail ? { email: params.sifenEmail } : {}),
  });
}

/**
 * A plain (no-ficha) invoice with an UNIDENTIFIED receiver — a unique display name, `clientId: null`,
 * no RUC — so T-A's SIFEN recipient-email guard never trips. One CASH-paid line.
 */
async function emitPlainInvoice(
  request: APIRequestContext,
  token: string,
  label: string,
  unitPrice: number,
): Promise<EmittedInvoice> {
  const displayName = `MT ${label} ${runUnique()}`;
  return apiPostJson<EmittedInvoice>(request, token, "/api/invoices", {
    clientId: null,
    clientDisplayName: displayName,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [{ serviceId: null, description: `${displayName} svc`, quantity: 1, unitPrice }],
    payments: [{ method: "CASH", amount: unitPrice }],
  });
}

async function fullNameOf(
  request: APIRequestContext,
  token: string,
  path: string,
  id: number,
): Promise<string> {
  const rows = await apiGetJson<Array<{ id: number; fullName: string }>>(request, token, path);
  const row = rows.find((r) => r.id === id);
  if (!row) {
    throw new Error(`fullNameOf: id ${id} not found in ${path}`);
  }
  return row.fullName;
}

/** Picks one option from the report tab's professional `MultiSelect` filter (issue-120 pattern). */
async function pickReportProfessional(
  page: Page,
  filterText: string,
  optionNamePattern: RegExp,
): Promise<void> {
  const cb = page.getByRole("combobox", { name: "Professional", exact: true });
  await cb.click();
  await cb.fill(filterText);
  await page
    .getByRole("listbox", { name: "Professional", exact: true })
    .getByRole("button", { name: optionNamePattern })
    .first()
    .click();
}

async function tipBalance(
  request: APIRequestContext,
  token: string,
  professionalId: number,
): Promise<number> {
  const res = await apiGetJson<TipBalanceResponse>(
    request,
    token,
    `/api/propinas/balance?professionalId=${professionalId}`,
  );
  return Number(res.balance);
}

test.describe("mt-ficha-propinas · service sheet & tips isolation", () => {
  test.beforeAll(async ({ request }) => {
    // T-A emits SIFEN invoices to close fichas — make sure its active stamp still has range
    // headroom (the mt backend is shared across the whole suite).
    const tokenA = await mtLoginToken(request, world.tenantA);
    await ensureActiveFiscalStampForInvoices(request, tokenA);
  });

  // Scenario 1 (anchor) -----------------------------------------------------------------------
  test("ficha history is tenant-scoped both ways, and a foreign ficha is not addressable", async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000); // two full browser logins + two ficha-history flows

    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);

    const aClientId = world.tenantA.clientIds[0];
    const bClientId = world.tenantB.clientIds[0];
    const aClientName = await fullNameOf(request, tokenA, "/api/clients", aClientId);

    const aFicha = await createFicha(request, tokenA, {
      clientId: aClientId,
      serviceId: world.tenantA.catalog.serviceIds[0],
      professionalId: world.tenantA.professionalIds[0],
      unitPrice: 50_000,
    });
    const bFicha = await createFicha(request, tokenB, {
      clientId: bClientId,
      serviceId: world.tenantB.catalog.serviceIds[0],
      professionalId: world.tenantB.professionalIds[0],
      unitPrice: 40_000,
    });
    expect(aFicha.id).not.toBe(bFicha.id);

    // A's ficha history has A's new ficha and never B's; B's is the mirror image.
    await expectScopedList(request, tokenA, "/api/service-records?page=0&size=100", {
      includesIds: [aFicha.id],
      excludesIds: [bFicha.id],
    });
    await expectScopedList(request, tokenB, "/api/service-records?page=0&size=100", {
      includesIds: [bFicha.id],
      excludesIds: [aFicha.id],
    });

    // A single foreign ficha is not individually addressable across the tenant boundary.
    await expectCrossTenantForbidden(request, tokenB, `/api/service-records/${aFicha.id}`);
    await expectCrossTenantForbidden(request, tokenA, `/api/service-records/${bFicha.id}`);

    // --- UI: T-A admin opens the A ficha detail from its own history ---
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    try {
      await loginAs(pageA, world.tenantA.adminEmail, world.tenantA.adminPassword);
      await pageA.goto("/app/service-records");
      await pageA.getByRole("tab", { name: "History" }).click();
      await pageA.locator("#service-record-history-text-filter").fill(aClientName);
      const row = pageA.locator("tbody tr").filter({ hasText: aClientName }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click();
      await expect(pageA.getByRole("dialog", { name: "Service record detail" })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await ctxA.close();
    }

    // --- UI: T-B admin never sees the A ficha's client in its own ficha history ---
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    try {
      await loginAs(pageB, world.tenantB.adminEmail, world.tenantB.adminPassword);
      await pageB.goto("/app/service-records");
      await Promise.all([
        pageB.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/service-records" &&
            r.request().method() === "GET",
          { timeout: 25_000 },
        ),
        pageB.getByRole("tab", { name: "History" }).click(),
      ]);
      await pageB.locator("#service-record-history-text-filter").fill(aClientName);
      // The A client's name simply does not exist in B's tenant (B's clients are "MT Cliente
      // Boreal N") — so it must never surface in B's ficha history table.
      await expect(pageB.locator("tbody tr").filter({ hasText: aClientName })).toHaveCount(0);
    } finally {
      await ctxB.close();
    }
  });

  // Scenario 2 ------------------------------------------------------------------------------------
  test("propinas report is a per-tenant view, and the amount renders in house money format", async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);

    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    await ensureActiveFiscalStampForInvoices(request, tokenA);
    await ensureCashSessionOpenApi(request, tokenA);
    await ensureCashSessionOpenApi(request, tokenB);

    const aProfId = world.tenantA.professionalIds[0];
    const bProfId = world.tenantB.professionalIds[0];
    const aClientId = world.tenantA.clientIds[0];
    const bClientId = world.tenantB.clientIds[0];
    const aProfName = await fullNameOf(request, tokenA, "/api/professionals", aProfId);
    const aClientName = await fullNameOf(request, tokenA, "/api/clients", aClientId);

    const A_TIP = 30_000;
    const B_TIP = 15_000;

    const aFicha = await createFicha(request, tokenA, {
      clientId: aClientId,
      serviceId: world.tenantA.catalog.serviceIds[0],
      professionalId: aProfId,
      unitPrice: 50_000,
      tip: A_TIP,
    });
    await closeFichaViaInvoice(request, tokenA, {
      fichaId: aFicha.id,
      clientId: aClientId,
      serviceId: world.tenantA.catalog.serviceIds[0],
      unitPrice: 50_000,
      tipsAmount: A_TIP,
      sifenEmail: `mt-a-ficha-${runUnique()}@e2e.local`,
    });

    const bFicha = await createFicha(request, tokenB, {
      clientId: bClientId,
      serviceId: world.tenantB.catalog.serviceIds[0],
      professionalId: bProfId,
      unitPrice: 40_000,
      tip: B_TIP,
    });
    await closeFichaViaInvoice(request, tokenB, {
      fichaId: bFicha.id,
      clientId: bClientId,
      serviceId: world.tenantB.catalog.serviceIds[0],
      unitPrice: 40_000,
      tipsAmount: B_TIP,
    });

    // --- API: A's report contains A's professional summing ≥ A_TIP and NONE of B's professionals ---
    const aReport = await apiGetJson<TipReportResponse>(
      request,
      tokenA,
      `/api/propinas/report?${WIDE_REPORT_QUERY}`,
    );
    const aReportProfIds = new Set(aReport.professionalTotals.map((t) => t.professionalId));
    expect(aReportProfIds.has(aProfId), "A's report is missing A's own professional").toBe(true);
    const aProfTotal = Number(
      aReport.professionalTotals.find((t) => t.professionalId === aProfId)?.total ?? 0,
    );
    expect(aProfTotal).toBeGreaterThanOrEqual(A_TIP);
    for (const bId of world.tenantB.professionalIds) {
      expect(
        aReportProfIds.has(bId),
        `A's propinas report LEAKED B's professional ${bId}`,
      ).toBe(false);
    }

    // --- API: the mirror image for B ---
    const bReport = await apiGetJson<TipReportResponse>(
      request,
      tokenB,
      `/api/propinas/report?${WIDE_REPORT_QUERY}`,
    );
    const bReportProfIds = new Set(bReport.professionalTotals.map((t) => t.professionalId));
    expect(bReportProfIds.has(bProfId), "B's report is missing B's own professional").toBe(true);
    const bProfTotal = Number(
      bReport.professionalTotals.find((t) => t.professionalId === bProfId)?.total ?? 0,
    );
    expect(bProfTotal).toBeGreaterThanOrEqual(B_TIP);
    for (const aId of world.tenantA.professionalIds) {
      expect(
        bReportProfIds.has(aId),
        `B's propinas report LEAKED A's professional ${aId}`,
      ).toBe(false);
    }

    // --- UI (T-A, /app/propinas → "Tips report"): the amount renders dot-thousands, no decimals ---
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    try {
      await loginAs(pageA, world.tenantA.adminEmail, world.tenantA.adminPassword);
      await pageA.goto("/app/propinas");
      await expect(
        pageA.getByRole("tab", { name: "Tips report", selected: true }),
      ).toBeVisible({ timeout: 15_000 });

      await pickReportProfessional(pageA, aProfName.slice(0, 10), rxExact(aProfName));
      await pageA.getByRole("button", { name: "Search", exact: true }).click();

      const reportRows = pageA.getByTestId("propinas-report-table").locator("tbody tr");
      const tipRow = reportRows.filter({ hasText: aClientName }).first();
      await expect(tipRow).toBeVisible({ timeout: 15_000 });
      expectMoneyFormat(await tipRow.locator("td").nth(1).innerText());

      const grandTotalRow = reportRows.filter({ hasText: "Grand total" });
      await expect(grandTotalRow).toBeVisible();
      expectMoneyFormat(await grandTotalRow.locator("td").nth(1).innerText());
    } finally {
      await ctxA.close();
    }
  });

  // Scenario 3 ------------------------------------------------------------------------------------
  test("a tip withdrawal in A leaves a before/after snapshot of B byte-identical", async ({
    request,
  }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    await ensureActiveFiscalStampForInvoices(request, tokenA);
    await ensureCashSessionOpenApi(request, tokenA);

    const aProfId = world.tenantA.professionalIds[0];

    // Fingerprint B BEFORE any A activity.
    const beforeB = await snapshotTenant(request, tokenB);

    // Ensure A has a fresh closed tip for its professional.
    const A_TIP = 25_000;
    const aFicha = await createFicha(request, tokenA, {
      clientId: world.tenantA.clientIds[0],
      serviceId: world.tenantA.catalog.serviceIds[0],
      professionalId: aProfId,
      unitPrice: 50_000,
      tip: A_TIP,
    });
    await closeFichaViaInvoice(request, tokenA, {
      fichaId: aFicha.id,
      clientId: world.tenantA.clientIds[0],
      serviceId: world.tenantA.catalog.serviceIds[0],
      unitPrice: 50_000,
      tipsAmount: A_TIP,
      sifenEmail: `mt-a-ficha-${runUnique()}@e2e.local`,
    });

    const withdrawableBefore = await tipBalance(request, tokenA, aProfId);
    expect(withdrawableBefore).toBeGreaterThanOrEqual(A_TIP);

    const AMOUNT = 20_000; // ≤ the tip just seeded, so ≤ balance regardless of history
    const res = await apiPostJson<CreateTipWithdrawalResponse>(
      request,
      tokenA,
      "/api/propinas/withdrawals",
      { professionalId: aProfId, amount: AMOUNT },
    );
    expect(Number(res.newBalance)).toBe(withdrawableBefore - AMOUNT);
    expect(await tipBalance(request, tokenA, aProfId)).toBe(withdrawableBefore - AMOUNT);

    // B's fingerprint has not moved a single field.
    const afterB = await snapshotTenant(request, tokenB);
    expectUnchanged(beforeB, afterB);
  });

  // Scenario 4 ------------------------------------------------------------------------------------
  test("an invoice emitted from a ficha in A advances A's own numbering; B is untouched", async ({
    request,
  }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    await ensureActiveFiscalStampForInvoices(request, tokenA);
    await ensureCashSessionOpenApi(request, tokenA);

    const beforeB = await snapshotTenant(request, tokenB);

    const aFicha = await createFicha(request, tokenA, {
      clientId: world.tenantA.clientIds[0],
      serviceId: world.tenantA.catalog.serviceIds[0],
      professionalId: world.tenantA.professionalIds[0],
      unitPrice: 50_000,
      tip: 5_000,
    });
    const fichaInvoice = await closeFichaViaInvoice(request, tokenA, {
      fichaId: aFicha.id,
      clientId: world.tenantA.clientIds[0],
      serviceId: world.tenantA.catalog.serviceIds[0],
      unitPrice: 50_000,
      tipsAmount: 5_000,
      sifenEmail: `mt-a-ficha-${runUnique()}@e2e.local`,
    });
    // A plain invoice emitted immediately after must take the very next number in A's sequence.
    const plainInvoice = await emitPlainInvoice(request, tokenA, "A-ficha-seq", 60_000);

    const fichaNum = parseInvoiceNumber(fichaInvoice.invoiceNumberFormatted);
    const plainNum = parseInvoiceNumber(plainInvoice.invoiceNumberFormatted);
    expect(
      plainNum,
      `A's numbering was not consecutive across an invoice-from-ficha: ${fichaInvoice.invoiceNumberFormatted} -> ${plainInvoice.invoiceNumberFormatted}`,
    ).toBe(fichaNum + 1);
    // Server response bodies agree with each other (no client-side bookkeeping).
    expect(fichaInvoice.invoiceNumber).toBe(fichaNum);
    expect(plainInvoice.invoiceNumber).toBe(plainNum);

    // B saw none of it.
    const afterB = await snapshotTenant(request, tokenB);
    expectUnchanged(beforeB, afterB);

    // Constraint: leave A's cash session open for sibling specs.
    await ensureCashSessionOpenApi(request, tokenA);
  });

  // Scenario 5 (concurrency) -------------------------------------------------------------------
  test("simultaneous tip withdrawals in A and B: both succeed, each balance reflects only its own", async ({
    request,
  }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    await ensureActiveFiscalStampForInvoices(request, tokenA);
    await ensureCashSessionOpenApi(request, tokenA);
    await ensureCashSessionOpenApi(request, tokenB);

    const aProfId = world.tenantA.professionalIds[0];
    const bProfId = world.tenantB.professionalIds[0];

    // Pre-seed a closed tip in each tenant for its own professional.
    const A_TIP = 12_000;
    const B_TIP = 9_000;
    const aFicha = await createFicha(request, tokenA, {
      clientId: world.tenantA.clientIds[0],
      serviceId: world.tenantA.catalog.serviceIds[0],
      professionalId: aProfId,
      unitPrice: 50_000,
      tip: A_TIP,
    });
    await closeFichaViaInvoice(request, tokenA, {
      fichaId: aFicha.id,
      clientId: world.tenantA.clientIds[0],
      serviceId: world.tenantA.catalog.serviceIds[0],
      unitPrice: 50_000,
      tipsAmount: A_TIP,
      sifenEmail: `mt-a-ficha-${runUnique()}@e2e.local`,
    });
    const bFicha = await createFicha(request, tokenB, {
      clientId: world.tenantB.clientIds[0],
      serviceId: world.tenantB.catalog.serviceIds[0],
      professionalId: bProfId,
      unitPrice: 40_000,
      tip: B_TIP,
    });
    await closeFichaViaInvoice(request, tokenB, {
      fichaId: bFicha.id,
      clientId: world.tenantB.clientIds[0],
      serviceId: world.tenantB.catalog.serviceIds[0],
      unitPrice: 40_000,
      tipsAmount: B_TIP,
    });

    const aBalBefore = await tipBalance(request, tokenA, aProfId);
    const bBalBefore = await tipBalance(request, tokenB, bProfId);
    expect(aBalBefore).toBeGreaterThanOrEqual(A_TIP);
    expect(bBalBefore).toBeGreaterThanOrEqual(B_TIP);

    const [resA, resB] = await raceAcrossTenants(
      () =>
        apiPostJson<CreateTipWithdrawalResponse>(request, tokenA, "/api/propinas/withdrawals", {
          professionalId: aProfId,
          amount: A_TIP,
        }),
      () =>
        apiPostJson<CreateTipWithdrawalResponse>(request, tokenB, "/api/propinas/withdrawals", {
          professionalId: bProfId,
          amount: B_TIP,
        }),
    );

    expect(resA.status, JSON.stringify(resA)).toBe("fulfilled");
    expect(resB.status, JSON.stringify(resB)).toBe("fulfilled");

    // Each tenant's post-race balance dropped by exactly its OWN withdrawal — never the other's,
    // and never both.
    const aBalAfter = await tipBalance(request, tokenA, aProfId);
    const bBalAfter = await tipBalance(request, tokenB, bProfId);
    expect(
      aBalAfter,
      `A's tip balance moved by ≠ its own withdrawal across the race (${aBalBefore} -> ${aBalAfter})`,
    ).toBe(aBalBefore - A_TIP);
    expect(
      bBalAfter,
      `B's tip balance moved by ≠ its own withdrawal across the race (${bBalBefore} -> ${bBalAfter})`,
    ).toBe(bBalBefore - B_TIP);
  });
});
