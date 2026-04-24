# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Femme/Pelu** — a multi-tenant hair salon management SPA. Two services under `src/`:

| Service  | Path            | Tech                                          | Dev port |
| -------- | --------------- | --------------------------------------------- | -------- |
| Frontend | `src/frontend/` | React 18 + Vite + TypeScript 5.4 + Tailwind + i18next | `:5173` |
| Backend  | `src/backend/`  | Spring Boot 4 (Java 21) + Spring Security (JWT) + SQL Server + Flyway | `:8080` |

E2E tests live in `e2e/` (Playwright). Infrastructure is Terraform (Azure) under `infrastructure/`.

Product requirements: `requirements/prds/femme_historias_usuario_mvp_v1.md` (cross-cutting definitions: multi-tenant, server timezone UTC, etc.). User stories: `requirements/user_stories/`.

## Commands

### Frontend (`src/frontend/`)

```bash
npm ci                    # Install (always use npm, not yarn/pnpm)
npm run dev               # Vite dev server on :5173
npm run build             # TypeScript check + production build
npm run test              # Vitest (all tests)
npm run test -- <file>    # Single test file, e.g. src/util/paraguayRuc.test.ts
npx tsc --noEmit          # Type-check only (primary lint mechanism — no ESLint configured)
```

### Backend (`src/backend/`)

```bash
docker compose up -d                        # Start local SQL Server (required before bootRun)
./gradlew bootRun --no-daemon               # Spring Boot on :8080
./gradlew test --no-daemon                  # JUnit 5 (uses H2 in-memory, no Docker needed)
./gradlew test --tests "com.cursorpoc.backend.service.FooTest" --no-daemon  # Single test
./gradlew spotlessApply --no-daemon         # Auto-fix Google Java Format (run after any Java edit)
./gradlew spotlessCheck --no-daemon         # Verify formatting (run before committing)
./gradlew bootJar --no-daemon               # Build fat JAR
```

### E2E (`e2e/`)

```bash
npm ci && npm test                          # Playwright (requires both services running)
npm run test:headed                         # Visible browser
npm run test:with-evidence                  # Timestamped HTML/video/traces in e2e/evidence/
npx playwright test tests/auth.spec.ts --headed  # Single spec
```

### Database

```bash
bash scripts/flyway-repair.sh              # Fix Flyway checksum mismatches after migration edits
```

## Architecture

```
Browser
  └── Azure Static Web App (React SPA)
        └── Azure Container App (Spring Boot API :8080)
              └── Azure SQL Database (SQL Server)
```

- Frontend fetches REST APIs; API docs at `/swagger-ui.html` and `/v3/api-docs`.
- Multi-tenant: tenant ID is embedded in the JWT and carried in request context throughout the backend.
- Auth: Spring Security + JWT. Public routes: `/health`, `/swagger-ui.html`, `/v3/api-docs` (`SecurityConfig.java`).
- DB migrations: Flyway (SQL Server format) in `src/main/resources/db/migration/`. Tests use H2 (MSSQL compat mode) with JPA `create-drop` — Flyway is disabled for `e2e` profile.
- Demo seed: `FemmeDataInitializer` seeds tenant id=1, user `admin@demo.com` / `Demo123!` on first boot.

### Frontend structure

```
src/frontend/src/
├── pages/          # Route-mapped screens
├── components/     # Reusable but product-specific components
├── design-system/  # Shared component library — always prefer these before creating new ones
├── layout/         # Page shells & navigation
├── hooks/          # Custom hooks (useTheme, useAuth, …)
├── api/            # HTTP client, error parsing (parseApiErrorMessage.ts)
├── auth/           # JWT / login flow
├── i18n/           # i18next config + locales/en.json + locales/es.json
└── utils/          # Validation helpers (paraguayRuc, etc.)
```

### Backend structure

```
src/backend/src/main/java/com/cursorpoc/backend/
├── domain/         # JPA entities (AppUser, Professional, Tenant, Appointment, …)
├── repository/     # Spring Data JPA repositories
├── service/        # Business logic
├── web/            # REST controllers
├── config/         # SecurityConfig, FlywayConfig, JwtConfig
├── security/       # JWT filters & providers
└── bootstrap/      # FemmeDataInitializer (demo tenant seed)
```

## Non-Obvious Rules

### Java / Backend

- **Always** run `./gradlew spotlessApply --no-daemon` after editing Java, then `spotlessCheck` before committing. CI enforces Google Java Format via Spotless.
- Every REST endpoint **must** log at INFO level on request (path, method, tenant ID) and on response (path, method, tenant ID, status). Use ERROR level for non-2xx responses.
- Backend errors must be `SCREAMING_SNAKE_CASE` codes (e.g. `INVALID_RUC_FORMAT`), never English prose. The frontend translates them via `femme.apiErrors.*` i18n keys.
- Java 21 required (toolchain in `build.gradle.kts`). Gradle wrapper downloads itself — no manual Gradle install.

### Frontend

- **All user-visible strings** (labels, buttons, placeholders, `aria-label`, confirmations, errors) must use `t()` from `useTranslation()`. Add every new key to **both** `en.json` and `es.json` before using it. Never hardcode copy in JSX.
- Translate backend error codes with `translateApiError(err, t, "femme.apiErrors.GENERIC")` from `src/frontend/src/api/parseApiErrorMessage.ts`.
- For backend error codes not yet in the locale files, add them under `femme.apiErrors.*` in both files.
- **Always use `npm`** (not yarn/pnpm). The repo uses `package-lock.json`. `engine-strict=true` in `.npmrc` means `npm ci` fails if Node ≠ 20.
- Use components from `src/frontend/design-system/components/` whenever possible. If new UI logic might be reusable, **stop and propose** adding it to the design system — never add it automatically.

### UI / Styling

- Every screen must support **both light and dark themes** via Tailwind + design-system ThemeProvider.
- Mobile-first: use Tailwind `sm:` / `md:` breakpoints. Avoid fixed widths; prefer `w-full`, `min-w-0`, `max-w-*`.
- Touch targets ≥ 44×44 px (the design-system `Button` handles this; extend `min-h-11` + padding for custom controls).
- Wide data (tables, nav) must live inside `overflow-x-auto` containers.

### Form validation

- Show field-level errors in red using `FieldValidationError` (`text-red-600 dark:text-red-400`). Do **not** use `--color-destructive` CSS var (undefined).
- Error messages must state the failing rule and include a concrete format example (e.g. RUC: `80000005-6`). Copy must be in both `en.json` and `es.json`.
- Use `role="alert"` on inline error text; associate controls with `aria-invalid` and `aria-describedby`.
- Non-validation failures (network errors) use `Alert variant="destructive"`.

### Search fields

Wire search/filter fields with `<form onSubmit>` + `type="submit"` button so pressing Enter triggers search (same as clicking the button). No duplicate `onKeyDown` handlers. Reference: `AdminTenantDetailPage`, `AdminUserSupportPage`.

### Branching

Trunk-based development off `main`. Branch names: `<type>/<issue-number>_short-description` (e.g. `feat/HU-07_agendar-turno`). Types: `feat`, `bugfix`, `chore`, `docs`, `refactor`, `test`.

### Local DB setup (first time)

```bash
cd src/backend && docker compose up -d
# Then create DB and login once using sqlcmd or a SQL client as `sa`:
#   CREATE DATABASE service_app_db;
#   CREATE LOGIN service_app WITH PASSWORD = 'The.S3cr3t.2026';
#   USE service_app_db; CREATE USER service_app FOR LOGIN service_app;
#   EXEC sp_addrolemember 'db_owner', 'service_app';
./gradlew bootRun --no-daemon
```

Flyway runs on boot. If checksums mismatch (e.g. after editing an applied migration), run `bash scripts/flyway-repair.sh`.
