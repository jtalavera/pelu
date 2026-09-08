import { expect, type APIRequestContext } from "@playwright/test";

import { API_BASE, authHeaders } from "../api";

/**
 * Reusable cross-tenant assertion helpers for the multi-tenant-isolation suite (Tasks 4-9 consume
 * every export by name). All network calls go to `API_BASE` from `e2e/fixtures/api.ts` — the mt
 * config points `PLAYWRIGHT_API_BASE_URL` at the :8081 mt backend, so these hit the mt world.
 */

// --------------------------------------------------------------------------------------------------
// Low-level GET that never throws on non-2xx — the isolation helpers assert on the status themselves.
// --------------------------------------------------------------------------------------------------

type RawGet = { status: number; text: string; json: unknown };

async function rawGet(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<RawGet> {
  const res = await request.get(`${API_BASE}${path}`, { headers: authHeaders(token) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status(), text, json };
}

/** Unwraps `{ content: [...] }` paged bodies; passes bare arrays through unchanged. */
function asList(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (body && typeof body === "object" && Array.isArray((body as { content?: unknown }).content)) {
    return (body as { content: unknown[] }).content;
  }
  throw new Error(
    `expected a bare array or a { content: [...] } page, got: ${JSON.stringify(body)?.slice(0, 400)}`,
  );
}

function idsOf(rows: unknown[], idField: string): number[] {
  return rows.map((r) => Number((r as Record<string, unknown>)[idField]));
}

// --------------------------------------------------------------------------------------------------
// Scoped-list / cross-tenant assertions.
// --------------------------------------------------------------------------------------------------

/**
 * GETs `path` with `token`, asserts the returned collection contains every id in `includesIds` and
 * none in `excludesIds` (matched on `item[idField ?? "id"]`), and returns the parsed rows.
 * Handles both bare-array and `{ content: [...] }` paged bodies.
 */
export async function expectScopedList(
  request: APIRequestContext,
  token: string,
  path: string,
  opts: { includesIds: number[]; excludesIds: number[]; idField?: string },
): Promise<unknown[]> {
  const idField = opts.idField ?? "id";
  const res = await rawGet(request, token, path);
  expect(
    res.status,
    `expectScopedList: GET ${path} -> ${res.status}: ${res.text.slice(0, 400)}`,
  ).toBe(200);

  const rows = asList(res.json);
  const seen = new Set(idsOf(rows, idField));

  const missing = opts.includesIds.filter((id) => !seen.has(id));
  expect(
    missing,
    `expectScopedList: GET ${path} did not return own ids ${JSON.stringify(missing)} (saw ${JSON.stringify([...seen])})`,
  ).toEqual([]);

  const leaked = opts.excludesIds.filter((id) => seen.has(id));
  expect(
    leaked,
    `expectScopedList: GET ${path} LEAKED other-tenant ids ${JSON.stringify(leaked)} (saw ${JSON.stringify([...seen])})`,
  ).toEqual([]);

  return rows;
}

/**
 * GET `path` with `token` (a token for a tenant that must NOT be able to see the resource).
 * Passes only on 403 or 404. Fails loudly — with the response body — on 200 (leak) or any 5xx.
 */
export async function expectCrossTenantForbidden(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<void> {
  const res = await rawGet(request, token, path);
  if (res.status === 403 || res.status === 404) {
    return;
  }
  if (res.status === 200) {
    throw new Error(
      `expectCrossTenantForbidden: GET ${path} LEAKED cross-tenant data (200): ${res.text.slice(0, 600)}`,
    );
  }
  if (res.status >= 500) {
    throw new Error(
      `expectCrossTenantForbidden: GET ${path} returned server error ${res.status}: ${res.text.slice(0, 600)}`,
    );
  }
  throw new Error(
    `expectCrossTenantForbidden: GET ${path} expected 403/404, got ${res.status}: ${res.text.slice(0, 600)}`,
  );
}

// --------------------------------------------------------------------------------------------------
// Tenant snapshot — a coarse fingerprint of a tenant's mutable state, used to assert that an action
// in tenant X left tenant Y completely untouched.
// --------------------------------------------------------------------------------------------------

export type TenantSnapshot = {
  invoiceIds: number[];
  lastInvoiceNumber: string | null;
  appointmentIds: number[];
  tipReportTotalMinor: number;
  serviceRecordIds: number[];
  cashSessionOpen: boolean;
};

/** `Instant.parse`-compatible bounds wide enough to capture every row regardless of clock. */
const WIDE_FROM = "2000-01-01T00:00:00Z";
const WIDE_TO = "2100-01-01T00:00:00Z";

const numAsc = (a: number, b: number) => a - b;

export async function snapshotTenant(
  request: APIRequestContext,
  token: string,
): Promise<TenantSnapshot> {
  // Invoices — paged { content: [...] } of InvoiceListItemResponse { id, invoiceNumber, invoiceNumberFormatted }.
  const invoicesRes = await rawGet(request, token, "/api/invoices?page=0&size=200");
  expect(
    invoicesRes.status,
    `snapshotTenant: GET /api/invoices -> ${invoicesRes.status}: ${invoicesRes.text.slice(0, 300)}`,
  ).toBe(200);
  const invoiceRows = asList(invoicesRes.json) as Array<{
    id: number;
    invoiceNumber?: number;
    invoiceNumberFormatted?: string | null;
  }>;
  const invoiceIds = invoiceRows.map((r) => Number(r.id)).sort(numAsc);
  const lastInvoiceNumber =
    invoiceRows.length === 0
      ? null
      : ([...invoiceRows].sort((a, b) => (a.invoiceNumber ?? 0) - (b.invoiceNumber ?? 0)).at(-1)
          ?.invoiceNumberFormatted ?? null);

  // Appointments — DEVIATION from the brief's `/api/appointments/history`, which requires a
  // `clientId` and only returns one client's past (≤6 months) rows. `GET /api/appointments`
  // with a wide from/to window returns the whole tenant's appointments as a bare array, which is
  // what an isolation snapshot needs (detect any appointment appearing/changing across tenants).
  const apptRes = await rawGet(
    request,
    token,
    `/api/appointments?from=${WIDE_FROM}&to=${WIDE_TO}`,
  );
  expect(
    apptRes.status,
    `snapshotTenant: GET /api/appointments -> ${apptRes.status}: ${apptRes.text.slice(0, 300)}`,
  ).toBe(200);
  const appointmentIds = (asList(apptRes.json) as Array<{ id: number }>)
    .map((r) => Number(r.id))
    .sort(numAsc);

  // Tips report — TipReportResponse.grandTotal (whole guaraníes; the "Minor" in the field name is
  // the fixed contract name, not a claim about the unit).
  const tipsRes = await rawGet(
    request,
    token,
    `/api/propinas/report?from=${WIDE_FROM}&to=${WIDE_TO}`,
  );
  expect(
    tipsRes.status,
    `snapshotTenant: GET /api/propinas/report -> ${tipsRes.status}: ${tipsRes.text.slice(0, 300)}`,
  ).toBe(200);
  const tipReportTotalMinor = Number((tipsRes.json as { grandTotal?: unknown })?.grandTotal ?? 0);

  // Service records — paged { content: [...] } of ServiceRecordListItemResponse { id }.
  const srRes = await rawGet(request, token, "/api/service-records?page=0&size=200");
  expect(
    srRes.status,
    `snapshotTenant: GET /api/service-records -> ${srRes.status}: ${srRes.text.slice(0, 300)}`,
  ).toBe(200);
  const serviceRecordIds = (asList(srRes.json) as Array<{ id: number }>)
    .map((r) => Number(r.id))
    .sort(numAsc);

  // Cash session — 200 when one is open, 204 otherwise.
  const cashRes = await rawGet(request, token, "/api/cash-sessions/current");
  const cashSessionOpen = cashRes.status === 200;

  return {
    invoiceIds,
    lastInvoiceNumber,
    appointmentIds,
    tipReportTotalMinor,
    serviceRecordIds,
    cashSessionOpen,
  };
}

/** Deep-equal assertion with a readable diff message — fails if any tenant state moved. */
export function expectUnchanged(before: TenantSnapshot, after: TenantSnapshot): void {
  expect(
    after,
    `expectUnchanged: tenant state changed\n  before: ${JSON.stringify(before)}\n  after:  ${JSON.stringify(after)}`,
  ).toEqual(before);
}

// --------------------------------------------------------------------------------------------------
// Money formatting guard (project rule: dot-thousands separator, no decimals — "Gs. 150.000").
// --------------------------------------------------------------------------------------------------

/**
 * Asserts `text` renders a guaraní amount in the house format: dot as the thousands separator and
 * NO decimal fraction. Rejects a `,` decimal separator ("150,00"), a trailing `,dd`, and a dot
 * decimal fraction ("150000.00" / "150.00").
 */
export function expectMoneyFormat(text: string): void {
  const value = String(text);

  if (/,\d/.test(value)) {
    throw new Error(
      `expectMoneyFormat: "${value}" uses a comma separator; expected dot-thousands, no decimals (e.g. "150.000")`,
    );
  }
  // A dot/comma followed by exactly 1-2 digits (not a 3-digit thousands group) is a decimal fraction.
  if (/[.,]\d{1,2}(?!\d)/.test(value)) {
    throw new Error(
      `expectMoneyFormat: "${value}" contains a decimal fraction; guaraní amounts are whole numbers (e.g. "150.000")`,
    );
  }
  // The numeric portion must be 1-3 digits followed by any number of ".###" groups.
  const tokens = value.match(/\d[\d.]*\d|\d/g) ?? [];
  const wellFormed = /^\d{1,3}(\.\d{3})*$/;
  if (!tokens.some((t) => wellFormed.test(t))) {
    throw new Error(
      `expectMoneyFormat: "${value}" has no dot-grouped integer (e.g. "150.000"); numeric tokens: ${JSON.stringify(tokens)}`,
    );
  }
  // Brief's literal shape check, kept as a redundant guard.
  if (!/\d{1,3}(\.\d{3})*(?!\d)/.test(value)) {
    throw new Error(
      `expectMoneyFormat: "${value}" does not match the money shape /\\d{1,3}(\\.\\d{3})*/`,
    );
  }
}
