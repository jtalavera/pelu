# Multi-tenant isolation E2E suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a focused Playwright suite that provisions three deliberately-divergent tenants and proves the critical business workflows stay correct and isolated when multiple tenants coexist in one database.

**Architecture:** A standalone Playwright config (`e2e/playwright.mt-isolation.config.ts`) with its own `webServer` block starting Spring Boot on `:8081` and Vite on `:5174` (both on the `e2e` profile, fresh in-memory H2). A dedicated `global-setup.mt.ts` provisions the three-tenant world once via the real Platform Admin API. Six new spec files under `e2e/tests/mt-isolation/` drive each workflow through the UI as one tenant, then API-cross-probe as another that nothing bled across. The existing 585-spec suite is untouched except for a one-line `testIgnore` guard.

**Tech Stack:** Playwright `@playwright/test` ^1.51, TypeScript, Node 20; backend Spring Boot 4 / Java 21 on the `e2e` profile; GitHub Actions for CI.

**Spec:** `docs/superpowers/specs/2026-09-07-multi-tenant-isolation-e2e-design.md`

## Global Constraints

- **Node 20 only** — `engine-strict=true`; `npm ci` fails on Node ≠ 20. Always `npm`, never yarn/pnpm.
- **Backend profile is `e2e`** — fresh in-memory H2 (JPA `create-drop`), email disabled (`app.femme.email.enabled=false`). Never run this suite against a dev/default-profile backend.
- **`workers: 1`** for this suite. Concurrency in tests is *within* a test via `Promise.all` on separate `request.newContext()` instances — never via parallel Playwright workers.
- **Ports:** mt backend `:8081`, mt Vite `:5174`. Must not collide with a normal dev stack on `:8080` / `:5173`.
- **Every assertion is "contains / excludes *this specific seeded id or number*"** — never an absolute count or "exactly N total". The three base tenants accumulate rows over a run.
- **A failing isolation assertion is a suspected product bug.** Stop, report it (like the `DashboardService` `NonUniqueObjectException` found on this branch — see `project-multi-tenant-dashboard-nonunique-bug`), and do NOT weaken the assertion to make it pass. Only adjust an assertion when you have confirmed it was wrong about intended behavior.
- **Config mutations restore state.** Only `mt-platform-config.spec.ts` and `mt-auth.spec.ts` #4 change tenant-level config (flags / tier / status); each such scenario restores the original state in a `try/finally`.
- **Money-format rule:** any assertion on a money amount in the UI must confirm dot-separator thousands, no decimals (e.g. `150.000`, `Gs. 150.000`).
- **All new user-visible strings:** N/A — this task adds no product UI, only tests. Test copy asserts the existing `en` locale strings (the suite forces `localStorage` `cursor_poc.i18n.language = "en"`, same as `markToursSeenScript`).
- **Login tenant resolution (verified in `AuthService.java:96-152`):** credentials-first. With no custom domain matching the Origin (the `localhost` case), `candidateUsersForLogin` returns every tenant the email exists in, filtered by password + `enabled` + tenant `ACTIVE` to a unique match. A distinct-email tenant admin logs in fine and its JWT carries that tenant's `tid`. `TENANT_AMBIGUOUS` fires only when the same email+password is valid in 2+ active tenants.

---

## File Structure

| File | Responsibility |
|---|---|
| `e2e/playwright.mt-isolation.config.ts` | Standalone Playwright config: own `webServer` (`:8081`/`:5174`), `testDir: ./tests/mt-isolation`, `globalSetup: ./global-setup.mt.ts`, `workers: 1`. |
| `e2e/playwright.config.ts` *(edit)* | Add `testIgnore: "mt-isolation/**"` so the main suite skips the new subdir. |
| `e2e/global-setup.mt.ts` | Provisions the 3-tenant world once via the Platform Admin API; writes the world handle to a JSON file. Idempotent on backend reuse. |
| `e2e/fixtures/mt/world.ts` | `provisionMtWorld()` (used by global-setup) + `getMtWorld()` (used by specs) + `MtTenant` / `MtWorld` types + per-tenant `token()` / `apiContext()` helpers. |
| `e2e/fixtures/mt/probe.ts` | Cross-tenant assertion helpers: `expectScopedList`, `expectCrossTenantForbidden`, `snapshotTenant`, `expectUnchanged`, `expectMoneyFormat`. |
| `e2e/fixtures/mt/concurrent.ts` | `raceAcrossTenants(worldA, worldB, fn)` — runs `fn` for two tenants via `Promise.all` on separate request contexts. |
| `e2e/tests/mt-isolation/mt-auth.spec.ts` | Identity & routing isolation (6 scenarios). |
| `e2e/tests/mt-isolation/mt-turnos.spec.ts` | Calendar & appointments isolation (4). |
| `e2e/tests/mt-isolation/mt-caja-comprobantes.spec.ts` | Cash session & receipts isolation (5 + 1 concurrency). |
| `e2e/tests/mt-isolation/mt-ficha-propinas.spec.ts` | Service sheet & tips isolation (4 + 1 concurrency). |
| `e2e/tests/mt-isolation/mt-sifen.spec.ts` | Electronic invoicing / config divergence (5 + 1 concurrency). |
| `e2e/tests/mt-isolation/mt-platform-config.spec.ts` | Runtime config changes stay tenant-scoped (3). |
| `e2e/package.json` *(edit)* | Add `test:mt` / `test:mt:headed` scripts. |
| `.github/workflows/e2e-mt-isolation.yml` | CI job: PR + push to develop/main + manual dispatch. |
| `CLAUDE.md` *(edit)* | Document `npm run test:mt` under the E2E section. |

---

## Task 1: Standalone Playwright config + guard on the existing config

**Files:**
- Create: `e2e/playwright.mt-isolation.config.ts`
- Modify: `e2e/playwright.config.ts` (add one property)
- Create: `e2e/tests/mt-isolation/_smoke.spec.ts` (temporary, deleted in Task 2)

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable config invoked as `npx playwright test --config playwright.mt-isolation.config.ts`. Env contract for later tasks: backend at `http://127.0.0.1:8081`, frontend at `http://localhost:5174`, `MT_API_BASE` / `MT_BASE_URL` env vars set for specs and global-setup.

- [ ] **Step 1: Add the guard to the existing config**

In `e2e/playwright.config.ts`, find the `defineConfig({` call and its `testDir: "./tests",` line. Add `testIgnore` immediately after it:

```ts
  testDir: "./tests",
  // The mt-isolation suite runs from its own config (playwright.mt-isolation.config.ts)
  // against a second backend on :8081 — exclude it from the main suite's discovery.
  testIgnore: "mt-isolation/**",
```

- [ ] **Step 2: Write the mt-isolation config**

Create `e2e/playwright.mt-isolation.config.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "../src/frontend");
const backendDir = path.resolve(__dirname, "../src/backend");

/** Dedicated ports so a normal dev stack on :8080 / :5173 can run alongside this suite. */
const MT_BACKEND_PORT = 8081;
const MT_FRONTEND_PORT = 5174;
const MT_API_BASE = `http://127.0.0.1:${MT_BACKEND_PORT}`;
const MT_BASE_URL = `http://localhost:${MT_FRONTEND_PORT}`;

process.env.MT_API_BASE = MT_API_BASE;
process.env.MT_BASE_URL = MT_BASE_URL;

const videoMode =
  (process.env.E2E_VIDEO as "on" | "retain-on-failure" | "off" | undefined) ??
  (process.env.CI ? "retain-on-failure" : "on");

const viteServer = {
  command: `npm run dev -- --port ${MT_FRONTEND_PORT}`,
  cwd: frontendDir,
  url: MT_BASE_URL,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
  env: {
    ...process.env,
    VITE_API_BASE_URL: MT_API_BASE,
    VITE_PLAYWRIGHT: "1",
  },
} as const;

const backendServer = {
  command: "./gradlew --no-daemon bootRun",
  cwd: backendDir,
  url: `${MT_API_BASE}/health`,
  reuseExistingServer: !process.env.CI,
  timeout: 240_000,
  env: {
    ...process.env,
    SPRING_PROFILES_ACTIVE: "e2e",
    SERVER_PORT: String(MT_BACKEND_PORT),
  },
} as const;

export default defineConfig({
  testDir: "./tests/mt-isolation",
  globalSetup: "./global-setup.mt.ts",
  outputDir: path.join(__dirname, "test-results-mt"),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(__dirname, "playwright-report-mt") }],
  ],
  use: {
    baseURL: MT_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: videoMode,
    locale: "en-US",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [viteServer, backendServer],
});
```

- [ ] **Step 3: Verify the backend honours `SERVER_PORT`**

Run: `grep -rn "server.port\|SERVER_PORT" src/backend/src/main/resources/`
Expected: either `application-e2e.properties` has no `server.port` override (Spring Boot's relaxed binding maps `SERVER_PORT` → `server.port` automatically → PASS), OR it pins `server.port=8080`. If it pins it, add `server.port=${SERVER_PORT:8080}` handling: instead set the env var name the file expects, or pass `--args='--server.port=8081'` on the gradle command. Adjust `backendServer.command`/`env` accordingly and note it here.

- [ ] **Step 4: Write a temporary smoke spec**

Create `e2e/tests/mt-isolation/_smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("mt-isolation harness boots its own backend on :8081", async ({ request }) => {
  const res = await request.get(`${process.env.MT_API_BASE}/health`);
  expect(res.ok()).toBeTruthy();
});
```

- [ ] **Step 5: Run the smoke spec**

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts`
Expected: both servers start (watch for `:8081` Spring Boot boot log and `:5174` Vite), the one test PASSES. First run downloads nothing if `npx playwright install` was already done; if it complains about browsers run `npx playwright install chromium` first.

- [ ] **Step 6: Verify the main suite still ignores the new dir**

Run: `cd e2e && npx playwright test --list | grep -c mt-isolation`
Expected: `0` (the main config does not discover the new specs).

- [ ] **Step 7: Commit**

```bash
git add e2e/playwright.mt-isolation.config.ts e2e/playwright.config.ts e2e/tests/mt-isolation/_smoke.spec.ts
git commit -m "test(e2e): standalone mt-isolation Playwright config + second backend"
```

---

## Task 2: The three-tenant fixture world

**Files:**
- Create: `e2e/fixtures/mt/world.ts`
- Create: `e2e/global-setup.mt.ts`
- Delete: `e2e/tests/mt-isolation/_smoke.spec.ts`
- Create: `e2e/tests/mt-isolation/mt-world.spec.ts`

**Interfaces:**
- Consumes: `MT_API_BASE` env var (Task 1). Platform Admin credentials from `e2e/fixtures/auth.ts` (`PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`).
- Produces:
  - Type `MtTenant = { key: "A" | "B" | "C"; id: number; name: string; adminEmail: string; adminPassword: string; tierId: number; sifenEnabled: boolean; catalog: { categoryIds: number[]; serviceIds: number[]; serviceNames: string[] }; professionalIds: number[]; professionalPins: string[]; clientIds: number[] }`
  - Type `MtWorld = { tenantA: MtTenant; tenantB: MtTenant; tenantC: MtTenant; sharedAmbiguousEmail: string; sharedAmbiguousPassword: string }`
  - `async function provisionMtWorld(): Promise<MtWorld>` — idempotent; called by global-setup.
  - `function getMtWorld(): MtWorld` — synchronous; reads the JSON handle `e2e/.mt-world.json`. Throws if missing.
  - `async function mtLoginToken(request: APIRequestContext, t: MtTenant): Promise<string>` — POST `/api/auth/login` with the tenant admin creds, returns `accessToken`.
  - `async function mtPlatformToken(request: APIRequestContext): Promise<string>` — platform admin login token.
  - `const MT_WORLD_FILE` — absolute path to `e2e/.mt-world.json`.

- [ ] **Step 1: Write `mt-world.spec.ts` (the failing test)**

Create `e2e/tests/mt-isolation/mt-world.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { decodeJwtPayload } from "../../fixtures/api";
import { getMtWorld, mtLoginToken } from "../../fixtures/mt/world";

test.describe("mt world provisioning", () => {
  const world = getMtWorld();

  test("three tenants exist with distinct ids and divergent SIFEN config", () => {
    const ids = [world.tenantA.id, world.tenantB.id, world.tenantC.id];
    expect(new Set(ids).size).toBe(3);
    expect(world.tenantA.sifenEnabled).toBe(true);
    expect(world.tenantB.sifenEnabled).toBe(false);
  });

  test("A and B admins log in and their JWT tid matches their own tenant", async ({ request }) => {
    for (const t of [world.tenantA, world.tenantB]) {
      const token = await mtLoginToken(request, t);
      const payload = decodeJwtPayload(token);
      expect(Number(payload.tid)).toBe(t.id);
    }
  });

  test("C is suspended: its admin cannot log in", async ({ request }) => {
    const res = await request.post(`${process.env.MT_API_BASE}/api/auth/login`, {
      data: { email: world.tenantC.adminEmail, password: world.tenantC.adminPassword },
    });
    expect(res.status()).toBe(401);
  });

  test("B has at least two service names deliberately shared with A", () => {
    const shared = world.tenantB.catalog.serviceNames.filter((n) =>
      world.tenantA.catalog.serviceNames.includes(n),
    );
    expect(shared.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts mt-world`
Expected: FAIL — `Cannot find module '../../fixtures/mt/world'` (and global-setup not yet written).

- [ ] **Step 3: Write `fixtures/mt/world.ts`**

Create `e2e/fixtures/mt/world.ts`. Use the Platform Admin API flow exactly as `e2e/global-setup.ts` and `e2e/tests/hu-41-crear-usuario-admin-de-tenant.spec.ts` do:
- `GET /api/platform/tenants/tiers` → pick tier by index (need two distinct tiers; if only one seeded tier exists, `POST /api/platform/tiers { name }` to create a second — see `hu-47` `createTierViaApi`).
- For T-A's tier: `PUT /api/platform/tiers/{tierId}/feature-flags/SIFEN_ELECTRONIC_INVOICING { included: true }` (see `hu-47` `setTierFlagIncluded` — confirm the exact body key by reading `hu-47-resolucion-de-flags-en-tres-niveles.spec.ts` lines 55-70).
- `POST /api/platform/tenants { name, domain: null, tierId }` → tenant id.
- `POST /api/platform/tenants/{id}/admins { email }` → `{ rawToken }`.
- `POST /api/auth/activate { token: rawToken, password, confirmPassword }`.
- Then log in as that tenant admin and seed its catalog/clients/professionals via the tenant-scoped helpers in `e2e/fixtures/api.ts`:
  - `seedCategoryServiceProfessional(request, token)` (returns one category + service + professional) — call as many times as needed for counts, OR call `/api/service-categories`, `/api/services`, `/api/professionals`, `/api/clients` directly via `apiPostJson` for precise control of names.
  - For T-B, create two services whose `name` is copied from two of T-A's `serviceNames`.
  - Business profile: `PUT /api/business-profile { businessName, ruc: "80000005-6", address: null, phone: null, contactEmail: null, logoDataUrl: null }` for A and B (RUC value from `hu-14`).
  - T-A fiscal stamp: `ensureActiveFiscalStampForInvoices(request, tokenA)` from `fixtures/api.ts`.
  - Professional PINs: read `e2e/tests/hu-22-asignar-pin-a-profesional.spec.ts` for the exact endpoint (`PUT /api/professionals/{id}/pin` or similar) — set a known 4-digit PIN per professional.
- T-C: create it active, create + activate its admin, seed 1 service + 1 professional + 1 client, then `PATCH /api/platform/tenants/{id}/status { status: "SUSPENDED" }` (body shape from `hu-40` line 54-58).
- Shared-ambiguous identity: after A and B exist, `POST /api/platform/tenants/{A.id}/admins { email: sharedAmbiguousEmail }` and the same for B, then activate BOTH with the SAME `sharedAmbiguousPassword`. This is the `TENANT_AMBIGUOUS` fixture.

Idempotency: at the top of `provisionMtWorld`, try to log in as `mt-aurora-admin@e2e.local`. If it succeeds, read back tenant ids by listing `GET /api/platform/tenants` (filter by the known names), re-derive catalog ids from the tenant-scoped list endpoints, write the JSON handle, and return without re-creating. If it fails with 401, do the full provisioning.

Constants:

```ts
const MT = {
  A: { name: "MT Salón Aurora", adminEmail: "mt-aurora-admin@e2e.local", adminPassword: "MtAurora1!" },
  B: { name: "MT Barbería Boreal", adminEmail: "mt-boreal-admin@e2e.local", adminPassword: "MtBoreal1!" },
  C: { name: "MT Ceval Suspendido", adminEmail: "mt-ceval-admin@e2e.local", adminPassword: "MtCeval1!" },
  sharedAmbiguousEmail: "mt-shared@e2e.local",
  sharedAmbiguousPassword: "MtShared1!",
} as const;
```

`getMtWorld()` reads `JSON.parse(fs.readFileSync(MT_WORLD_FILE, "utf-8"))`. `MT_WORLD_FILE = path.resolve(<e2e dir>, ".mt-world.json")`.

- [ ] **Step 4: Write `global-setup.mt.ts`**

```ts
import { writeFileSync } from "node:fs";
import { MT_WORLD_FILE, provisionMtWorld } from "./fixtures/mt/world";

export default async function globalSetupMt(): Promise<void> {
  const world = await provisionMtWorld();
  writeFileSync(MT_WORLD_FILE, JSON.stringify(world, null, 2), "utf-8");
  // eslint-disable-next-line no-console
  console.log(
    `[global-setup.mt] world ready — A=${world.tenantA.id} B=${world.tenantB.id} C=${world.tenantC.id}`,
  );
}
```

- [ ] **Step 5: Add `.mt-world.json` to gitignore**

Run: `grep -q "^.mt-world.json" e2e/.gitignore || echo ".mt-world.json" >> e2e/.gitignore`

- [ ] **Step 6: Delete the temporary smoke spec**

Run: `rm e2e/tests/mt-isolation/_smoke.spec.ts`

- [ ] **Step 7: Run `mt-world.spec.ts` — expect PASS**

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts mt-world`
Expected: 4 tests PASS. If provisioning throws, read the error — a 409 on tenant name means a stale `.mt-world.json` / reused backend without matching state; `rm e2e/.mt-world.json` and restart the mt backend, or fix the idempotency branch.

- [ ] **Step 8: Commit**

```bash
git add e2e/fixtures/mt/world.ts e2e/global-setup.mt.ts e2e/tests/mt-isolation/mt-world.spec.ts e2e/.gitignore
git rm e2e/tests/mt-isolation/_smoke.spec.ts
git commit -m "test(e2e): provision the three-tenant mt-isolation world"
```

---

## Task 3: Cross-tenant probe & concurrency helpers

**Files:**
- Create: `e2e/fixtures/mt/probe.ts`
- Create: `e2e/fixtures/mt/concurrent.ts`
- Create: `e2e/tests/mt-isolation/mt-helpers.spec.ts` (self-test of the helpers)

**Interfaces:**
- Consumes: `getMtWorld`, `mtLoginToken` (Task 2); `authHeaders`, `apiGetJson` from `e2e/fixtures/api.ts`.
- Produces:
  - `async function expectScopedList(request, token, path, opts: { includesIds: number[]; excludesIds: number[]; idField?: string }): Promise<unknown[]>` — GETs `path`, asserts the returned array contains every `includesIds` and none of `excludesIds` (matching `item[idField ?? "id"]`), returns the parsed array. Handles both bare arrays and `{ content: [...] }` paged bodies.
  - `async function expectCrossTenantForbidden(request, token, path): Promise<void>` — GET `path`; assert status is 403 or 404; fail loudly on 200 or 5xx with the body text.
  - `async function snapshotTenant(request, token): Promise<TenantSnapshot>` where `TenantSnapshot = { invoiceIds: number[]; lastInvoiceNumber: string | null; appointmentIds: number[]; tipReportTotalMinor: number; serviceRecordIds: number[]; cashSessionOpen: boolean }`.
  - `function expectUnchanged(before: TenantSnapshot, after: TenantSnapshot): void` — deep-equal assertion with a readable diff message.
  - `function expectMoneyFormat(text: string): void` — asserts `text` matches `/\d{1,3}(\.\d{3})*(?!\d)/` and contains no `,` decimal and no trailing `,dd`.
  - `async function raceAcrossTenants<T>(fnA: () => Promise<T>, fnB: () => Promise<T>): Promise<[PromiseSettledResult<T>, PromiseSettledResult<T>]>` — `Promise.allSettled([fnA(), fnB()])`.

- [ ] **Step 1: Write `mt-helpers.spec.ts` (failing test)**

```ts
import { expect, test, request as pwRequest } from "@playwright/test";
import { getMtWorld, mtLoginToken } from "../../fixtures/mt/world";
import {
  expectCrossTenantForbidden,
  expectMoneyFormat,
  expectScopedList,
  snapshotTenant,
} from "../../fixtures/mt/probe";
import { raceAcrossTenants } from "../../fixtures/mt/concurrent";

const world = getMtWorld();

test("expectScopedList sees A's own professionals and not B's", async ({ request }) => {
  const tokenA = await mtLoginToken(request, world.tenantA);
  await expectScopedList(request, tokenA, "/api/professionals", {
    includesIds: world.tenantA.professionalIds,
    excludesIds: world.tenantB.professionalIds,
  });
});

test("expectCrossTenantForbidden: B token cannot read an A professional by id", async ({ request }) => {
  const tokenB = await mtLoginToken(request, world.tenantB);
  await expectCrossTenantForbidden(
    request,
    tokenB,
    `/api/professionals/${world.tenantA.professionalIds[0]}`,
  );
});

test("snapshotTenant + raceAcrossTenants run without cross-contamination", async ({ request }) => {
  const [tokenA, tokenB] = [
    await mtLoginToken(request, world.tenantA),
    await mtLoginToken(request, world.tenantB),
  ];
  const [snapA, snapB] = await raceAcrossTenants(
    () => snapshotTenant(request, tokenA),
    () => snapshotTenant(request, tokenB),
  );
  expect(snapA.status).toBe("fulfilled");
  expect(snapB.status).toBe("fulfilled");
});

test("expectMoneyFormat accepts 150.000 and rejects 150000.00", () => {
  expectMoneyFormat("Gs. 150.000");
  expect(() => expectMoneyFormat("150000.00")).toThrow();
});
```

- [ ] **Step 2: Run it — expect failure** (`Cannot find module`).

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts mt-helpers`

- [ ] **Step 3: Implement `probe.ts`**

Write each function per the Interfaces block. For `snapshotTenant`, use:
- invoices: `GET /api/invoices?page=0&size=200` → `{ content: [...] }` (see `InvoiceController` `list`); collect `id` and the highest `numberFormatted`/`invoiceNumberFormatted` (confirm field name by reading `fixtures/invoice.ts` return + one `hu-16` assertion).
- appointments: `GET /api/appointments/history?page=0&size=200` (see `AppointmentController` `/history`).
- tips total: `GET /api/propinas/report` with a wide date range (`from` = 2000-01-01, `to` = 2100-01-01) — read `tests/issue-120-propinas.spec.ts` for the query param names and the total field.
- service records: `GET /api/service-records?page=0&size=200`.
- cash session: `GET /api/cash-sessions/current` → `cashSessionOpen = res.status() === 200`.

- [ ] **Step 4: Implement `concurrent.ts`** — one function, `Promise.allSettled`.

- [ ] **Step 5: Run `mt-helpers.spec.ts` — expect PASS**

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts mt-helpers`
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add e2e/fixtures/mt/probe.ts e2e/fixtures/mt/concurrent.ts e2e/tests/mt-isolation/mt-helpers.spec.ts
git commit -m "test(e2e): cross-tenant probe + concurrency helpers for mt-isolation"
```

---

## Task 4: `mt-auth.spec.ts` — identity & routing isolation

**Files:**
- Create: `e2e/tests/mt-isolation/mt-auth.spec.ts`

**Interfaces:**
- Consumes: `getMtWorld`, `mtLoginToken`, `mtPlatformToken` (Task 2); `expectCrossTenantForbidden` (Task 3); `decodeJwtPayload` from `fixtures/api.ts`; `loginAs`, `loginAsPlatformAdmin` from `fixtures/auth.ts`.
- Produces: nothing consumed by later tasks.

Each scenario is one `test(...)`. The file starts with `const world = getMtWorld();`.

### Scenario list (exact assertions)

1. **`AC: role-based landing + tenant name in header`**
   - `loginAsPlatformAdmin(page)` → asserts `/platform` + "Platform Admin" heading (the helper already does this).
   - New page context: `loginAs(page, world.tenantA.adminEmail, world.tenantA.adminPassword)` → `await expect(page).toHaveURL(/\/app/)`. Then assert the tenant name shows: `await expect(page.getByText(world.tenantA.name).first()).toBeVisible()` — first check where the name renders by reading `hu35-mt-login-unificado-enrutamiento-por-rol.spec.ts`; if the dashboard header uses a different element, match that. Repeat for T-B.

2. **`AC: JWT tid is per-tenant; platform admin has none`**
   - API only. `mtLoginToken` for A and B; `decodeJwtPayload(token).tid` equals `world.tenantA.id` / `world.tenantB.id`.
   - `mtPlatformToken(request)` → `decodeJwtPayload(token)` has no `tid` key: `expect(payload.tid).toBeUndefined()`.

3. **`AC: same email+password in two tenants → TENANT_AMBIGUOUS`**
   - API: `POST /api/auth/login { email: world.sharedAmbiguousEmail, password: world.sharedAmbiguousPassword }` → `expect(res.status()).toBe(401)` and `expect(await res.text()).toContain("TENANT_AMBIGUOUS")`.
   - UI: `page.goto("/login")`, fill the shared creds, click "Sign in", assert the login response is 401 and the page shows the ambiguous-account error copy. Find the exact `en.json` string for `TENANT_AMBIGUOUS` (`grep -n "TENANT_AMBIGUOUS\|more than one business" src/frontend/src/i18n/locales/en.json`) and assert it's visible. Assert the URL stays `/login`.

4. **`AC: suspended tenant blocks login; reactivation restores it`** — MUTATES T-C, restore in `finally`.
   - `POST /api/auth/login` for T-C admin → 401 (baseline; already true).
   - `const platformToken = await mtPlatformToken(request);`
   - `try { PATCH /api/platform/tenants/${world.tenantC.id}/status { status: "ACTIVE" }` → login for T-C admin now succeeds (`res.ok()`, body has `accessToken`); `decodeJwtPayload(token).tid === world.tenantC.id`. UI: `loginAs(page, C.adminEmail, C.adminPassword)` reaches `/app`. `} finally { PATCH .../status { status: "SUSPENDED" }` and assert the re-suspend response is ok. `}`
   - After `finally`, assert T-C login is 401 again.

5. **`AC: cross-area authorization is enforced both ways`**
   - `tokenA` (T-A admin) → `GET /api/platform/tenants` → `expect([401, 403]).toContain(res.status())`.
   - `platformToken` → `GET /api/appointments` (a tenant business endpoint) → `expect([400, 401, 403]).toContain(res.status())`. **Discovery step:** first run this one call and observe the actual status; if the platform admin token is somehow accepted with an ambient tenant, that is a finding — report it per the Global Constraints, do not just widen the matcher.

6. **`AC: forgot-password works for a non-oldest tenant's user`**
   - T-B is not the oldest tenant (the demo/bootstrap flows don't run in this suite, but A is created before B). `POST /api/auth/forgot-password { email: world.tenantB.adminEmail }` with no Origin header → `expect(res.status()).toBe(200)` (silent-success contract).
   - Confirm a token was actually issued: the platform-admin "trigger reset" path returns the raw token in e2e — but forgot-password does not. Instead assert the negative isn't happening: `POST /api/auth/forgot-password { email: "nobody-" + Date.now() + "@e2e.local" }` also returns 200 (anti-enumeration), so 200 alone is weak. Read `AuthService.forgotPassword` + `tests/hu-44-reenviar-invitacion-admin-de-tenant.spec.ts`: use the reset-token inspection endpoint HU-44 uses (`/api/platform/tenants/{id}/admins/{userId}/...` or a test-support hook) to assert a `PasswordResetToken` row now exists for T-B's admin and none was created for a T-A user. If no such inspection path exists, cover this at the API level by calling `POST /api/auth/reset-password` is not possible without the raw token — in that case document in a code comment that only the 200 + no-exception path is asserted, and assert additionally that `POST /api/auth/forgot-password` for T-B's admin does **not** throw/500 and that a subsequent login with the OLD password still works (token issuance must not disable the account).

- [ ] **Step 1: Write the file with all 6 scenarios.** Start with scenario 2 (pure API, no UI selectors) fully coded:

```ts
import { expect, test } from "@playwright/test";
import { decodeJwtPayload } from "../../fixtures/api";
import { getMtWorld, mtLoginToken, mtPlatformToken } from "../../fixtures/mt/world";

const world = getMtWorld();

test.describe("mt-auth · identity & routing isolation", () => {
  test("JWT tid is per-tenant; platform admin token has none", async ({ request }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    expect(Number(decodeJwtPayload(tokenA).tid)).toBe(world.tenantA.id);
    expect(Number(decodeJwtPayload(tokenB).tid)).toBe(world.tenantB.id);

    const platformToken = await mtPlatformToken(request);
    expect(decodeJwtPayload(platformToken).tid).toBeUndefined();
  });

  // ... remaining 5 scenarios
});
```

- [ ] **Step 2: Run the file, iterate scenario by scenario**

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts mt-auth`
Expected: some pass immediately (they assert existing correct behavior). For any failure: decide — real isolation/authz bug (STOP, report per Global Constraints) or a wrong selector/expected-string in the test (fix the test). Re-run until all 6 green.

- [ ] **Step 3: Confirm T-C is left suspended**

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts mt-world`
Expected: still 4 PASS (the "C is suspended" test proves scenario 4's `finally` restored it).

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/mt-isolation/mt-auth.spec.ts
git commit -m "test(e2e): mt-auth identity & routing isolation"
```

---

## Task 5: `mt-turnos.spec.ts` — calendar & appointment isolation

**Files:**
- Create: `e2e/tests/mt-isolation/mt-turnos.spec.ts`

**Interfaces:**
- Consumes: `getMtWorld`, `mtLoginToken` (Task 2); `expectScopedList`, `expectCrossTenantForbidden`, `snapshotTenant`, `expectUnchanged` (Task 3); `createAppointmentApi`, `calendarVisibleWeekSlotIso` from `fixtures/api.ts`; `loginAs` from `fixtures/auth.ts`; `bookingAppointmentDialog`, `pickSearchableOption`, `fillAppointmentDateIso`, `fillAppointmentTime`, `ensureCalendarShowsClientCard` from `fixtures/ui.ts`.
- Produces: nothing.

### Scenario list

1. **`UI book in A, verify absent + pickers scoped in B`**
   - As T-A admin (UI): open `/app/calendar`, book an appointment — client `world.tenantA.clientIds[0]`, professional `world.tenantA.professionalIds[0]`, service `world.tenantA.catalog.serviceIds[0]`, a slot from `calendarVisibleWeekSlotIso(10, 0)`. Use the dialog helpers. Capture the created appointment id from the POST `/api/appointments` response.
   - As T-B admin (UI, fresh context): open `/app/calendar`, navigate to the same week. Assert the A client's card is NOT present: `await expect(page.getByRole("button", { name: <A client name> })).toHaveCount(0)`.
   - Open the "New appointment" dialog as B; open the professional `SearchableSelect`; assert its listbox contains B's professional names and none of A's. Same for the service select — type the *shared* service name and assert the option that resolves belongs to B (intercept the eventual POST body's `serviceId` and assert `world.tenantB.catalog.serviceIds.includes(body.serviceId)`).

2. **`API cross-probe: appointment lists are tenant-scoped`**
   - Seed one appointment in A and one in B via `createAppointmentApi` (distinct slots).
   - `expectScopedList(request, tokenB, "/api/appointments/history?page=0&size=100", { includesIds: [bApptId], excludesIds: [aApptId], idField: "id" })` and the reverse for A.

3. **`Interleave: same slot in A and B both succeed`**
   - `const slot = calendarVisibleWeekSlotIso(14, 0);`
   - `createAppointmentApi(request, tokenA, { clientId: A.clientIds[0], professionalId: A.professionalIds[0], serviceId: A.catalog.serviceIds[0], startAt: slot })` → ok.
   - `createAppointmentApi(request, tokenB, { ...B ids..., startAt: slot })` → ok, different `id`. No `SLOT_TAKEN`/409.

4. **`Edit/cancel in A leaves B untouched`**
   - `const before = await snapshotTenant(request, tokenB);`
   - In A: create two appointments; `PUT /api/appointments/{id}` to reschedule the first (body shape from `tests/hu-09-editar-o-reagendar-turno.spec.ts`); `PATCH /api/appointments/{id}/status { status: "CANCELLED" }` on the second (status value from `tests/hu-08-cambiar-estado-de-un-turno.spec.ts`).
   - `const after = await snapshotTenant(request, tokenB);`
   - `expectUnchanged(before, after)`.

- [ ] **Step 1: Write the file.** Anchor scenario 3 fully coded (pure API):

```ts
import { expect, test } from "@playwright/test";
import { calendarVisibleWeekSlotIso, createAppointmentApi } from "../../fixtures/api";
import { getMtWorld, mtLoginToken } from "../../fixtures/mt/world";

const world = getMtWorld();

test.describe("mt-turnos · calendar isolation", () => {
  test("same calendar slot in A and B both succeed independently", async ({ request }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    const slot = calendarVisibleWeekSlotIso(14, 0);

    const a = await createAppointmentApi(request, tokenA, {
      clientId: world.tenantA.clientIds[0],
      professionalId: world.tenantA.professionalIds[0],
      serviceId: world.tenantA.catalog.serviceIds[0],
      startAt: slot,
    });
    const b = await createAppointmentApi(request, tokenB, {
      clientId: world.tenantB.clientIds[0],
      professionalId: world.tenantB.professionalIds[0],
      serviceId: world.tenantB.catalog.serviceIds[0],
      startAt: slot,
    });
    expect(a.id).not.toBe(b.id);
  });

  // ... scenarios 1, 2, 4
});
```

- [ ] **Step 2: Run + iterate**

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts mt-turnos`
Expected: iterate to 4 green. A failure in scenario 1/2 (B seeing A's rows) is a **product bug** — report, don't weaken.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/mt-isolation/mt-turnos.spec.ts
git commit -m "test(e2e): mt-turnos calendar & appointment isolation"
```

---

## Task 6: `mt-caja-comprobantes.spec.ts` — cash session & receipt isolation

**Files:**
- Create: `e2e/tests/mt-isolation/mt-caja-comprobantes.spec.ts`

**Interfaces:**
- Consumes: `getMtWorld`, `mtLoginToken` (Task 2); `snapshotTenant`, `expectUnchanged`, `expectScopedList`, `expectCrossTenantForbidden`, `expectMoneyFormat` (Task 3); `raceAcrossTenants` (Task 3); `ensureCashSessionOpenApi`, `apiPostJson`, `apiGetJson`, `authHeaders` from `fixtures/api.ts`; `loginAs` from `fixtures/auth.ts`; `pickServiceLine`, `clickIssueInvoiceAndExpectSuccess` from `fixtures/invoice.ts`.
- Produces: nothing.

**Invoice create body** (verified in `hu-14`):
```ts
{
  clientId: number | null,
  clientDisplayName: string | null,
  clientRucOverride: null,
  discountType: null,
  discountValue: null,
  lines: [{ serviceId: number | null, description: string, quantity: 1, unitPrice: number }],
  payments: [{ method: "CASH", amount: number }],
}
```
**Cash session:** `POST /api/cash-sessions/open { openingCashAmount }`, `POST /api/cash-sessions/close { countedCashAmount }`, `GET /api/cash-sessions/current` (200 = open, non-200 = closed).

### Scenario list

1. **`Independent cash sessions`**
   - Ensure both A and B carry NO open session at start: `GET /api/cash-sessions/current` for each; if open, close it.
   - Open A's session via `POST /api/cash-sessions/open { openingCashAmount: 100000 }`. Assert B's `GET /api/cash-sessions/current` is still non-200.
   - Open B's session `{ openingCashAmount: 250000 }`. Assert both are now 200 and the opening amounts in each body differ (A = 100000-minor-equivalent, B = 250000). Confirm minor/major units by reading the response body once.

2. **`Per-tenant invoice numbering`**
   - Ensure A & B sessions open, business profile + (A) stamp ready.
   - Emit in A via `POST /api/invoices` (cash, one line, `unitPrice: 50000`). Record `numberFormatted` (field name confirmed from `fixtures/invoice.ts` response).
   - Emit in B. Emit again in A.
   - Assert A's second number is A's-first + 1 in sequence, and B's number is independent of A's emissions (B's is not "A's first + 1"). Parse the numeric tail of `numberFormatted`.

3. **`Historial scoping + cross-probe forbidden`**
   - `expectScopedList(request, tokenA, "/api/invoices?page=0&size=100", { includesIds: [aInvId], excludesIds: [bInvId] })` (paged body → helper unwraps `content`). Reverse for B.
   - `expectCrossTenantForbidden(request, tokenB, "/api/invoices/" + aInvId)`.

4. **`Anular in A leaves B untouched`**
   - `const before = await snapshotTenant(request, tokenB);`
   - Emit an invoice in A, then `POST /api/invoices/{id}/void` (body from `hu-17-anular-comprobante.spec.ts`).
   - `const after = await snapshotTenant(request, tokenB);` → `expectUnchanged(before, after)`.

5. **`Close A's caja: B stays open, A totals exclude B`**
   - With both sessions open and one invoice emitted in each: `POST /api/cash-sessions/close { countedCashAmount: ... }` for A. Read the close response / summary — assert its sales total equals A's single invoice amount, not A+B. Assert B's `GET /api/cash-sessions/current` is still 200.
   - Re-open A's session afterward so later scenarios/specs aren't surprised (or leave closed — document which; snapshot rule means it doesn't matter for assertions, but `mt-ficha-propinas` invoice-from-ficha needs an open A session, so **re-open A**).

6. **`Concurrency: simultaneous emission in A and B`** (the +1)
   - Pre-open both sessions. `raceAcrossTenants(() => apiPostJson(request, tokenA, "/api/invoices", <A body>), () => apiPostJson(request, tokenB, "/api/invoices", <B body>))`.
   - Both settle `fulfilled` with distinct ids. Re-fetch each tenant's latest number; assert A's advanced by exactly 1 vs a pre-race snapshot and B's by exactly 1 vs its own — no collision, no lost update.

- [ ] **Step 1: Write the file.** Anchor scenario 2 fully coded (numbering — pure API). Include a `parseInvoiceNumber(formatted: string): number` local helper (`Number(formatted.split("-").at(-1))`).

- [ ] **Step 2: Run + iterate to 6 green.**

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts mt-caja`

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/mt-isolation/mt-caja-comprobantes.spec.ts
git commit -m "test(e2e): mt-caja-comprobantes cash session & receipt isolation"
```

---

## Task 7: `mt-ficha-propinas.spec.ts` — service sheet & tips isolation

**Files:**
- Create: `e2e/tests/mt-isolation/mt-ficha-propinas.spec.ts`

**Interfaces:**
- Consumes: `getMtWorld`, `mtLoginToken` (Task 2); `snapshotTenant`, `expectUnchanged`, `expectScopedList`, `expectCrossTenantForbidden`, `expectMoneyFormat`, `raceAcrossTenants` (Task 3); `apiPostJson`, `ensureCashSessionOpenApi` from `fixtures/api.ts`; `loginAs` from `fixtures/auth.ts`.
- Produces: nothing.

**Service record create body** (verified in `issue-53` / `issue-120`):
```ts
POST /api/service-records
{
  clientId: number,
  lines: [{ serviceId: number, professionalId: number, quantity: 1, unitPrice: number }],
  tips: [{ professionalId: number, amount: number }],
}
```
A ficha auto-closes when an invoice references it: `POST /api/invoices { ..., serviceRecordId: <recordId>, tipsAmount: <amount> }`. **Propinas only reports CLOSED-record tips** (see `issue-120` `seedClosedTip`).
Tips endpoints: `GET /api/propinas/report?from=&to=`, `GET /api/propinas/balance`, `POST /api/propinas/withdrawals { professionalId, amount, ... }`, `GET /api/propinas/withdrawals`. Confirm exact query/body params from `tests/issue-120-propinas.spec.ts` and `tests/issue-131-propinas-ajustes.spec.ts`.

### Scenario list

1. **`Ficha historial scoped + cross-probe forbidden`**
   - Create a ficha in A (`world.tenantA` ids) and one in B. `expectScopedList(request, tokenA, "/api/service-records?page=0&size=100", { includesIds: [aRecId], excludesIds: [bRecId] })`, reverse for B. `expectCrossTenantForbidden(request, tokenB, "/api/service-records/" + aRecId)`.
   - UI: as T-A admin, `/app/service-records`, click the row for the A ficha → detail opens. As T-B admin, `/app/service-records` → the A ficha's client name has count 0 in the list.

2. **`Propinas report is per-tenant + money format`**
   - `seedClosedTip`-style: create a ficha in A with `tips: [{ professionalId: A.professionalIds[0], amount: 30000 }]`, then invoice it with `serviceRecordId` + `tipsAmount: 30000` to close it. Do the same in B with `amount: 15000`.
   - `GET /api/propinas/report?from=<wide>&to=<wide>` as tokenA → contains a row for `A.professionalIds[0]` summing ≥ 30000; contains no B professional. Reverse for B (≥ 15000, no A professional).
   - UI (T-A, `/app/propinas`, "Tips report" tab): the professional's total renders with `expectMoneyFormat`.

3. **`Withdrawal in A leaves B's tip pool untouched`**
   - `const beforeB = await snapshotTenant(request, tokenB);` (includes `tipReportTotalMinor`).
   - In A: ensure a closed tip exists for `A.professionalIds[0]`; `GET /api/propinas/balance` → note A's withdrawable; `POST /api/propinas/withdrawals { professionalId: A.professionalIds[0], amount: <= balance }` → ok; A's balance drops by that amount.
   - `const afterB = await snapshotTenant(request, tokenB);` → `expectUnchanged(beforeB, afterB)`.

4. **`Invoice-from-ficha in A uses A's numbering`**
   - Ensure A's cash session open. Create a ficha in A, invoice it (`serviceRecordId`), record `numberFormatted`. Emit a second plain invoice in A. Assert the two A numbers are consecutive. Snapshot B before/after → unchanged.

5. **`Concurrency: simultaneous withdrawal in A and B`** (the +1)
   - Pre-seed a closed tip in each tenant for its professional. `raceAcrossTenants(() => POST A withdrawal, () => POST B withdrawal)`. Both `fulfilled`. Each tenant's post-race `GET /api/propinas/balance` reflects only its own withdrawal.

- [ ] **Step 1: Write the file.** Anchor scenario 1 fully coded (mix of API list scoping + one UI check). Add a local `createFicha(request, token, tenant, tip?)` helper.

- [ ] **Step 2: Run + iterate to 5 green.**

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts mt-ficha`

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/mt-isolation/mt-ficha-propinas.spec.ts
git commit -m "test(e2e): mt-ficha-propinas service sheet & tips isolation"
```

---

## Task 8: `mt-sifen.spec.ts` — electronic invoicing / config divergence

**Files:**
- Create: `e2e/tests/mt-isolation/mt-sifen.spec.ts`

**Interfaces:**
- Consumes: `getMtWorld`, `mtLoginToken`, `mtPlatformToken` (Task 2); `expectCrossTenantForbidden`, `snapshotTenant`, `expectUnchanged`, `raceAcrossTenants` (Task 3); `listFiscalStamps` from `fixtures/api.ts`; `loginAs` from `fixtures/auth.ts`.
- Produces: nothing.

**Discovery step required first** — read these before writing assertions:
- `src/backend/.../web/SifenInvoiceTestSupportController.java` — how `/api/admin/sifen-test-support/*` endpoints scope the tenant (header? demo-only? path?). `tests/sifen-hu-22-activacion-por-tenant.spec.ts` calls `certificates/clear` and `ensure-valid-certificate` with no auth — determine whether they act on a fixed tenant or all tenants. **If they only ever act on the demo/oldest tenant, T-A cannot get a real certificate in this suite** — in that case scenario 1's "A can emit via SIFEN" reduces to asserting the flag resolves enabled + the invoice POST returns `SIFEN_RECIPIENT_EMAIL_REQUIRED` when email is blank (proof the SIFEN branch is taken — see `InvoiceController.issue`), rather than a full KuDE. Document the chosen path in a file-level comment.
- `tests/sifen-hu-08-generar-comprobante-kude.spec.ts` — KuDE download flow and `/api/invoices/{id}/sifen/kude`.
- `tests/sifen-rt25-inutilizacion.spec.ts` — number-voiding register flow (`POST /api/sifen/number-voiding`).

### Scenario list

1. **`A takes the SIFEN branch; B does not`**
   - Flag resolution: `GET /api/feature-flags` as tokenA → `SIFEN_ELECTRONIC_INVOICING` enabled; as tokenB → disabled. (Field shape from `FeatureFlagController` `/api/feature-flags` — read it.)
   - A: `POST /api/invoices` with an identified client and **blank `email`** → expect 400 `SIFEN_RECIPIENT_EMAIL_REQUIRED` (proves the SIFEN branch; per `InvoiceController.issue`). With a valid email + valid certificate available → 201 and the response carries a `cdc` (non-null). If no certificate path exists for T-A (see discovery), assert the 400 case only and comment why.
   - B: `POST /api/invoices` with blank email → 201 (no SIFEN requirement); response `cdc` is null/absent. `POST /api/sifen/number-voiding` or `POST /api/invoices/{bInvId}/sifen/check-status` as tokenB → feature-disabled error (observe exact code, assert it).

2. **`Certificate & timbrado never cross tenants`**
   - `listFiscalStamps(request, tokenB)` → does NOT contain T-A's stamp id/number (`world` should record T-A's stamp number; if not, capture it in provisioning). `listFiscalStamps(request, tokenA)` → contains it.
   - `GET /api/sifen/certificates` as tokenB → array; assert no entry matches T-A's certificate identifier (if certificates exist in this suite at all — otherwise skip with a comment).

3. **`Numeración inutilizada is per-tenant`**
   - As tokenA: `POST /api/sifen/number-voiding { ... }` (body from `sifen-rt25`) → ok, record id.
   - `GET /api/sifen/number-voiding` as tokenB → paged; assert none of the entries is A's record id. As tokenA → contains it.
   - Only run this scenario if T-A actually has SIFEN usable; otherwise `test.skip` with a comment tied to the discovery finding.

4. **`Cross-probe forbidden on SIFEN endpoints`**
   - Emit an invoice in A (or use any A invoice id). `expectCrossTenantForbidden(request, tokenB, "/api/invoices/" + aInvId + "/sifen/kude")` — expect 403/404. Also `POST` variants: do a raw `request.post` for `/api/invoices/{aInvId}/sifen/check-status` with tokenB → assert 403/404.

5. **`A's stamp consumption is driven only by A`**
   - `const stampsBefore = await listFiscalStamps(request, tokenA);` capture the active stamp's `nextEmissionNumber`.
   - Emit N (=2) plain invoices in A. Emit invoices in B in between.
   - `const stampsAfter = await listFiscalStamps(request, tokenA);` → active stamp's `nextEmissionNumber` advanced by exactly N (not N + B's count).

6. **`Concurrency: simultaneous SIFEN status polls`** (the +1)
   - Need one invoice per tenant. `raceAcrossTenants(() => GET/POST A's sifen status, () => GET/POST B's)`. A's result reflects A's tenant state; B's reflects B's (B likely a feature-disabled error — that's fine, assert each side independently). No exception, no swapped tenant data.

- [ ] **Step 1: Do the discovery reads; write a file-level comment recording what SIFEN capability T-A actually has in this suite.**

- [ ] **Step 2: Write the file.** Anchor scenario 1's flag-resolution + B-branch part fully coded.

- [ ] **Step 3: Run + iterate.**

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts mt-sifen`
Expected: green, with any `test.skip`s clearly commented. A cross-tenant leak (B seeing A's stamp/cert/voiding) is a **product bug** — report.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/mt-isolation/mt-sifen.spec.ts
git commit -m "test(e2e): mt-sifen electronic-invoicing config divergence & isolation"
```

---

## Task 9: `mt-platform-config.spec.ts` — runtime config changes stay tenant-scoped

**Files:**
- Create: `e2e/tests/mt-isolation/mt-platform-config.spec.ts`

**Interfaces:**
- Consumes: `getMtWorld`, `mtLoginToken`, `mtPlatformToken` (Task 2); `snapshotTenant`, `expectUnchanged` (Task 3); `setTenantFeatureFlag` from `fixtures/api.ts`; `loginAs` from `fixtures/auth.ts`.
- Produces: nothing.

**Endpoints:**
- Per-tenant flag override: `PUT /api/admin/feature-flags/tenants/{tenantId}/{flagKey} { enabled: boolean }` (via `setTenantFeatureFlag`); `DELETE /api/admin/feature-flags/tenants/{tenantId}/{flagKey}` clears it.
- Global default: `PUT /api/admin/feature-flags/{flagKey} { enabled }` — **do not change global in this suite** (shared); only read it via `GET /api/admin/feature-flags`.
- Resolved per tenant: `GET /api/admin/feature-flags/tenants/{tenantId}` (see `hu-47` `readResolvedFlags`).
- Tenant tier: `PUT /api/platform/tenants/{id} { name, domain, tierId }` (from `hu-38`).
- Tenant status: `PATCH /api/platform/tenants/{id}/status { status }`.

### Scenario list (ALL mutate — every one wraps its changes in `try/finally` restore)

1. **`Per-tenant SIFEN override for A does not touch B or the global default`**
   - `const platformToken = await mtPlatformToken(request);`
   - Read `GET /api/admin/feature-flags` → capture the global `SIFEN_ELECTRONIC_INVOICING` `enabled` (call it `globalBefore`).
   - Read B's resolved `SIFEN_ELECTRONIC_INVOICING` (`bBefore`, should be false).
   - `try`: `setTenantFeatureFlag(request, world.tenantA.id, "SIFEN_ELECTRONIC_INVOICING", false)`. Then: A's resolved flag = false; B's resolved flag == `bBefore`; global `GET /api/admin/feature-flags` `SIFEN...` == `globalBefore`. Optionally UI: `loginAs` T-A admin, `/app/billing` → the SIFEN-specific affordance is gone (only if a clear DOM signal exists — otherwise skip UI).
   - `finally`: `DELETE /api/admin/feature-flags/tenants/{A.id}/SIFEN_ELECTRONIC_INVOICING` (restore to tier-driven enabled). Assert A's resolved flag is back to true.

2. **`Changing A's tier shifts A's resolved flags but not B's`**
   - Capture A's current `tierId` (`GET /api/platform/tenants` → find A) and B's resolved flag map.
   - Create a throwaway tier with no flags: `POST /api/platform/tiers { name: "MT throwaway " + Date.now() }`.
   - `try`: `PUT /api/platform/tenants/{A.id} { name: A.name, domain: null, tierId: throwaway.id }`. A's resolved `SIFEN_ELECTRONIC_INVOICING` now falls to the global default (no override, empty tier). B's resolved flag map == captured. 
   - `finally`: `PUT /api/platform/tenants/{A.id} { ..., tierId: <original A tierId> }`; assert A's SIFEN flag resolves true again. (Leave the throwaway tier; `DELETE /api/platform/tiers/{id}` if it has no tenants — optional.)

3. **`Suspending B mid-run blocks B only; A and C unaffected`** (pattern from `hu-40` audit test)
   - `const aToken = await mtLoginToken(request, world.tenantA);`
   - `const aBefore = await snapshotTenant(request, aToken);`
   - `try`: `PATCH /api/platform/tenants/{B.id}/status { status: "SUSPENDED" }`.
     - B admin login → 401.
     - A previously-obtained B token: `GET /api/appointments` with it → `expect([401, 403]).toContain(status)`.
     - A admin login still works; `snapshotTenant(request, aToken)` == `aBefore`.
     - C login still 401 (unchanged — it was already suspended).
   - `finally`: `PATCH /api/platform/tenants/{B.id}/status { status: "ACTIVE" }`; assert B admin login works again (`res.ok()`).

- [ ] **Step 1: Write the file.** Anchor scenario 1 fully coded.

- [ ] **Step 2: Run + iterate to 3 green.**

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts mt-platform-config`

- [ ] **Step 3: Verify no state leaked — run the whole suite**

Run: `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts`
Expected: every spec green, including `mt-world` (proves T-B active, T-C suspended, A's tier/flag restored).

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/mt-isolation/mt-platform-config.spec.ts
git commit -m "test(e2e): mt-platform-config runtime config stays tenant-scoped"
```

---

## Task 10: CI workflow, npm scripts, docs

**Files:**
- Create: `.github/workflows/e2e-mt-isolation.yml`
- Modify: `e2e/package.json`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the mt-isolation config (Task 1) and the full green suite (Tasks 4-9).
- Produces: nothing.

- [ ] **Step 1: Add npm scripts**

In `e2e/package.json`, add to `"scripts"`:

```json
    "test:mt": "playwright test --config playwright.mt-isolation.config.ts",
    "test:mt:headed": "playwright test --config playwright.mt-isolation.config.ts --headed"
```

- [ ] **Step 2: Verify the scripts locally**

Run: `cd e2e && npm run test:mt`
Expected: full suite green (same as Task 9 Step 3).

- [ ] **Step 3: Write the workflow**

Create `.github/workflows/e2e-mt-isolation.yml`:

```yaml
name: E2E · Multi-tenant isolation

on:
  pull_request:
    branches: [develop, main]
  push:
    branches: [develop, main]
  workflow_dispatch:

concurrency:
  group: e2e-mt-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  mt-isolation:
    name: Multi-tenant isolation suite
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: "20"

      - name: Set up Java
        uses: actions/setup-java@c1e323688fd81a25caa38c78aa6df2d33d3e20d9 # v4
        with:
          distribution: temurin
          java-version: "21"
          cache: gradle
          cache-dependency-path: |
            src/backend/gradle/wrapper/gradle-wrapper.properties
            src/backend/build.gradle.kts
            src/backend/settings.gradle.kts

      - name: Grant execute permission for Gradle wrapper
        run: chmod +x src/backend/gradlew

      - name: Install frontend dependencies
        working-directory: src/frontend
        run: npm ci

      - name: Install e2e dependencies
        working-directory: e2e
        run: npm ci

      - name: Install Playwright browser
        working-directory: e2e
        run: npx playwright install --with-deps chromium

      - name: Run multi-tenant isolation suite
        working-directory: e2e
        run: npx playwright test --config playwright.mt-isolation.config.ts

      - name: Upload report on failure
        if: failure()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: e2e-mt-isolation-report
          path: |
            e2e/playwright-report-mt/
            e2e/test-results-mt/
          retention-days: 7
```

Verify the pinned action SHAs match those already used in `.github/workflows/deploy-v2.yml` (checkout, setup-node, setup-java); copy them verbatim from that file. For `upload-artifact`, use the SHA of v4 — check another workflow in the repo or the `deploy-azure.yml` for a pinned reference; if none exists, pin to the current `actions/upload-artifact@v4` release SHA and add a `# v4` comment.

- [ ] **Step 4: Lint the workflow YAML**

Run: `cd /Users/juantalavera/src/pelu-develop && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/e2e-mt-isolation.yml')); print('ok')"`
Expected: `ok`.

- [ ] **Step 5: Document in CLAUDE.md**

In `CLAUDE.md`, under `### E2E (`e2e/`)`, after the existing code block, add:

```markdown

#### Multi-tenant isolation suite

```bash
npm run test:mt                             # 3-tenant isolation suite, own backend on :8081
npm run test:mt -- tests/mt-isolation/mt-turnos.spec.ts   # single file
npm run test:mt:headed                      # visible browser
```

Separate Playwright config (`playwright.mt-isolation.config.ts`) — starts its own
Spring Boot (`:8081`) + Vite (`:5174`) and provisions three divergent tenants via
`global-setup.mt.ts`. Runs in CI on every PR to `develop`/`main`
(`.github/workflows/e2e-mt-isolation.yml`). The main `npm test` suite excludes
`tests/mt-isolation/**`.
```

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/e2e-mt-isolation.yml e2e/package.json CLAUDE.md
git commit -m "ci(e2e): run multi-tenant isolation suite on PRs to develop/main"
```

- [ ] **Step 7: Push and open the PR**

```bash
git push -u origin feat/multi_tenant
```

Then open a PR into `develop` (per CLAUDE.md gitflow — `develop` is the integration branch; `feat/multi_tenant` already targets it). PR body: summarize the new suite, the six spec files, the CI trigger, and note that "E2E · Multi-tenant isolation" should be added to branch-protection required checks for `develop` and `main` as a follow-up (repo setting).

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| Separate config + backend, ports 8081/5174 | Task 1 |
| `testIgnore` guard on existing config | Task 1 Step 1 |
| `SERVER_PORT` verification | Task 1 Step 3 |
| Three-tenant world, idempotent provisioning via Platform Admin API | Task 2 |
| `MtWorld` typed handle | Task 2 Interfaces |
| Shared-ambiguous-email fixture | Task 2 Step 3 |
| "Provisioned once" semantics | Task 2 (idempotency branch) |
| Probe helpers (`expectScopedList`, `expectCrossTenantForbidden`, `snapshotTenant`, `expectUnchanged`, `expectMoneyFormat`) | Task 3 |
| `raceAcrossTenants` | Task 3 |
| `mt-auth` 6 scenarios | Task 4 |
| `mt-turnos` 4 scenarios | Task 5 |
| `mt-caja-comprobantes` 5 + 1 concurrency | Task 6 |
| `mt-ficha-propinas` 4 + 1 concurrency | Task 7 |
| `mt-sifen` 5 + 1 concurrency | Task 8 |
| `mt-platform-config` 3 scenarios | Task 9 |
| Determinism rules | Global Constraints + per-task snapshot assertions |
| "Failing assertion = suspected bug" | Global Constraints + reiterated in Tasks 5/6/8 |
| Config-mutation restore | Global Constraints + Tasks 4/9 `try/finally` |
| CI workflow (pull_request + push + workflow_dispatch, concurrency, artifacts) | Task 10 Step 3 |
| Local `npm run test:mt` | Task 10 Step 1 |
| `CLAUDE.md` update | Task 10 Step 5 |
| Branch-protection follow-up note | Task 10 Step 7 |

No spec section is unaddressed.

**2. Placeholder scan:** The plan contains deliberate *discovery steps* ("read file X to confirm the exact body key / field name / status code"), not placeholders — each names the exact file to read and what decision it feeds, and the anchor scenario for every spec task is fully coded. Endpoint bodies for invoices, appointments, service-records, cash-sessions, tenant status, and feature-flags are given verbatim from verified sources. Areas genuinely not knowable without reading more code (professional PIN endpoint, propinas withdrawal body params, SIFEN test-support tenant scoping, exact `numberFormatted` field name, `TENANT_AMBIGUOUS` i18n string) are called out with the specific file that answers them.

**3. Type consistency:** `MtTenant` / `MtWorld` / `TenantSnapshot` shapes are defined once in Task 2/3 Interfaces and referenced by field name consistently in Tasks 4-9. `mtLoginToken` / `mtPlatformToken` / `getMtWorld` / `provisionMtWorld` names are stable across all tasks. `expectScopedList` signature (with `{ includesIds, excludesIds, idField? }`) matches every call site. `raceAcrossTenants` returns `PromiseSettledResult` and all call sites check `.status === "fulfilled"`.

---

## Execution Handoff

(Filled in by the skill after save.)
