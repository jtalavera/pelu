# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Single product with two services under `src/`:


| Service  | Path            | Tech                                          | Dev port |
| -------- | --------------- | --------------------------------------------- | -------- |
| Frontend | `src/frontend/` | React 18 + Vite + Tailwind + i18next          | `:5173`  |
| Backend  | `src/backend/`  | Spring Boot 4 (Java 21) + SQL Server + Flyway | `:8080`  |

**Femme product docs:** PRD and cross-cutting definitions — `requirements/prds/femme_historias_usuario_mvp_v1.md` (section *Definiciones transversales*: multi-tenant, server timezone, etc.). User stories — `requirements/user_stories/`. Open product questions — `requirements/preguntas_abiertas_v1.md`.

The backend uses **SQL Server** locally (`src/backend/docker-compose.yml`) and in **Azure** (production). Default credentials match that stack: database `**service_app_db`**, user `**service_app`**, password from `**MSSQL_SA_PASSWORD**` (default `**The.S3cr3t.2026**`, same as the container’s `**MSSQL_SA_PASSWORD**`). Create the database and `**service_app**` login once before the first `./gradlew bootRun` if they do not exist (locally use `sqlcmd` or any SQL client as `**sa**`). **Automated tests** (`./gradlew test`) and **Playwright e2e** (`profile` `**e2e`**) use an **in-memory H2** database (MSSQL compatibility mode), not SQL Server. **Docker** is not required for backend unit or integration tests.

### Running services

- **Node.js (frontend)**: Use **Node 20** locally — same major as CI (`.github/workflows/ci.yml`). The repo pins it via `.nvmrc`, `.node-version`, and `mise.toml` at the project root. [nvm](https://github.com/nvm-sh/nvm): from repo root run `nvm install` and `nvm use`. [fnm](https://github.com/Schniz/fnm) / [asdf](https://asdf-vm.com/) typically read `.node-version`. [mise](https://mise.jdx.dev/): `mise install` (uses `mise.toml`). **Homebrew (macOS)**: `brew install node@20`, then ensure that install is first on `PATH` (e.g. `export PATH="$(brew --prefix node@20)/bin:$PATH"`). `src/frontend/.npmrc` sets `engine-strict=true`, so `npm ci` / `npm install` fails if your Node version does not match `package.json` `engines`.
- **Frontend**: `npm run dev` from `src/frontend/` (Vite dev server on port 5173)
- **Backend**: From `src/backend/`, start SQL Server (`docker compose up -d` or Podman equivalent) and ensure `**service_app_db`** and login `**service_app`** exist (see above), then `./gradlew bootRun` (Spring Boot on port 8080, uses `--no-daemon` for single-use Gradle daemon)
- **Backend tests**: `./gradlew test --no-daemon` from `src/backend/`
- **Frontend type check**: `npx tsc --noEmit` from `src/frontend/`
- **Frontend build**: `npm run build` from `src/frontend/`

### Non-obvious caveats

- The backend uses Spring Security with a generated password printed at startup. The `/health` and Swagger endpoints (`/swagger-ui.html`, `/v3/api-docs`) are configured as `permitAll` in `SecurityConfig.java`.
- No ESLint is configured for the frontend. TypeScript checking via `npx tsc --noEmit` is the primary lint mechanism.
- The frontend uses `package-lock.json` — always use `npm` (not yarn/pnpm).
- The Gradle wrapper automatically downloads Gradle 8.14.3 on first run; no manual Gradle installation needed.
- Java 21 is required for the backend (toolchain configured in `build.gradle.kts`).
- **Flyway checksum mismatch** (e.g. after editing a migration that was already applied, or after replacing an old migration with a Java migration): run `bash scripts/flyway-repair.sh` from the repo root (uses Podman or Docker; set `SPRING_DATASOURCE_URL` / credentials if they differ from defaults). That runs `flyway repair` against your SQL Server so `flyway_schema_history` checksums match the files on disk. Alternatively, drop and recreate the dev database if you do not need the data.

### Frontend responsive UI (mobile-first)

These rules apply to **every new screen** and should be reflected in layout, Tailwind classes, and design-system usage.

1. **Viewports**: Treat layouts as mobile-first. Use Tailwind `sm:` / `md:` breakpoints so narrow screens stack content and wider screens can use multi-column or horizontal patterns. Avoid fixed widths that clip or overflow on small screens; prefer `min-w-0`, `w-full`, and `max-w-`* on containers.
2. **Touch targets**: Interactive controls (buttons, primary links, tab triggers, key nav items) should meet at least ~44×44px on phones. The design-system `Button` defaults encode this; extend the same idea for custom links or controls (`min-h-11`, padding).
3. **Simple flows**: Prefer one primary action per view, vertical stacking, and full-width primary actions on narrow viewports. Reduce parallel controls on small screens (e.g. stack toolbars, scroll tab lists horizontally instead of squashing).
4. **Safe areas**: Respect notched devices with `env(safe-area-inset-*)` padding on full-bleed layouts (see `src/frontend/src/index.css`). The HTML viewport uses `viewport-fit=cover` in `index.html`.
5. **Overflow**: Wide data (tables, nav) should live in `overflow-x-auto` regions so the page does not scroll horizontally; the root layout avoids stray horizontal overflow.
6. **Documentation**: When adding patterns (e.g. a new page shell), follow existing pages under `src/frontend/src/pages/` and the design system under `src/frontend/design-system/components/`.

### Search fields (keyboard and accessibility)

When a **search** (or filter) field has a separate **Search** button, wire them with a `**<form onSubmit>`** and a `**type="submit"`** button so that **Enter in the input runs the same action as the button** (native form behavior, no duplicate `onKeyDown` handlers). Prefer this pattern for any future search/filter bar with a primary action. Reference: `AdminTenantDetailPage` (tenant admin user search) and `AdminUserSupportPage` (user directory search).

### Form validation (frontend)

1. **Visibility** — Field-level validation messages must use the **destructive** semantic color so they are always clearly **red** in both themes: `text-[rgb(var(--color-destructive))]` (see `FieldValidationError` in `src/frontend/src/components/FieldValidationError.tsx` and `FIELD_VALIDATION_ERROR_CLASS`). Do not rely on default browser validation bubbles for styled forms when you need consistent product styling; use `noValidate` and explicit messages where appropriate.
2. **Content** — Each message should say **what failed** and **what format or rule is required**, with a **concrete example** when the field has a pattern (e.g. Paraguay RUC: eight digits, hyphen, check digit, e.g. `80000005-6`). Copy must be in **i18n** (English and Spanish).
3. **Accessibility** — Use `role="alert"` on inline validation text and associate controls with `aria-invalid` and `aria-describedby` pointing at the error id when there is an error.
4. **Scope** — Non-validation failures (network, server unavailable) may use `Alert` `variant="destructive"`; **validation** feedback should prefer inline red text under the relevant field (or a single red `FieldValidationError` at the top of the form for server-side validation without a clear field).