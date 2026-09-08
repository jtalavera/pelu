import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  API_BASE,
  apiGetJson,
  apiPostJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  listFiscalStamps,
  type FiscalStampDto,
} from "../../fixtures/api";
import { raceAcrossTenants } from "../../fixtures/mt/concurrent";
import { expectCrossTenantForbidden } from "../../fixtures/mt/probe";
import { getMtWorld, mtLoginToken } from "../../fixtures/mt/world";

/**
 * Task 8 — mt-sifen: electronic-invoicing configuration divergence & isolation.
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * DISCOVERY (done before writing a single assertion — recorded here so nobody re-derives it):
 *
 * 1. **What SIFEN capability T-A actually has in this suite: a REAL one, up to the CDC.**
 *    `e2e/global-setup.mt.ts` → `world.ts#ensureSifenCertificate` uploads the real test .p12
 *    (`e2e/fixtures/sifen/test-cert.p12`) through `POST /api/sifen/certificates` for T-A, and gives
 *    it the full SIFEN issuer profile. So `POST /api/invoices` as T-A takes the SIFEN branch of
 *    `InvoiceController.issue` for real: `SifenInvoiceSubmissionService.prepareAndSign` runs
 *    synchronously and MINTS THE CDC (`sifenControlNumber`) before the 201 is written — with zero
 *    network calls to SIFEN (RT-20). That is the observable this file asserts on.
 *    What T-A canNOT reach here is any SIFEN-*answered* state (APPROVED / REJECTED / a resolved
 *    status query): `application-e2e.properties` points SIFEN at the unreachable
 *    `https://127.0.0.1:9`, so the async transmit always lands in `PENDING_VERIFICATION`
 *    ("transmitted, no answer" — HU-06 AC-05), and
 *    `SifenInvoiceTestSupportController` (`/api/admin/sifen-test-support/*`), the only thing that
 *    can fabricate APPROVED/REJECTED, is **hardcoded to `DEMO_TENANT_ID = 1L`** and therefore
 *    useless for a tenant this suite provisions. No scenario below depends on such a state, so
 *    NOTHING in this file is skipped.
 *
 * 2. **`GET /api/feature-flags` shape** (`FeatureFlagController#getResolvedForCurrentTenant` →
 *    `FeatureFlagsResolvedResponse`): `{ "flags": { "<FLAG_KEY>": boolean, ... } }` — a single
 *    `flags` map, resolved for the *caller's own* tenant (`principal.getTenantId()`); there is no
 *    tenantId parameter to tamper with.
 *
 * 3. **There is NO "feature-disabled" error code on the SIFEN endpoints.** Grepping
 *    `SIFEN_ELECTRONIC_INVOICING` across the backend shows the flag is read in exactly two places:
 *    `InvoiceController.issue` (which branch to take) and `InvoicePdfService` (which PDF to build).
 *    `/api/sifen/certificates`, `/api/sifen/number-voiding` and
 *    `/api/invoices/{id}/sifen/check-status` are gated on authentication/role only. So T-B is not
 *    refused with a flag error — it gets the ordinary domain answer for a tenant that has no SIFEN
 *    data:
 *      · `GET /api/sifen/certificates` → `200 []` (it simply owns no certificate);
 *      · `POST /api/sifen/number-voiding` → `200` (it owns an active fiscal stamp, which is all
 *        `SifenNumberVoidingService.createManual` requires);
 *      · `POST /api/invoices/{ownId}/sifen/check-status` → **409 `SIFEN_INVOICE_NOT_PENDING_VERIFICATION`**
 *        (`SifenInvoiceSubmissionPersistenceService#requirePendingInvoiceControlNumber`), because a
 *        non-SIFEN invoice never gets a `sifenSubmissionStatus` at all.
 *    That is what scenarios 1 and 6 assert for B. This is a **note, not a leak** — B never sees a
 *    byte of A's data — but it is reported, because "SIFEN endpoints are open to tenants whose tier
 *    excludes the SIFEN flag" is a deliberate-or-not product decision worth a second look.
 *
 * 4. `InvoiceController#receiverWillBeIdentified` = "`clientRucOverride` or
 *    `clientIdentityDocumentOverride` is non-blank". The `SIFEN_RECIPIENT_EMAIL_REQUIRED` guard
 *    therefore trips only for an *identified* receiver with a blank `email` — which is exactly the
 *    A/B divergence probe scenario 1 uses (byte-identical request body, two outcomes).
 *
 * 5. The CDC lives in `InvoiceResponse.sifenControlNumber` (there is no field literally named
 *    `cdc`); `/api/sifen/number-voiding` GET is paged
 *    (`PagedSifenNumberVoidingResponse { content, page, size, totalElements, totalPages,
 *    pendingCount, soonestPendingDeadline }`).
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Six scenarios:
 *  1. (anchor) A resolves the SIFEN flag enabled and takes the SIFEN branch (CDC minted; blank
 *     recipient email refused); B resolves it disabled and takes the traditional branch for the
 *     identical body (201, no CDC).
 *  2. Certificates and timbrados never cross the tenant boundary.
 *  3. "Numeración inutilizada" records are per-tenant in both directions.
 *  4. A's SIFEN sub-resources (KuDE, status check) are not addressable with B's token.
 *  5. A's active stamp advances by exactly A's own emission count, with B emissions interleaved.
 *  6. Simultaneous status polls in both tenants return each tenant's own answer, never swapped.
 *
 * All raw HTTP goes to `API_BASE` (the :8081 mt backend — the mt config points
 * `PLAYWRIGHT_API_BASE_URL` there). Every assertion is "contains / excludes THIS id / number",
 * never an absolute count. A failing isolation assertion here is a suspected PRODUCT BUG — it gets
 * reported, never weakened away.
 *
 * Re-run note: the mt backend is reused across local runs (`reuseExistingServer`) and neither
 * invoices nor voiding events can be deleted, so everything created here is anchored to a per-run
 * unique display name / number range and located by its own id.
 */

const world = getMtWorld();

const SIFEN_FLAG = "SIFEN_ELECTRONIC_INVOICING";
/** The project's canonical valid RUC (`paraguayRuc` checksum-clean) — makes a receiver "identified". */
const IDENTIFIED_RUC = "80000005-6";

/** Per-run seed so re-runs against a reused mt backend never collide. */
const RUN_SEED = Date.now();
let emissionCounter = 0;

type EmittedInvoice = {
  id: number;
  invoiceNumber: number;
  invoiceNumberFormatted: string;
  sifenControlNumber: string | null;
  sifenSubmissionStatus: string | null;
};

type RawResponse = { status: number; text: string; json: unknown };

async function raw(
  request: APIRequestContext,
  method: "get" | "post",
  token: string,
  path: string,
  data?: unknown,
): Promise<RawResponse> {
  const res =
    method === "get"
      ? await request.get(`${API_BASE}${path}`, { headers: authHeaders(token) })
      : await request.post(`${API_BASE}${path}`, { headers: authHeaders(token), data: data ?? {} });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status(), text, json };
}

/**
 * Invoice create body. `identified: false` (the default) = `clientId: null` + a unique
 * `clientDisplayName` + no RUC ⇒ an UNIDENTIFIED receiver, which is what lets a SIFEN tenant emit
 * without a recipient email (`InvoiceController#receiverWillBeIdentified`). `identified: true`
 * attaches `IDENTIFIED_RUC`, which arms the `SIFEN_RECIPIENT_EMAIL_REQUIRED` guard whenever `email`
 * is left blank.
 */
function invoiceBody(
  label: string,
  unitPrice: number,
  opts: { identified?: boolean; email?: string | null } = {},
): Record<string, unknown> {
  const displayName = `MT SIFEN ${label} ${RUN_SEED}-${++emissionCounter}`;
  return {
    clientId: null,
    clientDisplayName: displayName,
    clientRucOverride: opts.identified ? IDENTIFIED_RUC : null,
    discountType: null,
    discountValue: null,
    lines: [{ serviceId: null, description: `${displayName} svc`, quantity: 1, unitPrice }],
    payments: [{ method: "CASH", amount: unitPrice }],
    email: opts.email ?? null,
  };
}

async function emitInvoice(
  request: APIRequestContext,
  token: string,
  label: string,
  unitPrice = 50_000,
): Promise<EmittedInvoice> {
  return apiPostJson<EmittedInvoice>(request, token, "/api/invoices", invoiceBody(label, unitPrice));
}

/** The tenant's single active fiscal stamp — every emission and every voiding hangs off this one. */
async function activeStamp(
  request: APIRequestContext,
  token: string,
): Promise<FiscalStampDto> {
  const stamps = await listFiscalStamps(request, token);
  const active = stamps.filter((s) => s.active);
  expect(
    active.length,
    `expected exactly one active fiscal stamp, got ${JSON.stringify(stamps.map((s) => ({ id: s.id, active: s.active })))}`,
  ).toBe(1);
  return active[0];
}

type VoidingEvent = { id: number; rangeFrom: number; rangeTo: number; status: string };

/**
 * Registers a manual "numeración inutilizada" over a run-unique range far above any number this
 * suite could ever emit (the stamps run 1–9,999,999 and start emitting at ~100), retrying on the
 * only two collisions a reused backend can produce.
 */
async function registerNumberVoiding(
  request: APIRequestContext,
  token: string,
  reason: string,
): Promise<VoidingEvent> {
  let last: RawResponse | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const from = 9_100_000 + Math.floor(Math.random() * 800_000);
    const res = await raw(request, "post", token, "/api/sifen/number-voiding", {
      rangeFrom: from,
      rangeTo: from + 2,
      reason,
    });
    if (res.status === 200) {
      return res.json as VoidingEvent;
    }
    last = res;
    if (!res.text.includes("SIFEN_VOIDING_RANGE_OVERLAPS")) {
      break;
    }
  }
  throw new Error(
    `registerNumberVoiding failed: ${last?.status} ${last?.text.slice(0, 400)}`,
  );
}

/** All voiding-event ids visible to `token`, across pages. */
async function listVoidingIds(request: APIRequestContext, token: string): Promise<number[]> {
  const ids: number[] = [];
  for (let page = 0; page < 20; page++) {
    const body = await apiGetJson<{ content: VoidingEvent[]; totalPages: number }>(
      request,
      token,
      `/api/sifen/number-voiding?page=${page}&size=100`,
    );
    ids.push(...body.content.map((e) => Number(e.id)));
    if (page + 1 >= body.totalPages) {
      break;
    }
  }
  return ids;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the async SIFEN transmit (`LocalAsyncSifenSubmissionQueue`, zero delay, one background
 * thread) to move a freshly issued A invoice off `QUEUED`. Against the unreachable
 * `https://127.0.0.1:9` this always settles on `PENDING_VERIFICATION` — the state
 * `POST .../sifen/check-status` needs to be callable at all. Returns whatever status it saw last,
 * so the caller can adapt rather than flake if the queue is slow.
 */
async function waitForSifenStatus(
  request: APIRequestContext,
  token: string,
  invoiceId: number,
  target: string,
  timeoutMs = 30_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let seen: string | null = null;
  for (;;) {
    const inv = await apiGetJson<EmittedInvoice>(request, token, `/api/invoices/${invoiceId}`);
    seen = inv.sifenSubmissionStatus ?? null;
    if (seen === target || Date.now() > deadline) {
      return seen;
    }
    await sleep(500);
  }
}

let tokenA = "";
let tokenB = "";

test.beforeAll(async ({ request }) => {
  tokenA = await mtLoginToken(request, world.tenantA);
  tokenB = await mtLoginToken(request, world.tenantB);
  // Both tenants must be able to emit for the whole file: an in-date active stamp with range
  // headroom, and an open cash session (`InvoiceService.issueInvoice` requires both).
  await ensureActiveFiscalStampForInvoices(request, tokenA);
  await ensureActiveFiscalStampForInvoices(request, tokenB);
  await ensureCashSessionOpenApi(request, tokenA);
  await ensureCashSessionOpenApi(request, tokenB);
});

test.describe("mt-isolation · SIFEN / electronic invoicing", () => {
  test("1 · A resolves the SIFEN flag enabled and takes the SIFEN branch; B does not", async ({
    request,
  }) => {
    // --- flag resolution: same endpoint, opposite answers, decided purely by the caller's tenant --
    const flagsA = await apiGetJson<{ flags: Record<string, boolean> }>(
      request,
      tokenA,
      "/api/feature-flags",
    );
    const flagsB = await apiGetJson<{ flags: Record<string, boolean> }>(
      request,
      tokenB,
      "/api/feature-flags",
    );
    expect(flagsA.flags, `A's resolved flags: ${JSON.stringify(flagsA.flags)}`).toHaveProperty(
      SIFEN_FLAG,
      true,
    );
    expect(flagsB.flags, `B's resolved flags: ${JSON.stringify(flagsB.flags)}`).toHaveProperty(
      SIFEN_FLAG,
      false,
    );

    // --- A: an IDENTIFIED receiver with a blank email is refused — proof the SIFEN branch ran ----
    const refused = await raw(
      request,
      "post",
      tokenA,
      "/api/invoices",
      invoiceBody("A-identified-no-email", 50_000, { identified: true, email: null }),
    );
    expect(
      refused.status,
      `A identified+blank-email expected 400, got ${refused.status}: ${refused.text.slice(0, 400)}`,
    ).toBe(400);
    expect(refused.text).toContain("SIFEN_RECIPIENT_EMAIL_REQUIRED");

    // --- A: an unidentified receiver goes through and the response already carries the CDC -------
    const aInvoice = await emitInvoice(request, tokenA, "A-branch");
    expect(
      aInvoice.sifenControlNumber,
      `A's invoice ${aInvoice.id} carries no CDC — the SIFEN branch did not run: ${JSON.stringify(aInvoice)}`,
    ).toBeTruthy();
    // The CDC is SIFEN's 44-digit control number, minted by prepareAndSign before the 201.
    expect(String(aInvoice.sifenControlNumber)).toMatch(/^\d{44}$/);

    // --- B: the byte-identical "identified + blank email" body is accepted, and mints no CDC -----
    const bAccepted = await raw(
      request,
      "post",
      tokenB,
      "/api/invoices",
      invoiceBody("B-identified-no-email", 50_000, { identified: true, email: null }),
    );
    expect(
      bAccepted.status,
      `B identified+blank-email expected 201, got ${bAccepted.status}: ${bAccepted.text.slice(0, 400)}`,
    ).toBe(201);
    const bInvoice = bAccepted.json as EmittedInvoice;
    expect(
      bInvoice.sifenControlNumber ?? null,
      `B's invoice ${bInvoice.id} got a CDC despite SIFEN being off for its tier`,
    ).toBeNull();
    expect(bInvoice.sifenSubmissionStatus ?? null).toBeNull();

    // --- B: the un-gated SIFEN status endpoint answers with B's OWN domain state, not a leak -----
    // (Discovery note 3: there is no feature-disabled code; a non-SIFEN invoice simply never
    // reaches PENDING_VERIFICATION, so the pre-check conflicts.)
    const bStatusPoll = await raw(
      request,
      "post",
      tokenB,
      `/api/invoices/${bInvoice.id}/sifen/check-status`,
    );
    expect(
      bStatusPoll.status,
      `B check-status on its own invoice: ${bStatusPoll.status} ${bStatusPoll.text.slice(0, 400)}`,
    ).toBe(409);
    expect(bStatusPoll.text).toContain("SIFEN_INVOICE_NOT_PENDING_VERIFICATION");
  });

  test("2 · certificates and timbrados never cross tenants", async ({ request }) => {
    // Capture T-A's stamp identity here rather than trusting the world file to record it.
    const aStamp = await activeStamp(request, tokenA);
    const bStamp = await activeStamp(request, tokenB);
    expect(aStamp.id, "A and B must not share a fiscal stamp row").not.toBe(bStamp.id);
    expect(aStamp.stampNumber).not.toBe(bStamp.stampNumber);

    const aStamps = await listFiscalStamps(request, tokenA);
    const bStamps = await listFiscalStamps(request, tokenB);

    expect(aStamps.map((s) => s.id)).toContain(aStamp.id);
    expect(
      bStamps.map((s) => s.id),
      `B's timbrado list LEAKED A's stamp id ${aStamp.id}`,
    ).not.toContain(aStamp.id);
    expect(
      bStamps.map((s) => s.stampNumber),
      `B's timbrado list LEAKED A's stamp number ${aStamp.stampNumber}`,
    ).not.toContain(aStamp.stampNumber);
    // …and symmetrically, so this can't pass by A simply seeing everything.
    expect(bStamps.map((s) => s.id)).toContain(bStamp.id);
    expect(
      aStamps.map((s) => s.id),
      `A's timbrado list LEAKED B's stamp id ${bStamp.id}`,
    ).not.toContain(bStamp.id);

    // --- certificates: A owns the uploaded test .p12 (world.ts provisioning); B owns none --------
    type Cert = { id: number; status: string; notAfter: string };
    const aCerts = await apiGetJson<Cert[]>(request, tokenA, "/api/sifen/certificates");
    const bCerts = await apiGetJson<Cert[]>(request, tokenB, "/api/sifen/certificates");
    expect(
      aCerts.length,
      "T-A must own the SIFEN certificate world.ts uploads for it — see the file header",
    ).toBeGreaterThan(0);
    for (const aCert of aCerts) {
      expect(
        bCerts.map((c) => c.id),
        `B's certificate list LEAKED A's certificate id ${aCert.id}`,
      ).not.toContain(aCert.id);
    }
  });

  test("3 · numeración inutilizada is per-tenant in both directions", async ({ request }) => {
    const aEvent = await registerNumberVoiding(
      request,
      tokenA,
      `MT A numeracion no utilizada ${RUN_SEED}`,
    );
    // B gets its own record too, so "B's list excludes A's id" cannot pass on an empty list.
    const bEvent = await registerNumberVoiding(
      request,
      tokenB,
      `MT B numeracion no utilizada ${RUN_SEED}`,
    );
    expect(aEvent.id).not.toBe(bEvent.id);

    const aIds = await listVoidingIds(request, tokenA);
    const bIds = await listVoidingIds(request, tokenB);

    expect(aIds, `A cannot see its own voiding record ${aEvent.id}`).toContain(aEvent.id);
    expect(bIds, `B cannot see its own voiding record ${bEvent.id}`).toContain(bEvent.id);
    expect(bIds, `B's voiding list LEAKED A's record ${aEvent.id}`).not.toContain(aEvent.id);
    expect(aIds, `A's voiding list LEAKED B's record ${bEvent.id}`).not.toContain(bEvent.id);
  });

  test("4 · A's SIFEN sub-resources are not addressable with B's token", async ({ request }) => {
    const aInvoice = await emitInvoice(request, tokenA, "A-crossprobe");
    expect(aInvoice.sifenControlNumber).toBeTruthy();

    // Positive control: the KuDE route resolves for the OWNING tenant. `prepareAndSign` mints the
    // CDC/QR before the 201, so the KuDE PDF is downloadable the moment the invoice is QUEUED — no
    // SIFEN approval needed (hu-08 RT-20). This proves the 403/404 below is tenant scoping, not a
    // dead route that would satisfy `expectCrossTenantForbidden` for the wrong reason.
    const aOwnKude = await raw(request, "get", tokenA, `/api/invoices/${aInvoice.id}/sifen/kude`);
    expect(
      aOwnKude.status,
      `A's own KuDE GET expected 200, got ${aOwnKude.status}: ${aOwnKude.text.slice(0, 200)}`,
    ).toBe(200);

    // KuDE (GET, PDF): 403/404 for a foreign tenant, never 200 and never a 5xx.
    await expectCrossTenantForbidden(
      request,
      tokenB,
      `/api/invoices/${aInvoice.id}/sifen/kude`,
    );
    // The invoice itself, for good measure — the KuDE's 404 must come from tenant scoping.
    await expectCrossTenantForbidden(request, tokenB, `/api/invoices/${aInvoice.id}`);

    // POST variants (expectCrossTenantForbidden only does GET).
    for (const path of [
      `/api/invoices/${aInvoice.id}/sifen/check-status`,
      `/api/invoices/${aInvoice.id}/sifen/kude/email`,
    ]) {
      const res = await raw(request, "post", tokenB, path, {});
      expect(
        [403, 404],
        `POST ${path} with B's token returned ${res.status}: ${res.text.slice(0, 400)}`,
      ).toContain(res.status);
    }
  });

  test("5 · A's stamp consumption is driven only by A's own emissions", async ({ request }) => {
    const aBefore = await activeStamp(request, tokenA);
    const bBefore = await activeStamp(request, tokenB);

    // A(1) · B(1) · B(2) · A(2) — B's emissions deliberately interleaved between A's.
    const a1 = await emitInvoice(request, tokenA, "A-consume-1");
    const b1 = await emitInvoice(request, tokenB, "B-consume-1");
    const b2 = await emitInvoice(request, tokenB, "B-consume-2");
    const a2 = await emitInvoice(request, tokenA, "A-consume-2");

    const aAfter = await activeStamp(request, tokenA);
    const bAfter = await activeStamp(request, tokenB);

    // A stamp rotation mid-test would make the delta meaningless — assert it didn't happen.
    expect(aAfter.id, "A's active fiscal stamp rotated mid-test").toBe(aBefore.id);
    expect(bAfter.id, "B's active fiscal stamp rotated mid-test").toBe(bBefore.id);

    expect(
      aAfter.nextEmissionNumber - aBefore.nextEmissionNumber,
      `A's stamp advanced by ${aAfter.nextEmissionNumber - aBefore.nextEmissionNumber} for A's 2 emissions ` +
        `(B emitted 2 in between: invoices ${b1.id}, ${b2.id}) — expected exactly 2`,
    ).toBe(2);
    expect(
      bAfter.nextEmissionNumber - bBefore.nextEmissionNumber,
      `B's stamp advanced by ${bAfter.nextEmissionNumber - bBefore.nextEmissionNumber} for B's 2 emissions ` +
        `(A emitted 2 around them: invoices ${a1.id}, ${a2.id}) — expected exactly 2`,
    ).toBe(2);

    // The numbers A actually consumed are A's own two, contiguous from where its stamp stood.
    expect([a1.invoiceNumber, a2.invoiceNumber]).toEqual([
      aBefore.nextEmissionNumber,
      aBefore.nextEmissionNumber + 1,
    ]);
    expect([b1.invoiceNumber, b2.invoiceNumber]).toEqual([
      bBefore.nextEmissionNumber,
      bBefore.nextEmissionNumber + 1,
    ]);
  });

  test("6 · simultaneous SIFEN status polls answer each tenant with its own state", async ({
    request,
  }) => {
    // Budget: this scenario waits on the async SIFEN transmit before racing two live polls.
    test.setTimeout(120_000);
    const aInvoice = await emitInvoice(request, tokenA, "A-race-poll");
    const bInvoice = await emitInvoice(request, tokenB, "B-race-poll");
    expect(aInvoice.sifenControlNumber).toBeTruthy();
    expect(bInvoice.sifenControlNumber ?? null).toBeNull();

    // A's invoice must have been transmitted (and left unanswered) before check-status is callable.
    const aSifenStatus = await waitForSifenStatus(
      request,
      tokenA,
      aInvoice.id,
      "PENDING_VERIFICATION",
    );

    const [aSettled, bSettled] = await raceAcrossTenants(
      () => raw(request, "post", tokenA, `/api/invoices/${aInvoice.id}/sifen/check-status`),
      () => raw(request, "post", tokenB, `/api/invoices/${bInvoice.id}/sifen/check-status`),
    );

    expect(aSettled.status, `A's poll threw: ${JSON.stringify(aSettled)}`).toBe("fulfilled");
    expect(bSettled.status, `B's poll threw: ${JSON.stringify(bSettled)}`).toBe("fulfilled");
    const aRes = (aSettled as PromiseFulfilledResult<RawResponse>).value;
    const bRes = (bSettled as PromiseFulfilledResult<RawResponse>).value;

    // --- A's side ------------------------------------------------------------------------------
    expect(aRes.status, `A's poll 5xx'd: ${aRes.text.slice(0, 400)}`).toBeLessThan(500);
    if (aSifenStatus === "PENDING_VERIFICATION") {
      // The real, unreachable-SIFEN path: the query gets no answer, the invoice stays pending, and
      // the endpoint still returns A's OWN fresh invoice (HU-07 AC-04's "no answer" branch).
      expect(
        aRes.status,
        `A check-status expected 200, got ${aRes.status}: ${aRes.text.slice(0, 400)}`,
      ).toBe(200);
      const aBody = aRes.json as EmittedInvoice;
      expect(aBody.id, "A's poll returned another invoice").toBe(aInvoice.id);
      expect(aBody.id, "A's poll returned B's invoice — CROSS-TENANT SWAP").not.toBe(bInvoice.id);
      expect(aBody.sifenControlNumber).toBe(aInvoice.sifenControlNumber);
    } else {
      // Queue slower than the 30s budget: the endpoint must still answer about A's OWN invoice
      // with a per-tenant SIFEN conflict, never with B's data.
      expect(
        aRes.status,
        `A check-status (invoice still ${aSifenStatus}) returned ${aRes.status}: ${aRes.text.slice(0, 400)}`,
      ).toBe(409);
      expect(aRes.text).toContain("SIFEN_INVOICE_");
      expect(
        aRes.text,
        `A's poll response mentions B's invoice id ${bInvoice.id} — CROSS-TENANT LEAK`,
      ).not.toContain(String(bInvoice.id));
    }

    // --- B's side: its own domain answer, independent of whatever A's poll did -------------------
    expect(
      bRes.status,
      `B check-status expected 409, got ${bRes.status}: ${bRes.text.slice(0, 400)}`,
    ).toBe(409);
    expect(bRes.text).toContain("SIFEN_INVOICE_NOT_PENDING_VERIFICATION");
    expect(
      bRes.text,
      `B's poll response mentions A's CDC ${aInvoice.sifenControlNumber} — CROSS-TENANT LEAK`,
    ).not.toContain(String(aInvoice.sifenControlNumber));

    // Neither poll disturbed the other tenant's invoice.
    const aFinal = await apiGetJson<EmittedInvoice>(
      request,
      tokenA,
      `/api/invoices/${aInvoice.id}`,
    );
    const bFinal = await apiGetJson<EmittedInvoice>(
      request,
      tokenB,
      `/api/invoices/${bInvoice.id}`,
    );
    expect(aFinal.sifenControlNumber).toBe(aInvoice.sifenControlNumber);
    expect(bFinal.sifenControlNumber ?? null).toBeNull();
    expect(bFinal.sifenSubmissionStatus ?? null).toBeNull();
  });
});
