import { expect, test, type APIRequestContext } from "@playwright/test";

import { API_BASE, apiGetJson, authHeaders, setTenantFeatureFlag } from "../../fixtures/api";
import { expectUnchanged, snapshotTenant } from "../../fixtures/mt/probe";
import { getMtWorld, mtLoginToken, mtPlatformToken } from "../../fixtures/mt/world";

/**
 * Task 9 — mt-platform-config: runtime configuration changes stay tenant-scoped.
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * DISCOVERY (recorded so nobody re-derives it):
 *
 * 1. **Resolved-flags endpoint** `GET /api/admin/feature-flags/tenants/{tenantId}` (platform-admin
 *    token) returns a **bare array** of rows, one per seeded flag:
 *      { flagKey, globalEnabled, hasTier, tierEnabled, hasOverride, overrideEnabled,
 *        effectiveEnabled, effectiveSource: "GLOBAL" | "TIER" | "OVERRIDE" }
 *    (verified against `hu-47-resolucion-de-flags-en-tres-niveles.spec.ts` / `hu-38-editar-tenant`).
 *
 * 2. **Global default endpoint** `GET /api/admin/feature-flags` returns a bare array of
 *    `{ flagKey, enabled }`. This suite only ever READS it — the global default is shared state and
 *    is never written here.
 *
 * 3. **Per-tenant override**: `PUT /api/admin/feature-flags/tenants/{id}/{key} { enabled }` sets it
 *    (via `setTenantFeatureFlag`), `DELETE /api/admin/feature-flags/tenants/{id}/{key}` clears it.
 *    Clearing returns to tier/global resolution with immediate effect (no restart, no cache).
 *
 * 4. **Tenant tier**: `PUT /api/platform/tenants/{id} { name, domain, tierId }` (returns
 *    `{ tierId, tierName, ... }`); `GET /api/platform/tenants?page=0&size=200` → `{ content: [...] }`.
 *    New tier: `POST /api/platform/tiers { name, description }` → `{ id, name }`.
 *
 * 5. **Tenant status**: `PATCH /api/platform/tenants/{id}/status { status }` — SUSPENDED blocks
 *    fresh logins (401, indistinguishable from a wrong password) AND rejects an already-issued token
 *    on its next request (401/403). ACTIVE restores both immediately.
 *
 * The mt world (see `fixtures/mt/world.ts`): T-A's tier (id 3) INCLUDES SIFEN_ELECTRONIC_INVOICING;
 * T-B's tier (id 4) EXCLUDES it; the global default for that flag is `false` (V29). T-C is already
 * SUSPENDED and must stay that way.
 *
 * EVERY scenario here mutates shared platform config. Every one wraps its mutation in `try/finally`,
 * restores the original state in `finally`, and then asserts (past the finally) that the restore
 * actually took. Scenario 3's `finally` re-activates T-B and a post-finally assertion proves T-B's
 * admin can log in again — leaving T-B suspended would break every later spec run.
 *
 * A failing isolation assertion (A's override moving B's resolved flags; A's tier swap moving B's;
 * suspending B affecting A or C; any mutation changing the global default) is a suspected PRODUCT
 * BUG — it is reported with evidence, never weakened.
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 */

const world = getMtWorld();

const SIFEN_FLAG = "SIFEN_ELECTRONIC_INVOICING";

/** Wide window so `GET /api/appointments` is a plain authenticated read, not a 400-for-missing-params. */
const APPT_WINDOW = "?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z";

type TenantFlagRow = {
  flagKey: string;
  globalEnabled: boolean;
  hasTier: boolean;
  tierEnabled: boolean | null;
  hasOverride: boolean;
  overrideEnabled: boolean | null;
  effectiveEnabled: boolean;
  effectiveSource: "GLOBAL" | "TIER" | "OVERRIDE";
};

type GlobalFlagRow = { flagKey: string; enabled: boolean };

type TenantListRow = { id: number; name: string; tierId: number | null; status: string };

async function readResolvedFlags(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
): Promise<TenantFlagRow[]> {
  return apiGetJson<TenantFlagRow[]>(
    request,
    platformToken,
    `/api/admin/feature-flags/tenants/${tenantId}`,
  );
}

async function readResolvedFlag(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
  flagKey: string,
): Promise<TenantFlagRow> {
  const rows = await readResolvedFlags(request, platformToken, tenantId);
  const row = rows.find((r) => r.flagKey === flagKey);
  expect(
    row,
    `resolved flags for tenant ${tenantId} carry no ${flagKey}: ${JSON.stringify(rows)}`,
  ).toBeTruthy();
  return row as TenantFlagRow;
}

/** Just the effective outcome per flag — the shape used to assert "B's resolution never moved". */
function effectiveMap(
  rows: TenantFlagRow[],
): Record<string, { effectiveEnabled: boolean; effectiveSource: string }> {
  return Object.fromEntries(
    rows.map((r) => [
      r.flagKey,
      { effectiveEnabled: r.effectiveEnabled, effectiveSource: r.effectiveSource },
    ]),
  );
}

async function readGlobalFlag(
  request: APIRequestContext,
  platformToken: string,
  flagKey: string,
): Promise<GlobalFlagRow> {
  const rows = await apiGetJson<GlobalFlagRow[]>(request, platformToken, "/api/admin/feature-flags");
  const row = rows.find((r) => r.flagKey === flagKey);
  expect(row, `global feature-flags carry no ${flagKey}: ${JSON.stringify(rows)}`).toBeTruthy();
  return row as GlobalFlagRow;
}

async function readTenantRow(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
): Promise<TenantListRow> {
  const page = await apiGetJson<{ content: TenantListRow[] }>(
    request,
    platformToken,
    "/api/platform/tenants?page=0&size=200",
  );
  const row = page.content.find((t) => t.id === tenantId);
  expect(row, `platform tenant listing has no tenant ${tenantId}`).toBeTruthy();
  return row as TenantListRow;
}

/** `GET /api/feature-flags` from a tenant session's own perspective → `{ flags: { KEY: boolean } }`. */
async function readOwnResolvedFlags(
  request: APIRequestContext,
  tenantToken: string,
): Promise<Record<string, boolean>> {
  const body = await apiGetJson<{ flags: Record<string, boolean> }>(
    request,
    tenantToken,
    "/api/feature-flags",
  );
  return body.flags;
}

test.describe("mt-isolation · platform config stays tenant-scoped", () => {
  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Scenario 1 (anchor) — a per-tenant SIFEN override on A changes only A: not B's resolution,
  // not the global default.
  // ────────────────────────────────────────────────────────────────────────────────────────────
  test("1 · a per-tenant SIFEN override for A does not touch B or the global default", async ({
    request,
  }) => {
    test.setTimeout(90_000); // mutates shared platform config — the finally MUST get to run to restore it
    const platformToken = await mtPlatformToken(request);
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);

    // Baseline — captured, never assumed.
    const globalBefore = (await readGlobalFlag(request, platformToken, SIFEN_FLAG)).enabled;
    const bBefore = effectiveMap(await readResolvedFlags(request, platformToken, world.tenantB.id));
    const bOwnBefore = await readOwnResolvedFlags(request, tokenB);

    const aBefore = await readResolvedFlag(request, platformToken, world.tenantA.id, SIFEN_FLAG);
    expect(
      aBefore.effectiveEnabled,
      "precondition: A should resolve SIFEN enabled from its tier before the override",
    ).toBe(true);
    expect(aBefore.effectiveSource).toBe("TIER");
    expect(bBefore[SIFEN_FLAG]?.effectiveEnabled, "precondition: B resolves SIFEN disabled").toBe(
      false,
    );

    try {
      // Force this ONE tenant's flag OFF (already effectively off would be nothing to see; A's is on).
      await setTenantFeatureFlag(request, world.tenantA.id, SIFEN_FLAG, false);

      // A: the override is now the effective source, and it resolves false.
      const aAfter = await readResolvedFlag(request, platformToken, world.tenantA.id, SIFEN_FLAG);
      expect(aAfter.hasOverride, "A's override was not recorded").toBe(true);
      expect(aAfter.overrideEnabled).toBe(false);
      expect(aAfter.effectiveEnabled, "A's SIFEN flag did not fall to the override value").toBe(
        false,
      );
      expect(aAfter.effectiveSource).toBe("OVERRIDE");
      expect(await readOwnResolvedFlags(request, tokenA)).toHaveProperty(SIFEN_FLAG, false);

      // B: resolution byte-identical to baseline — the override on A did not reach it.
      const bAfter = effectiveMap(await readResolvedFlags(request, platformToken, world.tenantB.id));
      expect(bAfter, "changing A's override moved B's resolved flags — SUSPECTED PRODUCT BUG").toEqual(
        bBefore,
      );
      expect(
        await readOwnResolvedFlags(request, tokenB),
        "B's own resolved flags changed after A's override — SUSPECTED PRODUCT BUG",
      ).toEqual(bOwnBefore);

      // Global default: unchanged (a per-tenant override must never write the global row).
      expect(
        (await readGlobalFlag(request, platformToken, SIFEN_FLAG)).enabled,
        "a per-tenant override changed the GLOBAL default — SUSPECTED PRODUCT BUG",
      ).toBe(globalBefore);
    } finally {
      const del = await request.delete(
        `${API_BASE}/api/admin/feature-flags/tenants/${world.tenantA.id}/${SIFEN_FLAG}`,
        { headers: authHeaders(platformToken) },
      );
      expect(
        del.ok(),
        `restore: DELETE A's ${SIFEN_FLAG} override failed (${del.status()}): ${await del.text()}`,
      ).toBeTruthy();
    }

    // Restoration proof (past the finally): A is back to tier-driven enabled, nothing left behind.
    const aRestored = await readResolvedFlag(
      request,
      platformToken,
      world.tenantA.id,
      SIFEN_FLAG,
    );
    expect(aRestored.hasOverride, "A's override was not cleared by the restore").toBe(false);
    expect(aRestored.effectiveEnabled, "A's SIFEN flag did not return to enabled").toBe(true);
    expect(aRestored.effectiveSource).toBe("TIER");
    expect(
      (await readGlobalFlag(request, platformToken, SIFEN_FLAG)).enabled,
      "global default drifted across the scenario",
    ).toBe(globalBefore);
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Scenario 2 — moving A onto an empty throwaway tier drops A's resolved SIFEN flag to the global
  // default; B's resolution is untouched.
  // ────────────────────────────────────────────────────────────────────────────────────────────
  test("2 · changing A's tier shifts A's resolved flags but not B's", async ({ request }) => {
    test.setTimeout(90_000); // mutates shared platform config — the finally MUST get to run to restore it
    const platformToken = await mtPlatformToken(request);

    const originalTierId = (await readTenantRow(request, platformToken, world.tenantA.id)).tierId;
    expect(originalTierId, "A has no tier assigned — cannot exercise a tier swap").toBeTruthy();

    const globalSifen = (await readGlobalFlag(request, platformToken, SIFEN_FLAG)).enabled;
    const bBefore = effectiveMap(await readResolvedFlags(request, platformToken, world.tenantB.id));

    const aBefore = await readResolvedFlag(request, platformToken, world.tenantA.id, SIFEN_FLAG);
    expect(
      aBefore.effectiveEnabled && aBefore.effectiveSource === "TIER",
      "precondition: A should resolve SIFEN enabled from its tier before the swap",
    ).toBe(true);

    // A throwaway tier that includes no flags at all.
    const throwawayTier = await createTier(request, platformToken, `MT throwaway ${Date.now()}`);

    try {
      const put = await request.put(`${API_BASE}/api/platform/tenants/${world.tenantA.id}`, {
        headers: authHeaders(platformToken),
        data: { name: world.tenantA.name, domain: null, tierId: throwawayTier.id },
      });
      expect(put.ok(), `PUT A onto the throwaway tier failed: ${await put.text()}`).toBeTruthy();

      // A: no override, empty tier ⇒ resolution falls all the way through to the global default.
      const aAfter = await readResolvedFlag(request, platformToken, world.tenantA.id, SIFEN_FLAG);
      expect(aAfter.hasOverride).toBe(false);
      expect(
        aAfter.effectiveEnabled,
        "A's SIFEN flag did not fall to the global default after losing its tier",
      ).toBe(globalSifen);
      expect(aAfter.effectiveSource).toBe("GLOBAL");

      // B: resolution unchanged — A's tier swap did not reach it.
      const bAfter = effectiveMap(await readResolvedFlags(request, platformToken, world.tenantB.id));
      expect(bAfter, "changing A's tier moved B's resolved flags — SUSPECTED PRODUCT BUG").toEqual(
        bBefore,
      );

      // Global default untouched by a tier reassignment.
      expect(
        (await readGlobalFlag(request, platformToken, SIFEN_FLAG)).enabled,
        "a tier reassignment changed the GLOBAL default — SUSPECTED PRODUCT BUG",
      ).toBe(globalSifen);
    } finally {
      const restore = await request.put(`${API_BASE}/api/platform/tenants/${world.tenantA.id}`, {
        headers: authHeaders(platformToken),
        data: { name: world.tenantA.name, domain: null, tierId: originalTierId },
      });
      expect(
        restore.ok(),
        `restore: PUT A back onto tier ${originalTierId} failed (${restore.status()}): ${await restore.text()}`,
      ).toBeTruthy();
    }

    // Restoration proof: A is back on its original tier and resolves SIFEN from it again.
    const aRow = await readTenantRow(request, platformToken, world.tenantA.id);
    expect(aRow.tierId, "A's tier was not restored").toBe(originalTierId);
    const aRestoredFlag = await readResolvedFlag(
      request,
      platformToken,
      world.tenantA.id,
      SIFEN_FLAG,
    );
    expect(aRestoredFlag.effectiveEnabled, "A's SIFEN flag did not return to enabled").toBe(true);
    expect(aRestoredFlag.effectiveSource).toBe("TIER");
    expect(
      effectiveMap(await readResolvedFlags(request, platformToken, world.tenantB.id)),
      "B's resolution moved across the scenario",
    ).toEqual(bBefore);
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // Scenario 3 — suspending T-B mid-run blocks T-B only. T-A and T-C are unaffected. THE DANGEROUS
  // ONE: `finally` must re-activate T-B, and a post-finally assertion proves its admin can log in.
  // ────────────────────────────────────────────────────────────────────────────────────────────
  test("3 · suspending B mid-run blocks B only; A and C unaffected", async ({ request }) => {
    test.setTimeout(90_000); // mutates shared platform config — the finally MUST get to run to restore it
    const platformToken = await mtPlatformToken(request);
    const aToken = await mtLoginToken(request, world.tenantA);
    const bTokenBefore = await mtLoginToken(request, world.tenantB);
    const aBefore = await snapshotTenant(request, aToken);

    try {
      const suspend = await request.patch(
        `${API_BASE}/api/platform/tenants/${world.tenantB.id}/status`,
        { headers: authHeaders(platformToken), data: { status: "SUSPENDED" } },
      );
      expect(suspend.ok(), `suspend B failed: ${await suspend.text()}`).toBeTruthy();

      // B: a fresh login is rejected (401 — same as a wrong password, no enumeration signal).
      const bFreshLogin = await request.post(`${API_BASE}/api/auth/login`, {
        data: { email: world.tenantB.adminEmail, password: world.tenantB.adminPassword },
      });
      expect(bFreshLogin.status(), `B fresh login while suspended: ${await bFreshLogin.text()}`).toBe(
        401,
      );

      // B: a token issued BEFORE the suspend is rejected on its next request.
      const bStaleCall = await request.get(`${API_BASE}/api/appointments${APPT_WINDOW}`, {
        headers: authHeaders(bTokenBefore),
      });
      expect(
        [401, 403],
        `B's pre-suspend token still worked (${bStaleCall.status()}) — session not invalidated`,
      ).toContain(bStaleCall.status());

      // A: login still works AND A's whole tenant state is byte-identical.
      const aReloginToken = await mtLoginToken(request, world.tenantA);
      expect(aReloginToken, "A admin login broke while B was suspended").toBeTruthy();
      expectUnchanged(aBefore, await snapshotTenant(request, aToken));
      expectUnchanged(aBefore, await snapshotTenant(request, aReloginToken));

      // C: still 401 — it was already suspended and nothing here should have changed that.
      const cLogin = await request.post(`${API_BASE}/api/auth/login`, {
        data: { email: world.tenantC.adminEmail, password: world.tenantC.adminPassword },
      });
      expect(cLogin.status(), `C login changed while B was suspended: ${await cLogin.text()}`).toBe(
        401,
      );
    } finally {
      const reactivate = await request.patch(
        `${API_BASE}/api/platform/tenants/${world.tenantB.id}/status`,
        { headers: authHeaders(platformToken), data: { status: "ACTIVE" } },
      );
      expect(
        reactivate.ok(),
        `BLOCKER: could not reactivate T-B (${reactivate.status()}): ${await reactivate.text()}`,
      ).toBeTruthy();
    }

    // Restoration proof (past the finally): T-B's admin can log in again.
    const bRelogin = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: world.tenantB.adminEmail, password: world.tenantB.adminPassword },
    });
    expect(
      bRelogin.ok(),
      `BLOCKER: T-B admin cannot log in after restore (${bRelogin.status()}): ${await bRelogin.text()}`,
    ).toBeTruthy();
    expect((await bRelogin.json()).accessToken, "T-B relogin returned no token").toBeTruthy();

    // And T-B's status reads ACTIVE from the platform listing.
    expect((await readTenantRow(request, platformToken, world.tenantB.id)).status).toBe("ACTIVE");
    // T-C is still SUSPENDED — the invariant every later spec relies on.
    expect((await readTenantRow(request, platformToken, world.tenantC.id)).status).toBe("SUSPENDED");
  });
});

async function createTier(
  request: APIRequestContext,
  platformToken: string,
  name: string,
): Promise<{ id: number; name: string }> {
  const res = await request.post(`${API_BASE}/api/platform/tiers`, {
    headers: authHeaders(platformToken),
    data: { name, description: null },
  });
  expect(res.ok(), `create throwaway tier failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: number; name: string };
}
