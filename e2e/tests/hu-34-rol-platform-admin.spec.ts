import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  apiBaseUrl,
  authHeaders,
  decodeJwtPayload,
  loginAsDemoApi,
  loginPlatformAdminApi,
  loginSystemAdminApi,
} from "../fixtures/api";

// HU-34 · Definir rol Platform Admin tenant-independiente
// requirements/multi-tenant/HU-34-rol-platform-admin-tenant-independiente.md
//
// This is API-only coverage (Playwright `request` fixture, no browser/UI) on purpose: HU-34 is
// pure identity/auth plumbing (role, JWT shape, endpoint gating) with no UI surface of its own —
// login *routing* by role is a separate story (HU-35), out of scope here per the HU's own "Notas
// para estimación y pruebas". The seeded platform-admin@pelu user (FemmeDataInitializer, gated by
// femme.data-init.enabled=true, same as root@pelu SYS_ADMIN) exists specifically to make this
// story's login/JWT/gating behavior exercisable end-to-end against the real backend.

// Mirrors application-e2e.properties' app.femme.jwt.secret exactly — used only to forge a
// deliberately-invalid (tid-less, non-platform-admin) token for AC-4's "any other role" case,
// which cannot be produced through any real login flow (the backend never mints such a token).
const E2E_JWT_SECRET = "e2e-jwt-secret-min-32-characters-long!!";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Forges a syntactically-valid, correctly-signed HS256 JWT with an arbitrary payload. */
function forgeHs256Jwt(payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", E2E_JWT_SECRET).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

test.describe("HU-34 · Rol Platform Admin tenant-independiente", () => {
  // AC-1 (rol dedicado) + AC-3 (JWT sin tid): login mints a token whose role is PLATFORM_ADMIN,
  // distinct from SYSTEM_ADMIN/ADMIN/PROFESSIONAL, and which carries no `tid` claim at all.
  test("AC1+AC3: Platform Admin login returns a JWT with role PLATFORM_ADMIN and no tid claim", async ({
    request,
  }) => {
    const token = await loginPlatformAdminApi(request);
    const claims = decodeJwtPayload(token);

    expect(claims.role).toBe("PLATFORM_ADMIN");
    expect(claims).not.toHaveProperty("tid");
  });

  // AC-1: PLATFORM_ADMIN is a distinct role from the legacy SYSTEM_ADMIN — same login endpoint,
  // different role claim, and (unlike Platform Admin) SYSTEM_ADMIN's token still carries a tid
  // (HU-36, not this story, migrates SYSTEM_ADMIN to the new tenant-independent model).
  test("AC1: SYSTEM_ADMIN remains a distinct, tenant-bound role after HU-34", async ({ request }) => {
    const token = await loginSystemAdminApi(request);
    const claims = decodeJwtPayload(token);

    expect(claims.role).toBe("SYSTEM_ADMIN");
    expect(claims).toHaveProperty("tid");
  });

  // AC-3: the backend accepts a tid-less Platform Admin token as valid specifically on the new
  // explicit platform route (/api/platform/me).
  test("AC3: a tid-less Platform Admin token is accepted on an explicit platform route", async ({
    request,
  }) => {
    const token = await loginPlatformAdminApi(request);

    const res = await request.get(`${apiBaseUrl()}/api/platform/me`, {
      headers: authHeaders(token),
    });

    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as { email: string; role: string };
    expect(body.role).toBe("PLATFORM_ADMIN");
    expect(body.email).toBe("platform-admin@pelu");
  });

  // AC-4 + AC-5: existing tenant-scoped endpoints keep rejecting a token without tid — including
  // the Platform Admin's own token — exactly as they rejected any tid-less (or missing/garbage)
  // token before HU-34: Spring Security's anyRequest().authenticated(), with no authentication in
  // the SecurityContext, denies with 403 (its default for an anonymous request — the same status
  // a request with no Authorization header at all gets, verified unchanged by this story).
  // AC-5 in particular: Platform Admin cannot reach tenant business data through these routes,
  // not even as a "bypass" — the request never reaches any controller (and therefore never any
  // per-tenant authorization logic) in the first place.
  // NOTE: /api/me is deliberately NOT in this list — HU-35 wires platform-admin support into it
  // (generic "who am I" identity, not tenant business data); see hu-35-mt-login-unificado.spec.ts.
  for (const path of ["/api/clients", "/api/professionals", "/api/services"]) {
    test(`AC4+AC5: Platform Admin token is rejected (403) on tenant-scoped route ${path}`, async ({
      request,
    }) => {
      const token = await loginPlatformAdminApi(request);

      const res = await request.get(`${apiBaseUrl()}${path}`, {
        headers: authHeaders(token),
      });

      expect(res.status()).toBe(403);
    });
  }

  // AC-4: the same rejection applies to *any* role's token, not just PLATFORM_ADMIN's — a
  // tid-less token is never valid on a tenant-scoped route regardless of who it claims to be.
  // No real login flow can produce such a token for a non-platform-admin role (AuthService always
  // attaches a tenant for ADMIN/PROFESSIONAL/SYSTEM_ADMIN), so this forges one directly with the
  // e2e environment's known JWT secret to exercise JwtAuthenticationFilter's gate in isolation.
  test("AC4: a forged tid-less token for a non-platform role is also rejected on a tenant-scoped route", async ({
    request,
  }) => {
    const now = Math.floor(Date.now() / 1000);
    const forged = forgeHs256Jwt({
      sub: "999999",
      email: "forged-admin@e2e.test",
      role: "ADMIN",
      iat: now,
      exp: now + 3600,
      // deliberately no `tid` claim
    });

    const res = await request.get(`${apiBaseUrl()}/api/clients`, {
      headers: authHeaders(forged),
    });

    expect(res.status()).toBe(403);
  });

  // Regression guard: a normal tenant-bound login still works exactly as before HU-34 on a
  // tenant-scoped route (proves AC-4's "no existing endpoint changes behavior" the other way).
  test("Regression: a normal tenant-bound login still succeeds on a tenant-scoped route", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);

    const res = await request.get(`${apiBaseUrl()}/api/clients`, {
      headers: authHeaders(token),
    });

    expect(res.ok(), await res.text()).toBeTruthy();
  });

  // AC-5: a normal tenant-bound token, conversely, cannot reach the new platform-only route.
  test("AC5: a normal tenant-bound token cannot reach the platform-only route", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);

    const res = await request.get(`${apiBaseUrl()}/api/platform/me`, {
      headers: authHeaders(token),
    });

    expect(res.status()).toBe(403);
  });
});
