import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginAsDemoApi, loginPlatformAdminApi } from "../fixtures/api";
import { DEMO_EMAIL, DEMO_PASSWORD } from "../fixtures/auth";

// HU-58 · Ajustar el entorno e2e para no depender del seed hardcodeado
// requirements/multi-tenant/HU-58-ajustar-e2e-sin-seed-hardcodeado.md
//
// FemmeDataInitializer no longer creates any tenant, user, service, client or professional at
// boot (PRD "Sin seed hardcodeado") — the demo tenant + admin (DEMO_EMAIL/DEMO_PASSWORD) that
// most of this suite's specs log in as is instead provisioned once, dynamically, by
// e2e/global-setup.ts before any test runs, via the same Platform Admin tenant-creation +
// admin-invite + activation API HU-37/HU-41 expose. This spec proves that mechanism directly
// (AC-1/AC-2), independently of whichever specs happen to run around it.

// Mirrors application-e2e.properties' app.femme.jwt.secret exactly — same technique as
// hu-37-crear-tenant.spec.ts's forgeHs256Jwt, used there for the identical reason: CORS only
// allows the frontend dev origin (localhost:5173), and AuthService.resolveTenant only routes a
// plain password login to a non-demo tenant when the request's Origin matches that tenant's own
// domain — neither is reachable from a Playwright `request` call for an arbitrary freshly-created
// tenant. A forged, tenant-scoped token exercises the real business-data endpoints directly
// without depending on either.
const E2E_JWT_SECRET = "e2e-jwt-secret-min-32-characters-long!!";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function forgeHs256Jwt(payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", E2E_JWT_SECRET).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

async function firstTierId(request: APIRequestContext, platformToken: string): Promise<number> {
  const res = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
    headers: authHeaders(platformToken),
  });
  const tiers = (await res.json()) as Array<{ id: number; name: string }>;
  expect(tiers.length).toBeGreaterThan(0);
  return tiers[0].id;
}

test.describe("HU-58 · Ajustar el entorno e2e para no depender del seed hardcodeado", () => {
  // AC-1: the shared "demo" fixture (DEMO_EMAIL) logs in successfully without this test ever
  // calling POST /api/admin/seed/reset — proof its login capability comes from global-setup.ts's
  // dynamic provisioning, not from that reset endpoint reseeding a hardcoded tenant/user.
  test("AC1: the demo tenant admin logs in without any /api/admin/seed/reset call in this test", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    expect(token).toBeTruthy();
  });

  // AC-1/AC-2: a brand-new tenant, provisioned end to end through the exact same real
  // create-tenant -> invite-admin -> activate-account -> log-in flow global-setup.ts uses for the
  // shared demo tenant, starts with an empty catalog (no hardcoded services/clients/professionals)
  // and can seed its own via the ordinary business-data API — the "reusable fixture, new flows"
  // pattern the AC calls for, exercised for a tenant other than the shared demo one.
  test("AC1+AC2: a dynamically-provisioned tenant starts empty and seeds its own catalog via the real API", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);

    const tenantRes = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
      headers: authHeaders(platformToken),
      data: { name: `HU-58 E2E Tenant ${Date.now()}`, domain: null, tierId },
    });
    expect(tenantRes.ok(), await tenantRes.text()).toBeTruthy();
    const tenant = (await tenantRes.json()) as { id: number };

    // AC-2: invite + activate a real admin for this tenant — same flow HU-41 exercises end to end
    // through the UI. (A password login as this admin isn't exercised here: it requires an Origin
    // header CORS allows and that resolves, via Tenant.domain, to this specific non-demo tenant —
    // neither is reachable from a plain API request, the same limitation HU-40/HU-41's own tests
    // document and route around. That resolution mechanism is unrelated to HU-58's own scope.)
    const email = `hu58${Date.now()}@e2e-tenant.test`;
    const adminRes = await request.post(`${apiBaseUrl()}/api/platform/tenants/${tenant.id}/admins`, {
      headers: authHeaders(platformToken),
      data: { email },
    });
    expect(adminRes.ok(), await adminRes.text()).toBeTruthy();
    const { rawToken } = (await adminRes.json()) as { rawToken: string };
    expect(rawToken).toBeTruthy();

    const password = "ValidPass1!";
    const activateRes = await request.post(`${apiBaseUrl()}/api/auth/activate`, {
      data: { token: rawToken, password, confirmPassword: password },
    });
    expect(activateRes.ok(), await activateRes.text()).toBeTruthy();

    // AC-1: exercises this tenant's own business-data endpoints as its own admin — same
    // forgeHs256Jwt technique hu-37-crear-tenant.spec.ts's AC5+AC7 test uses to check the identical
    // thing (a fresh tenant starts with zero business data), extended here to also seed a catalog
    // entry and confirm it round-trips, proving the tenant can build its own fixture via the real
    // API rather than a hardcoded seed.
    const now = Math.floor(Date.now() / 1000);
    const accessToken = forgeHs256Jwt({
      sub: "999997",
      email,
      role: "ADMIN",
      tid: tenant.id,
      iat: now,
      exp: now + 3600,
    });

    // No hardcoded catalog: nothing to see yet.
    for (const path of ["/api/service-categories", "/api/services", "/api/professionals", "/api/clients"]) {
      const res = await request.get(`${apiBaseUrl()}${path}`, {
        headers: authHeaders(accessToken),
      });
      expect(res.ok(), `${path} -> ${res.status()}`).toBeTruthy();
      expect(await res.json(), `${path} should start empty`).toEqual([]);
    }

    // The tenant creates its own catalog via the ordinary API (same pattern as HU-51's Excel
    // import, exercised directly here rather than through a spreadsheet).
    const catRes = await request.post(`${apiBaseUrl()}/api/service-categories`, {
      headers: authHeaders(accessToken),
      data: { name: "HU-58 Category", accentKey: "stone" },
    });
    expect(catRes.ok(), await catRes.text()).toBeTruthy();
    const category = (await catRes.json()) as { id: number };

    const svcRes = await request.post(`${apiBaseUrl()}/api/services`, {
      headers: authHeaders(accessToken),
      data: {
        name: "HU-58 Service",
        categoryId: category.id,
        priceMinor: 10_000,
        durationMinutes: 30,
      },
    });
    expect(svcRes.ok(), await svcRes.text()).toBeTruthy();

    const servicesRes = await request.get(`${apiBaseUrl()}/api/services`, {
      headers: authHeaders(accessToken),
    });
    const services = (await servicesRes.json()) as Array<{ name: string }>;
    expect(services.map((s) => s.name)).toContain("HU-58 Service");
  });

  // AC-3: the suite still runs against the `e2e` Spring profile (in-memory H2, real email
  // disabled) — same login/activation endpoints as dev/prod, no test-only auth backdoor.
  test("AC3: the demo tenant admin authenticates through the same real login endpoint the UI uses", async ({
    request,
  }) => {
    const res = await request.post(`${apiBaseUrl()}/api/auth/login`, {
      data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  });
});
