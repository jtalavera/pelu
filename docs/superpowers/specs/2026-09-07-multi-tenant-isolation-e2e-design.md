# Multi-tenant isolation E2E suite — design

**Date:** 2026-09-07
**Branch:** `feat/multi_tenant`
**Status:** Approved design, pending implementation plan

## Problem

The multi-tenant *management* features (HU-34–58: create/edit/suspend tenant,
tiers, feature flags, Excel import) each have per-HU Playwright coverage, but
almost entirely from the platform-admin side. The ~500 business-workflow specs
(turnos, caja, comprobantes, SIFEN, fichas, propinas) all run against a
**single** demo tenant provisioned by `e2e/global-setup.ts`. Nothing exercises
a critical business workflow while a second, differently-configured tenant's
data coexists, and nothing asserts that data or config never bleeds across
tenants.

The manual checklist (`requirements/multi-tenant/manual_test_checklist.md`)
still lists untested isolation cases: login to a non-oldest tenant, same
email+password in two tenants, suspend → users blocked.

## Goal

A **new, focused Playwright suite** that:

1. Provisions three deliberately-divergent tenants once.
2. Runs the critical business workflows through the UI as each tenant.
3. Cross-probes via the API that the other tenants are untouched and never
   see the acting tenant's rows.
4. Includes a small number of genuinely-concurrent cross-tenant request tests.

Non-goal: parameterizing or retrofitting the existing 585 specs. They stay
byte-for-byte untouched.

## Feasibility note — login resolution

`AuthService.login` is **credentials-first**. When no custom domain matches the
request Origin (the `localhost` e2e case), `candidateUsersForLogin` returns
every tenant the email exists in, then password + `enabled` + active-tenant
filtering picks the unique match:

- A tenant admin with a **distinct** email logs in fine at `localhost` and
  resolves to its own tenant.
- `TENANT_AMBIGUOUS` (`HttpStatus.UNAUTHORIZED`, "linked to more than one
  business") fires **only** when the same email **and** password are valid in
  2+ active tenants.

So the UI-primary approach works for all three tenants, and the
same-email-in-two-tenants case is a deliberate fixture, not a blocker.
(`AuthService.java:170–185`, `candidateUsersForLogin` / `resolveTenantByDomain`.)

## Architecture

### Isolation from the existing suite — separate config + backend

`e2e/playwright.mt-isolation.config.ts` is a standalone Playwright config:

- Own `webServer` block starting **both** services itself:
  - Spring Boot on `:8081`, `SPRING_PROFILES_ACTIVE=e2e` (fresh in-memory H2,
    email disabled).
  - Vite on `:5174` with `VITE_API_BASE_URL=http://127.0.0.1:8081`.
  - Chosen ports avoid any clash with a normal dev stack on `:8080` / `:5173`.
- `testDir: ./tests/mt-isolation` (resolved relative to the config file →
  `e2e/tests/mt-isolation/`, a new subdirectory of the existing `e2e/tests/`).
- `workers: 1`, `retries: 0` locally / `2` on CI, `reuseExistingServer: !CI`.
- `globalSetup: ./global-setup.mt.ts`.

The existing `playwright.config.ts` has `testDir: "./tests"` and discovers
specs recursively, so it needs a one-line guard to skip the new subdirectory:

```ts
// playwright.config.ts
testDir: "./tests",
testIgnore: "mt-isolation/**",   // the mt-isolation suite runs from its own config
```

This is the only edit to an existing e2e file (besides the two `package.json`
scripts).

Rationale vs. alternatives:

| Option | Verdict |
|---|---|
| **Separate config + backend** (chosen) | Existing 585 specs untouched; deterministic fixed multi-tenant world; concurrent-request tests own the whole DB so races are real signal. Cost: ~2–3 min extra backend boot for this suite only, ~40 lines duplicated config. |
| Same suite, `beforeAll` fixture | 3 permanent extra tenants + their data pollute the shared H2 for every spec that runs after — would need to audit/adjust HU-39 and any global-count assertion. Ordering-fragile. Rejected. |
| Extend `global-setup.ts` | Same pollution, permanently, for all 585 specs. Rejected. |

### The three-tenant fixture world

`global-setup.mt.ts` provisions this once, before any spec, entirely through
the real Platform Admin API + tenant-admin API (`POST /api/platform/tenants`,
`POST /api/platform/tenants/{id}/admins`, `POST /api/auth/activate`, HU-40
suspend endpoint) — never a boot seed. Idempotent: if the backend is reused
(`reuseExistingServer` locally), it finds tenants by name, re-verifies the
three logins resolve to the expected tenant ids, and returns without
re-creating.

| | **T-A — "Salón Aurora"** | **T-B — "Barbería Boreal"** | **T-C — "Ceval Suspendido"** |
|---|---|---|---|
| Tier | tier with `SIFEN_ELECTRONIC_INVOICING` **on** | different tier, SIFEN **off** | any tier |
| Status | Active | Active | **Suspended** (created active, then suspended) |
| Business profile | RUC set, ready to invoice | RUC set | minimal |
| Fiscal stamp | own active timbrado + number range | none | none |
| Catalog | 2 categories, 3 services | 1 category, 2 services — **two names deliberately reused from A** | 1 service |
| Professionals | 2, each with a PIN | 2, each with a PIN | 1 |
| Clients | 3 (`aurora-cli-*`) | 3 (`boreal-cli-*`) | 1 |
| Admin | `mt-aurora-admin@e2e.local` | `mt-boreal-admin@e2e.local` | `mt-ceval-admin@e2e.local` |
| Extra admin | also admin of A: `mt-shared@e2e.local` (same password) | `mt-shared@e2e.local` | — |

Catalog / stamp / client seeding reuses the token-parameterized helpers in
`e2e/fixtures/api.ts` (`seedCategoryServiceProfessional`,
`ensureActiveFiscalStampForInvoices`, …) — no new seeding logic.

`global-setup.mt.ts` writes a JSON handle consumed by specs (same pattern
`global-setup.ts` uses today). `getMtWorld()` returns a typed `MtWorld`:

```ts
type MtTenant = {
  id: number;
  name: string;
  adminEmail: string;
  adminPassword: string;
  catalog: { categoryIds: number[]; serviceIds: number[]; serviceNames: string[] };
  professionalIds: number[];
  professionalPins: string[];
  clientIds: number[];
};
type MtWorld = { tenantA: MtTenant; tenantB: MtTenant; tenantC: MtTenant };
```

Plus helpers `token(which)` / `apiContext(which)`.

### "Provisioned once" — precise semantics

- **CI / any fresh backend:** the mt config boots its own Spring Boot with a
  new in-memory H2; `global-setup.mt.ts` runs one time before the suite and
  provisions from scratch. Backend is killed at end of run; next run starts
  over. "Once per run, always from scratch."
- **Local with a reused backend** (`reuseExistingServer`, default outside CI):
  `global-setup.mt.ts` checks whether `mt-aurora-admin@e2e.local` already logs
  in; if so it re-verifies the three logins and returns immediately. "Once,
  then reused."
- Either way: runs at suite start, never per-spec / per-test. Specs do
  `test.beforeAll` to grab the `MtWorld` handle and create their own per-test
  data (timestamped) on top of the three base tenants.

## Workflow scenarios

Six spec files under `e2e/tests/mt-isolation/`. Pattern for each scenario:
**drive the workflow through the UI as tenant X**, then **API cross-probe as
tenant Y** that Y is untouched and never sees X's rows (and, where relevant,
the reverse). "Cross-probe forbidden" = Y's token against X's resource id →
403/404.

### `mt-auth.spec.ts` — identity & routing (6)

1. Platform admin login → `/platform`; T-A admin → `/app`, header "Salón
   Aurora"; T-B admin → `/app`, header "Barbería Boreal".
2. Decode each JWT: T-A `tid` = A's id, T-B `tid` = B's id, platform-admin
   token has **no** `tid`.
3. `mt-shared@e2e.local` (same email+password in A and B) → UI login shows the
   `TENANT_AMBIGUOUS` error copy; neither dashboard loads.
4. T-C (suspended) admin login → generic `INVALID_CREDENTIALS`. Reactivate T-C
   via platform API → same login succeeds and lands on `/app`. (Restores T-C
   to suspended in `afterAll`.)
5. T-A admin token → `GET /api/platform/tenants` → 403. Platform-admin token →
   a tenant business endpoint (e.g. `GET /api/appointments`) → 403/400.
6. Forgot-password for T-B's admin (non-oldest tenant) → 200 and a reset-token
   row is created (email disabled in `e2e`; assert via the platform
   "trigger reset" inspection path used by HU-44).

### `mt-turnos.spec.ts` — calendar & appointments (4)

1. As T-A admin (UI): book appointment — A client + A professional + A service,
   tomorrow 10:00. As T-B admin (UI): open calendar same week → A's appointment
   absent; professional/service pickers list only B's rows; selecting the
   shared-name service resolves to B's service id (assert via create payload /
   network).
2. API cross-probe: `GET /api/appointments?from…to…` with B token → none of A's
   ids; with A token → only A's.
3. Interleave: create appointment in A at 14:00, then in B at 14:00 (same slot,
   same professional *name*) → both succeed; no cross-tenant slot-collision.
4. Edit A's appointment (reschedule to 11:00), then cancel a second A
   appointment → B's calendar + appointment list byte-identical before/after
   (`snapshotTenant` / `expectUnchanged`).

### `mt-caja-comprobantes.spec.ts` — cash session & receipts (5)

1. Open caja del día for T-A (UI). Assert T-B's caja still closed (UI +
   `GET /api/cash-session/current` with B token). Open T-B's caja → both open,
   independent opening balances.
2. Emit a comprobante in A (full UI flow). Emit one in B. Assert invoice
   numbers are independent per-tenant sequences — B's next number not bumped by
   A's emission.
3. Historial: A token lists only A's invoice; B token only B's. B token →
   `GET /api/invoices/{A-invoice-id}` → 403/404.
4. Anular A's comprobante (UI) → B's historial, totals, caja balance unchanged.
5. Close A's caja (UI) → B's caja stays open; A's close-of-day totals include
   only A's sale.

### `mt-sifen.spec.ts` — electronic invoicing / config divergence (5)

1. T-A (SIFEN on): emit → SIFEN send triggered, KuDE download available,
   invoice shows SIFEN status. T-B (SIFEN off): SIFEN affordances absent from
   the comprobante screen; emitting produces a plain receipt;
   `POST /api/sifen/**` with B token → feature-disabled error code.
2. Certificate & timbrado: T-A's cert / active timbrado never appear in T-B's
   SIFEN config screens or API responses.
3. Numeración inutilizada: register a voided range for T-A (UI) → not visible
   in T-B's list; lists independent.
4. B token → A's SIFEN status / KuDE endpoints (by invoice id) → 403.
5. A's stamp `usedCount` advances only by A's own emissions across the spec
   (delta vs. a `beforeAll` baseline, not an absolute).

### `mt-ficha-propinas.spec.ts` — service sheet & tips (4)

1. Create a ficha de servicio in A (client, professional, line items, tip).
   Create one in B. Each "historial de fichas" lists only its own; row-click
   opens only its own; B token → A's ficha id → 403.
2. Propinas report: tip booked in A appears in A's report against A's
   professional, with `Gs.` formatting (dot separator, no decimals); B's
   propinas report unaffected.
3. Per-professional tip **withdrawal** in A → A's running tip total drops; B's
   tip pool + totals unchanged.
4. Invoice-from-ficha in A → uses A's invoice numbering; B untouched.

### `mt-platform-config.spec.ts` — runtime config stays tenant-scoped (3)

1. Toggle `SIFEN_ELECTRONIC_INVOICING` per-tenant override **off for T-A**
   (platform UI) → on next T-A login the SIFEN UI is gone; T-B and the global
   default unchanged. Restore in `finally`.
2. Change T-A's assigned tier → T-A's resolved flags shift per 3-level
   resolution (global → tier → override); T-B's resolved flags identical
   before/after. Restore.
3. Suspend T-B mid-run (platform UI) → T-B admin can no longer log in and an
   active T-B session's next API call is rejected; T-A and T-C unaffected.
   Reactivate T-B → restored.

Scenarios in `mt-platform-config` overlap HU-40/47 mechanically; the retained
value is asserting non-interference with the other live tenants.

## Concurrency probes

`e2e/fixtures/mt/concurrent.ts` — `raceAcrossTenants(fn)` runs `fn` for A and B
via `Promise.all` on **separate `request.newContext()`** instances (no shared
cookie/token state), returns both results.

Targeted concurrent-request tests (not the whole suite):

- Simultaneous emit-comprobante against A and B → two distinct invoices,
  correct per-tenant numbers, no number collision or lost update.
- Simultaneous SIFEN-status polls for A and B → each returns its own tenant's
  state.
- Simultaneous tip-withdrawal in A and B → each tenant's running total correct.

These live in the relevant domain spec files (`mt-caja-comprobantes`,
`mt-sifen`, `mt-ficha-propinas`), one concurrency scenario each.

## Isolation helpers

`e2e/fixtures/mt/probe.ts`:

- `expectScopedList(request, token, path, { includesIds, excludesIds })` —
  GET a list endpoint, assert contains every `includesIds` and none of
  `excludesIds`.
- `expectCrossTenantForbidden(request, token, path)` — assert 403 or 404
  (never 200, never 500).
- `snapshotTenant(request, token)` → digest
  `{ invoiceCount, lastInvoiceNumber, appointmentIds, tipTotalMinor,
  cashSessionState }`; `expectUnchanged(before, after)`.
- `expectMoneyFormat(text)` — dot separator, no decimals.

## Determinism rules (hard constraints)

1. Every assertion is "contains / excludes *this specific seeded id or
   number*" — never an absolute count or "exactly N total."
2. Per-test data (appointments, invoices, fichas) uses timestamped
   names/identifiers; no spec depends on another spec's data.
3. Only `mt-platform-config.spec.ts` mutates tenant-level config
   (flags/tier/status); every scenario restores original state in
   `finally` / `afterAll`.
4. `mt-sifen.spec.ts` stamp-consumption assertion tracks a delta against a
   `beforeAll` baseline, not an expected absolute `usedCount`.
5. Suite stays `workers: 1`; concurrency is *within* a test via `Promise.all`,
   never via parallel Playwright workers.

## CI trigger & local run

### New workflow — `.github/workflows/e2e-mt-isolation.yml`

The existing 585-spec suite is not run in CI at all; this focused suite is
small enough to gate PRs.

```yaml
name: E2E · Multi-tenant isolation
on:
  pull_request:
    branches: [develop, main]     # opened + synchronize + reopened
  push:
    branches: [develop, main]     # post-merge
  workflow_dispatch:              # manual
concurrency:
  group: e2e-mt-${{ github.ref }}
  cancel-in-progress: true
```

One job, `runs-on: ubuntu-latest`, `timeout-minutes: 30`:

1. checkout · setup-node 20 · setup-java 21 (temurin, gradle cache)
2. `src/frontend`: `npm ci` · `e2e`: `npm ci` ·
   `npx playwright install --with-deps chromium`
3. `cd e2e && npx playwright test --config playwright.mt-isolation.config.ts`
   (env `CI=1`) — config's `webServer` starts both services.
4. `actions/upload-artifact` on failure → `e2e/playwright-report/` +
   `e2e/test-results/`.

Separate workflow file, not a job in `deploy-v2.yml`. To make it a merge
blocker, add "E2E · Multi-tenant isolation" to branch-protection required
checks for `develop` and `main` (repo setting — outside this change's scope,
noted here as a follow-up).

### Local run

New `e2e/package.json` scripts:

```json
"test:mt": "playwright test --config playwright.mt-isolation.config.ts",
"test:mt:headed": "playwright test --config playwright.mt-isolation.config.ts --headed"
```

- `cd e2e && npm run test:mt` — starts its own backend + Vite on `:8081` /
  `:5174`, provisions the world, runs the suite. Zero prior setup.
- `npm run test:mt -- tests/mt-isolation/mt-turnos.spec.ts` — single file.
- `npm run test:mt:headed` — visible browser.
- `reuseExistingServer: !CI` → re-runs against an already-booted mt backend
  skip re-provisioning.
- Documented in `CLAUDE.md` under the E2E section.

## File layout

```
e2e/
├── playwright.config.ts                  # edit — add testIgnore: "mt-isolation/**"
├── playwright.mt-isolation.config.ts     # new
├── global-setup.mt.ts                    # new
├── fixtures/mt/
│   ├── world.ts                          # new
│   ├── probe.ts                          # new
│   └── concurrent.ts                     # new
├── tests/mt-isolation/
│   ├── mt-auth.spec.ts                   # new — 6 scenarios
│   ├── mt-turnos.spec.ts                 # new — 4
│   ├── mt-caja-comprobantes.spec.ts      # new — 5 (+1 concurrency)
│   ├── mt-sifen.spec.ts                  # new — 5 (+1 concurrency)
│   ├── mt-ficha-propinas.spec.ts         # new — 4 (+1 concurrency)
│   └── mt-platform-config.spec.ts        # new — 3
└── package.json                          # +2 scripts

.github/workflows/e2e-mt-isolation.yml    # new
CLAUDE.md                                  # E2E section update
```

Existing files modified: `e2e/playwright.config.ts` (one-line `testIgnore`),
`e2e/package.json` (2 scripts), `CLAUDE.md` (E2E section). Nothing else.

## Rollout / implementation order

1. `playwright.mt-isolation.config.ts` + `global-setup.mt.ts` +
   `fixtures/mt/world.ts` — provisioning works, one trivial smoke spec green
   locally.
2. `fixtures/mt/probe.ts` + `fixtures/mt/concurrent.ts`.
3. Spec files in order: `mt-auth` → `mt-turnos` → `mt-caja-comprobantes` →
   `mt-ficha-propinas` → `mt-sifen` → `mt-platform-config`.
4. `.github/workflows/e2e-mt-isolation.yml` — added once the suite is green
   locally end-to-end.
5. `CLAUDE.md` update.

## Risks / open points

- **Backend boot time on CI** (~2–3 min for the mt Spring Boot instance) plus
  Playwright browser install — job budgeted at 30 min; expected ~10–15.
- **Platform-admin impersonation of a tenant business endpoint** — scenario
  `mt-auth` #5 assumes the platform-admin token is rejected on tenant business
  endpoints. If the codebase actually supports an impersonation header, that
  scenario adjusts to assert the header is *required* (no ambient tenant).
  Verify against `SecurityConfig` / the tenant-context filter during
  implementation.
- **`ensureActiveFiscalStampForInvoices` headroom rotation** (per
  `project-multi-tenant-develop-merge-fixes`) — T-A gets its **own** dedicated
  stamp in provisioning; no scenario deliberately near-exhausts it.
- Branch-protection "required check" wiring is a manual repo setting, not part
  of this change.
