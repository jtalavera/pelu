import { expect, test } from "@playwright/test";
import { loginAsPlatformAdmin, PLATFORM_ADMIN_EMAIL } from "../fixtures/auth";
import { apiBaseUrl, authHeaders, decodeJwtPayload, loginPlatformAdminApi } from "../fixtures/api";

// HU-57 · Bootstrap inicial: crear únicamente el primer Platform Admin
// requirements/multi-tenant/HU-57-bootstrap-inicial-de-platform-admin.md
//
// HU-57 has no UI screen of its own — it is a boot-time backend mechanism
// (PlatformAdminBootstrap). What IS UI/API-observable, and covered here, is its *effect*: e2e
// always boots against a fresh, empty H2 database (application-e2e.properties, ddl-auto=create-drop),
// so the mere fact that PLATFORM_ADMIN_EMAIL/PASSWORD (application-e2e.properties'
// app.femme.platform-admin.*) can log in at all — through both the API and the real login screen —
// is only possible because the bootstrap created that user on this run's boot with zero
// PLATFORM_ADMIN rows beforehand (AC-1), and that the resulting identity is a genuine, tenant-independent
// PLATFORM_ADMIN (AC-1/AC-2's "no tenant" shape, already asserted in depth by
// hu-34-rol-platform-admin.spec.ts's JWT/role checks — not duplicated here).
//
// The remaining ACs are boot-sequence-only, with no independent UI/API surface beyond "does the
// bootstrapped admin work":
//  - AC-2 (bootstrap creates no tenant/ADMIN/PROFESSIONAL/services/clients/professionals) and
//    AC-3 (idempotence across repeated boots / a pre-existing admin) require inspecting database
//    state across multiple isolated boot cycles, which Playwright's single shared backend process
//    cannot exercise — covered instead by
//    src/backend/src/test/java/com/cursorpoc/backend/bootstrap/PlatformAdminBootstrapTest.java.
//  - AC-4 ("camino único", no parallel seed path) is a static code-structure property (only
//    PlatformAdminBootstrap ever creates a PLATFORM_ADMIN at boot; every other entity is created
//    exclusively via platform UI/API, already covered end-to-end by the HU-37..HU-55 specs) with
//    no independent runtime assertion beyond what those specs already prove.
//  - AC-5 (env vars documented in README.md) is a documentation-existence criterion with no
//    automatable runtime behavior.

test.describe("HU-57 · Bootstrap inicial de Platform Admin", () => {
  test("AC-1: the bootstrapped Platform Admin can log in via the API and receives a tenant-independent token", async ({
    request,
  }) => {
    const token = await loginPlatformAdminApi(request);
    const payload = decodeJwtPayload(token);
    expect(payload.role).toBe("PLATFORM_ADMIN");
    expect(payload.tid).toBeUndefined();

    // Sanity: the token is actually usable against a real platform-only endpoint, proving this
    // is a real, working PLATFORM_ADMIN identity created by the boot-time bootstrap — not just a
    // syntactically valid JWT.
    const res = await request.get(`${apiBaseUrl()}/api/platform/tenants`, {
      headers: authHeaders(token),
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  });

  test("AC-1: the bootstrapped Platform Admin can log in through the real login screen and reach the platform panel", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await expect(page).toHaveURL(/\/platform/);
  });

  test("AC-1: the bootstrapped Platform Admin is a real, password-protected account (wrong password is rejected)", async ({
    request,
  }) => {
    // Proves the bootstrap actually hashed/stored a real credential (PasswordEncoder), not an
    // open or placeholder account — a wrong password against the real bootstrapped email must
    // still fail like any other login.
    const res = await request.post(`${apiBaseUrl()}/api/auth/login`, {
      data: { email: PLATFORM_ADMIN_EMAIL, password: "definitely-the-wrong-password" },
    });
    expect(res.status()).toBe(401);
  });
});
