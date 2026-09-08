import { expect, test } from "@playwright/test";
import {
  apiBaseUrl,
  authHeaders,
  decodeJwtPayload,
  loginAsDemoApi,
  loginPlatformAdminApi,
} from "../fixtures/api";
import { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD } from "../fixtures/auth";

// HU-36 · Migrar el SYSTEM_ADMIN existente a Platform Admin tenant-independiente
// requirements/multi-tenant/HU-36-migrar-system-admin-a-platform-admin.md
//
// API-only coverage (Playwright `request` fixture), mirroring HU-34's own spec: this story is
// backend identity/data-model plumbing (a Flyway migration + retiring a role + retiring an
// authorization bypass), not a new UI surface — the UI consequence (Feature Flags moving from
// /app/settings/feature-flags to /platform/feature-flags) is covered by
// sifen-hu-22-activacion-por-tenant.spec.ts and sifen-rt19-homologacion.spec.ts, which already
// drive that page end-to-end as a Platform Admin.
//
// AC-1 (the V40 Flyway migration itself, converting an existing SYSTEM_ADMIN row to
// PLATFORM_ADMIN/tenant_id=NULL while preserving email+password_hash) has **no automated coverage**
// here or anywhere else in this repo: per CLAUDE.md, backend tests run against H2 with
// `ddl-auto=create-drop` and Flyway disabled (`e2e`/`test` profiles), so no test in this codebase
// ever exercises a real Flyway migration end-to-end — every other V<n> migration has the same gap.
// The HU's own "Notas para estimación y pruebas" names manual verification for exactly this reason
// ("correr la migración sobre una base con el seed legado y verificar el estado resultante"). What
// *is* covered below is the resulting behavior the migration is supposed to produce: the same
// credentials keep working (AC-4) and only ever resolve to a tenant-independent PLATFORM_ADMIN,
// never a SYSTEM_ADMIN (AC-2).

const DEMO_TENANT_ID = 1;

test.describe("HU-36 · Migrar SYSTEM_ADMIN a Platform Admin", () => {
  // AC-4: the platform-operator account logs in with its existing credentials — no password
  // reset step — and gets a PLATFORM_ADMIN token with no tid, exactly like any other
  // PLATFORM_ADMIN login. (The seeded platform-admin@pelu account stands in for "a user who was
  // already migrated by V40": e2e's H2/create-drop backend never had a legacy SYSTEM_ADMIN row to
  // migrate from in the first place — see the file-level note above.)
  test("AC4: logs in with existing credentials, no reset, and gets a tenant-independent token", async ({
    request,
  }) => {
    const res = await request.post(`${apiBaseUrl()}/api/auth/login`, {
      data: { email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { accessToken } = (await res.json()) as { accessToken: string };
    const claims = decodeJwtPayload(accessToken);

    expect(claims.role).toBe("PLATFORM_ADMIN");
    expect(claims).not.toHaveProperty("tid");
  });

  // AC-2: no user can log in as SYSTEM_ADMIN anymore — the legacy root@pelu credentials that used
  // to authenticate a tenant-bound system operator are rejected outright, because that role no
  // longer exists (and, per V40, no app_users row has role='SYSTEM_ADMIN' after migration either).
  test("AC2: the legacy SYSTEM_ADMIN credentials no longer authenticate", async ({ request }) => {
    const res = await request.post(`${apiBaseUrl()}/api/auth/login`, {
      data: { email: "root@pelu", password: ".The.Super@admin.1982" },
    });

    expect(res.status()).toBe(401);
  });

  // AC-3: PLATFORM_ADMIN reaches feature-flag administration (the capability the legacy
  // SYSTEM_ADMIN used to reach via a TenantPathAccess bypass on a tenant-scoped route) only
  // through the explicit /api/admin/feature-flags route, gated by role — not by a tenant-match
  // bypass. TenantPathAccess itself no longer special-cases any role (see TenantPathAccessTest).
  test("AC3: PLATFORM_ADMIN reaches feature-flag administration as an explicit platform route", async ({
    request,
  }) => {
    const token = await loginPlatformAdminApi(request);

    const res = await request.get(
      `${apiBaseUrl()}/api/admin/feature-flags/tenants/${DEMO_TENANT_ID}`,
      { headers: authHeaders(token) },
    );

    expect(res.ok(), await res.text()).toBeTruthy();
  });

  // AC-3 (control): a tenant-bound ADMIN — which never had this power even before HU-36 — still
  // cannot reach feature-flag administration for its own tenant. This route is PLATFORM_ADMIN-only,
  // not "any authenticated tenant-bound role, matched to its own tenant".
  test("AC3: a tenant-bound ADMIN cannot reach feature-flag administration", async ({ request }) => {
    const token = await loginAsDemoApi(request);

    const res = await request.get(
      `${apiBaseUrl()}/api/admin/feature-flags/tenants/${DEMO_TENANT_ID}`,
      { headers: authHeaders(token) },
    );

    expect(res.status()).toBe(403);
  });

  // AC-3: unchanged from HU-34 — PLATFORM_ADMIN still gets no bypass on genuinely tenant-scoped
  // business routes (retiring the SYSTEM_ADMIN bypass in TenantPathAccess did not introduce a new
  // one for PLATFORM_ADMIN anywhere).
  test("AC3: PLATFORM_ADMIN still cannot reach tenant-scoped business routes", async ({
    request,
  }) => {
    const token = await loginPlatformAdminApi(request);

    const res = await request.get(`${apiBaseUrl()}/api/clients`, { headers: authHeaders(token) });

    expect(res.status()).toBe(403);
  });
});
