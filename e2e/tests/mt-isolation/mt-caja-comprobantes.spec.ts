import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  API_BASE,
  apiPostJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
} from "../../fixtures/api";
import { raceAcrossTenants } from "../../fixtures/mt/concurrent";
import {
  expectCrossTenantForbidden,
  expectScopedList,
  expectUnchanged,
  snapshotTenant,
} from "../../fixtures/mt/probe";
import { getMtWorld, mtLoginToken } from "../../fixtures/mt/world";

/**
 * Task 6 — mt-caja-comprobantes: cash session & receipt (comprobante) isolation.
 *
 * Six scenarios proving that money movement in one tenant never bleeds into another:
 *  1. Cash sessions open/close independently per tenant.
 *  2. (anchor) Invoice numbering is a per-tenant sequence — A's emissions never advance B's number.
 *  3. The comprobante history endpoint is tenant-scoped, and a single foreign invoice is not even
 *     individually addressable across the boundary.
 *  4. Voiding ("anular") an invoice in A leaves a before/after fingerprint of B byte-identical.
 *  5. Closing A's caja reports A's own sales only — never A+B — and B's session stays open.
 *  6. Simultaneous emission in A and B: both succeed, each sequence advances by exactly one, no
 *     collision / lost update.
 *
 * All raw HTTP goes to `API_BASE` (= the :8081 mt backend — the mt config points
 * `PLAYWRIGHT_API_BASE_URL` there). Every assertion is "contains / excludes THIS id / number",
 * never an absolute count of a tenant's total invoices. A failing isolation assertion here is a
 * suspected PRODUCT BUG — reported, not weakened.
 *
 * T-A specifics (its tier enables SIFEN e-invoicing):
 *  - `world.ts` provisioning uploads a valid SIFEN certificate for T-A (without one,
 *    `InvoiceController.issue` throws `SIFEN_NO_VALID_CERTIFICATE` and creates nothing).
 *  - T-A invoice bodies use an UNIDENTIFIED receiver (`clientId: null`, a unique display name, no
 *    RUC) so SIFEN's `SIFEN_RECIPIENT_EMAIL_REQUIRED` guard never trips. Numbering / caja behaviour
 *    is identical to an identified receiver.
 *  - `beforeAll` re-asserts T-A's active fiscal stamp has headroom.
 *
 * Re-run note: the mt backend is reused across local runs (`reuseExistingServer`) and invoices
 * cannot be deleted, so every invoice created here is anchored to a per-run-unique display name /
 * amount. Scenarios are self-contained: each ensures its own open cash session rather than leaning
 * on a previous scenario's side effects.
 */

const world = getMtWorld();

/** Numeric tail of a formatted invoice number (`"001-001-0000123"` → `123`). */
function parseInvoiceNumber(formatted: string): number {
  return Number(formatted.split("-").at(-1));
}

/** Per-run seed so re-runs against a reused mt backend never collide on display names. */
const RUN_SEED = Date.now();
let emissionCounter = 0;

type EmittedInvoice = {
  id: number;
  invoiceNumber: number;
  invoiceNumberFormatted: string;
  total: string;
};

/**
 * Invoice create body (verified against `InvoiceCreateRequest` / hu-14). One CASH-paid line whose
 * amount equals `unitPrice`. `clientId: null` + a unique `clientDisplayName` + no RUC ⇒ an
 * unidentified receiver, which is what keeps T-A (SIFEN on) from demanding a recipient email.
 */
function invoiceBody(label: string, unitPrice: number): Record<string, unknown> {
  const displayName = `MT ${label} ${RUN_SEED}-${++emissionCounter}`;
  return {
    clientId: null,
    clientDisplayName: displayName,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [{ serviceId: null, description: `${displayName} svc`, quantity: 1, unitPrice }],
    payments: [{ method: "CASH", amount: unitPrice }],
  };
}

async function emitInvoice(
  request: APIRequestContext,
  token: string,
  label: string,
  unitPrice: number,
): Promise<EmittedInvoice> {
  return apiPostJson<EmittedInvoice>(request, token, "/api/invoices", invoiceBody(label, unitPrice));
}

type CashCurrent = { status: number; body: Record<string, unknown> | null };

/** `GET /api/cash-sessions/current` — 200 with the session body when open, non-200 (204) otherwise. */
async function cashCurrent(request: APIRequestContext, token: string): Promise<CashCurrent> {
  const res = await request.get(`${API_BASE}/api/cash-sessions/current`, {
    headers: authHeaders(token),
  });
  const status = res.status();
  let body: Record<string, unknown> | null = null;
  if (status === 200) {
    body = (await res.json()) as Record<string, unknown>;
  }
  return { status, body };
}

async function openCashSession(
  request: APIRequestContext,
  token: string,
  openingCashAmount: number,
): Promise<Record<string, unknown>> {
  const res = await request.post(`${API_BASE}/api/cash-sessions/open`, {
    headers: authHeaders(token),
    data: { openingCashAmount },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as Record<string, unknown>;
}

type CashCloseResponse = {
  totalInvoiced: string;
  invoiceCount: number;
  paymentSummary: Array<{ method: string; total: string }>;
};

async function closeCashSession(
  request: APIRequestContext,
  token: string,
  countedCashAmount: number,
): Promise<CashCloseResponse> {
  const res = await request.post(`${API_BASE}/api/cash-sessions/close`, {
    headers: authHeaders(token),
    data: { countedCashAmount },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as CashCloseResponse;
}

/** Closes `token`'s cash session if one is open — so a scenario can start from a fresh session. */
async function closeCashSessionIfOpen(request: APIRequestContext, token: string): Promise<void> {
  const current = await cashCurrent(request, token);
  if (current.status === 200) {
    const opening = Number(current.body?.openingCashAmount ?? 0);
    await closeCashSession(request, token, opening);
  }
}

test.describe("mt-caja-comprobantes · cash session & receipt isolation", () => {
  test.beforeAll(async ({ request }) => {
    // T-A emits SIFEN invoices — make sure its active stamp still has range headroom (the mt
    // backend is shared across this whole suite).
    const tokenA = await mtLoginToken(request, world.tenantA);
    await ensureActiveFiscalStampForInvoices(request, tokenA);
  });

  // Scenario 1 ----------------------------------------------------------------------------------
  test("cash sessions open and close independently per tenant", async ({ request }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);

    // Start from a clean slate in BOTH tenants.
    await closeCashSessionIfOpen(request, tokenA);
    await closeCashSessionIfOpen(request, tokenB);
    expect((await cashCurrent(request, tokenA)).status).not.toBe(200);
    expect((await cashCurrent(request, tokenB)).status).not.toBe(200);

    // Open A only — B must still report "no open session".
    const openingA = 100_000;
    await openCashSession(request, tokenA, openingA);
    expect((await cashCurrent(request, tokenA)).status).toBe(200);
    expect(
      (await cashCurrent(request, tokenB)).status,
      "B's cash session opened as a side effect of opening A's",
    ).not.toBe(200);

    // Open B with a DIFFERENT opening amount.
    const openingB = 250_000;
    await openCashSession(request, tokenB, openingB);

    const afterA = await cashCurrent(request, tokenA);
    const afterB = await cashCurrent(request, tokenB);
    expect(afterA.status).toBe(200);
    expect(afterB.status).toBe(200);

    // Each session carries its own opening float — A's did not get overwritten by B's open.
    expect(Number(afterA.body?.openingCashAmount)).toBe(openingA);
    expect(Number(afterB.body?.openingCashAmount)).toBe(openingB);
    expect(Number(afterA.body?.openingCashAmount)).not.toBe(
      Number(afterB.body?.openingCashAmount),
    );
    // Distinct session identities.
    expect(afterA.body?.id).not.toBe(afterB.body?.id);

    // Close A — B's session is untouched and still open.
    await closeCashSession(request, tokenA, openingA);
    expect((await cashCurrent(request, tokenA)).status).not.toBe(200);
    expect(
      (await cashCurrent(request, tokenB)).status,
      "closing A's cash session also closed B's",
    ).toBe(200);

    // Leave both tenants with an open session for the scenarios that follow / sibling specs.
    await ensureCashSessionOpenApi(request, tokenA);
  });

  // Scenario 2 (anchor) -----------------------------------------------------------------------
  test("invoice numbering is a per-tenant sequence — A's emissions never advance B's", async ({
    request,
  }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    await ensureCashSessionOpenApi(request, tokenA);
    await ensureCashSessionOpenApi(request, tokenB);

    // Interleave: A, B, A, B. Each tenant's own sequence must stay contiguous despite the other
    // tenant emitting in between — that is the isolation proof. (No cross-tenant *value* comparison:
    // both timbrados legitimately start at the same initial emission number, so A's and B's numbers
    // may well coincide; independence is about the deltas, not the values.)
    const a1 = await emitInvoice(request, tokenA, "A-seq", 50_000);
    const b1 = await emitInvoice(request, tokenB, "B-seq", 40_000);
    const a2 = await emitInvoice(request, tokenA, "A-seq", 50_000);
    const b2 = await emitInvoice(request, tokenB, "B-seq", 40_000);

    const a1n = parseInvoiceNumber(a1.invoiceNumberFormatted);
    const a2n = parseInvoiceNumber(a2.invoiceNumberFormatted);
    const b1n = parseInvoiceNumber(b1.invoiceNumberFormatted);
    const b2n = parseInvoiceNumber(b2.invoiceNumberFormatted);

    // A's two invoices are consecutive — B's emission wedged between them did not advance A's number.
    expect(
      a2n,
      `A's numbering skipped across B's emission: ${a1.invoiceNumberFormatted} -> ${a2.invoiceNumberFormatted}`,
    ).toBe(a1n + 1);

    // B's two invoices are consecutive — A's two emissions around them did not advance B's number.
    expect(
      b2n,
      `B's numbering was bumped by A's emissions: ${b1.invoiceNumberFormatted} -> ${b2.invoiceNumberFormatted}`,
    ).toBe(b1n + 1);

    // A pure server-side re-read agrees with the response bodies (no client-side bookkeeping).
    expect(a1.invoiceNumber).toBe(a1n);
    expect(b1.invoiceNumber).toBe(b1n);
  });

  // Scenario 3 --------------------------------------------------------------------------------
  test("comprobante history is tenant-scoped, and a foreign invoice is not addressable", async ({
    request,
  }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    await ensureCashSessionOpenApi(request, tokenA);
    await ensureCashSessionOpenApi(request, tokenB);

    const aInv = await emitInvoice(request, tokenA, "A-hist", 51_000);
    const bInv = await emitInvoice(request, tokenB, "B-hist", 31_000);
    expect(aInv.id).not.toBe(bInv.id);

    // A's history contains A's new comprobante and never B's; B's history is the mirror image.
    await expectScopedList(request, tokenA, "/api/invoices?page=0&size=100", {
      includesIds: [aInv.id],
      excludesIds: [bInv.id],
    });
    await expectScopedList(request, tokenB, "/api/invoices?page=0&size=100", {
      includesIds: [bInv.id],
      excludesIds: [aInv.id],
    });

    // A single foreign comprobante is not individually addressable across the tenant boundary.
    await expectCrossTenantForbidden(request, tokenB, `/api/invoices/${aInv.id}`);
    await expectCrossTenantForbidden(request, tokenA, `/api/invoices/${bInv.id}`);
  });

  // Scenario 4 --------------------------------------------------------------------------------
  test("voiding an invoice in A leaves a before/after snapshot of B byte-identical", async ({
    request,
  }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    await ensureCashSessionOpenApi(request, tokenA);

    const before = await snapshotTenant(request, tokenB);

    const aInv = await emitInvoice(request, tokenA, "A-void", 62_000);
    const voidRes = await request.post(`${API_BASE}/api/invoices/${aInv.id}/void`, {
      headers: authHeaders(tokenA),
      data: { voidReason: `MT isolation void ${RUN_SEED}` },
    });
    expect(voidRes.ok(), await voidRes.text()).toBeTruthy();

    const after = await snapshotTenant(request, tokenB);
    expectUnchanged(before, after);
  });

  // Scenario 5 --------------------------------------------------------------------------------
  test("closing A's caja reports A's sales only, and B's session stays open", async ({
    request,
  }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);

    // Fresh A session so its close-of-day total is exactly the one invoice emitted below.
    await closeCashSessionIfOpen(request, tokenA);
    const openingA = 90_000;
    await openCashSession(request, tokenA, openingA);
    await ensureCashSessionOpenApi(request, tokenB);

    const aAmount = 123_000;
    const bAmount = 456_000; // deliberately different so A+B ≠ A
    const aInv = await emitInvoice(request, tokenA, "A-close", aAmount);
    await emitInvoice(request, tokenB, "B-close", bAmount);

    const close = await closeCashSession(request, tokenA, openingA + aAmount);

    // A's close-of-day sees A's single invoice and nothing of B's.
    expect(Number(close.totalInvoiced)).toBe(aAmount);
    expect(
      Number(close.totalInvoiced),
      "A's close-of-day total included B's concurrent sale",
    ).not.toBe(aAmount + bAmount);
    expect(Number(close.totalInvoiced)).not.toBe(bAmount);
    expect(close.invoiceCount).toBe(1);
    const cashLine = close.paymentSummary.find((p) => p.method === "CASH");
    expect(Number(cashLine?.total)).toBe(aAmount);

    // Verify against the invoice we actually created.
    expect(Number(aInv.total)).toBe(aAmount);

    // B's session was never touched by A closing its own.
    expect(
      (await cashCurrent(request, tokenB)).status,
      "closing A's caja also closed B's session",
    ).toBe(200);

    // Re-open A's session — mt-ficha-propinas (invoice-from-ficha) needs it open.
    await ensureCashSessionOpenApi(request, tokenA);
  });

  // Scenario 6 (concurrency) ----------------------------------------------------------------
  test("simultaneous emission in A and B: both succeed, each sequence advances by one", async ({
    request,
  }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    await ensureCashSessionOpenApi(request, tokenA);
    await ensureCashSessionOpenApi(request, tokenB);

    // Warm-up emission per tenant guarantees a non-null "last number" to diff against, and keeps
    // this scenario independent of the ones above.
    await emitInvoice(request, tokenA, "A-warm", 50_000);
    await emitInvoice(request, tokenB, "B-warm", 40_000);

    const beforeA = await snapshotTenant(request, tokenA);
    const beforeB = await snapshotTenant(request, tokenB);
    expect(beforeA.lastInvoiceNumber).not.toBeNull();
    expect(beforeB.lastInvoiceNumber).not.toBeNull();
    const beforeAn = parseInvoiceNumber(beforeA.lastInvoiceNumber as string);
    const beforeBn = parseInvoiceNumber(beforeB.lastInvoiceNumber as string);

    const [resA, resB] = await raceAcrossTenants(
      () => apiPostJson<EmittedInvoice>(request, tokenA, "/api/invoices", invoiceBody("A-race", 55_000)),
      () => apiPostJson<EmittedInvoice>(request, tokenB, "/api/invoices", invoiceBody("B-race", 45_000)),
    );

    expect(resA.status, JSON.stringify(resA)).toBe("fulfilled");
    expect(resB.status, JSON.stringify(resB)).toBe("fulfilled");
    if (resA.status !== "fulfilled" || resB.status !== "fulfilled") {
      return;
    }
    expect(resA.value.id).not.toBe(resB.value.id);

    // Each tenant's sequence advanced by exactly one — no cross-tenant collision, no lost update.
    const afterA = await snapshotTenant(request, tokenA);
    const afterB = await snapshotTenant(request, tokenB);
    expect(
      parseInvoiceNumber(afterA.lastInvoiceNumber as string),
      `A's sequence moved by ≠1 across the race (${beforeAn} -> ${afterA.lastInvoiceNumber})`,
    ).toBe(beforeAn + 1);
    expect(
      parseInvoiceNumber(afterB.lastInvoiceNumber as string),
      `B's sequence moved by ≠1 across the race (${beforeBn} -> ${afterB.lastInvoiceNumber})`,
    ).toBe(beforeBn + 1);

    // The raced invoice numbers match each tenant's own advance.
    expect(parseInvoiceNumber(resA.value.invoiceNumberFormatted)).toBe(beforeAn + 1);
    expect(parseInvoiceNumber(resB.value.invoiceNumberFormatted)).toBe(beforeBn + 1);
  });
});
