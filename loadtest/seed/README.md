# Load-test golden DB generator (`loadtest/seed`)

Builds the multi-tenant **golden DB** used by `scripts/staging/up.sh --data=loadtest`
(docs/staging-env.md, T6). Node 20, **no dependencies** (built-in `fetch` only), so there is
nothing to install and no lockfile.

You normally don't run `seed.mjs` directly. `scripts/staging/seed-golden-db.sh` drives it:

```bash
export STAGING_PLATFORM_ADMIN_EMAIL=… STAGING_PLATFORM_ADMIN_PASSWORD=… SEED_USER_PASSWORD=…
scripts/staging/up.sh --data=empty --ref=develop
scripts/staging/seed-golden-db.sh --tenants=20 --sifen-tenants=2   # → loadtest/loadtest-V<v>-t20-s2.bacpac
scripts/staging/down.sh
```

## What it generates

| Phase | How | What |
|---|---|---|
| 1 | Real Platform Admin + tenant APIs (same pattern as `e2e/fixtures/mt/world.ts`) | tiers `loadtest-sifen` / `loadtest-basic`, tenants `LT 000…`, one ADMIN each (`lt-t000-admin@loadtest.invalid`), business profile, categories, services, professionals + Mon–Sat schedules, active fiscal stamp |
| 1 (SIFEN, first M tenants) | Platform SIFEN endpoints | Femme Coiffure's issuer data and timbrado (read from dev), its CSC and `.p12` (read from the dev Key Vault) uploaded through the real CSC / certificate APIs |
| 2 | Set-based T-SQL (`lib/history-sql.mjs`) | clients, past appointments (status mix), fichas, invoices on an **inactive** historic stamp, payments, tips, cash sessions and movements, upcoming appointments |

- **Tenant count is a multiple of 10.** Volumes are per block of 10 with a fixed seed, and every
  random choice is keyed by the tenant's *index*. So a `t30` DB is the `t20` DB plus one more
  block, and you can grow an existing BACPAC (`--from-bacpac=…`) instead of regenerating it.
- **SIFEN tenants** get a placeholder range on their active stamp. On every import, `up.sh`
  rebases it to that run's disjoint block `start(k)…end(k)`, so it never collides on `sifen-test`.
  History invoices are on a separate inactive stamp and were never sent to SIFEN.
- **Size:** the generator estimates the DB size first and refuses an N that won't fit the Basic
  2 GB cap with headroom (1.5 GB). `seed-golden-db.sh` then records the actual size.
- **Dates** are relative to an anchor day stored in `loadtest_meta`. `up.sh` shifts them by whole
  weeks on import, so an old BACPAC still has a populated agenda for today.

## Calibration

`volumes.json` holds **placeholders**. After the first sanitized prod snapshot exists, bring it up
(`up.sh --data=prod`), run `measure-volumes.sql` against it, copy the aggregates into
`volumes.json`, bump `version`, and regenerate the golden BACPACs.
