# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Femme/Pelu** — a multi-tenant hair salon management SPA. Two services under `src/`:

| Service  | Path            | Tech                                          | Dev port |
| -------- | --------------- | --------------------------------------------- | -------- |
| Frontend | `src/frontend/` | React 18 + Vite + TypeScript 5.4 + Tailwind + i18next | `:5173` |
| Backend  | `src/backend/`  | Spring Boot 4 (Java 21) + Spring Security (JWT) + SQL Server + Flyway | `:8080` |

E2E tests live in `e2e/` (Playwright). Infrastructure is Terraform (Azure) under `infrastructure_v2/`.

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

#### Multi-tenant isolation suite

```bash
npm run test:mt                             # 3-tenant isolation suite, own backend on :8081
npm run test:mt -- tests/mt-isolation/mt-turnos.spec.ts   # single file
npm run test:mt:headed                      # visible browser
```

Separate Playwright config (`e2e/playwright.mt-isolation.config.ts`) — starts its own
Spring Boot (`:8081`) + Vite (`:5174`) and provisions three divergent tenants via
`global-setup.mt.ts` (`workers: 1`). Runs in CI on every PR to (and push to)
`develop`/`main` via `.github/workflows/e2e-mt-isolation.yml`. The main `npm test`
suite excludes `tests/mt-isolation/**` (`testIgnore` in `playwright.config.ts`).

#### Stock cross-system suite (pelu + real control-stock)

```bash
npm run test:stock                          # needs a control-stock checkout (../control-stock or CONTROL_STOCK_DIR)
npm run test:stock -- tests/stock/hu-63-64-descontar-y-reponer.spec.ts
```

Separate config (`e2e/playwright.stock.config.ts`): pelu backend `:8082` + SPA `:5175`, control-stock
backend `:8090` + SPA `:5180`, and `fixtures/stock/stock-proxy.mjs` on `:8091` between them (specs take
Stock "down" or inject errors through it). World provisioned by `global-setup.stock.ts`. Runs in CI via
`.github/workflows/e2e-stock.yml` when the `CONTROL_STOCK_READ_TOKEN` secret exists. Set
`PW_CHROMIUM_PATH` to reuse a preinstalled Chromium. Integration design and ops: `docs/stock-integration.md`.

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
- Demo seed: `FemmeDataInitializer` seeds tenant id=1, user `isabelzymanscki@gmail.com` / `Demo123!` on first boot.

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
- Buttons in an action row (dialog footers, page action bars, «Más acciones») share one size: pass `ACTION_BUTTON` (`src/frontend/src/components/actionButtons.ts`: 44 px tall, 14 px text) to the design-system `Button`. Use `MoreActionsMenu` (not a bare «⋯») for secondary actions in those rows.

### Form validation

- Show field-level errors in red using `FieldValidationError` (`text-danger`, the theme-aware red token from the Flowbit palette). Do **not** use `--color-destructive` CSS var (undefined).
- Error messages must state the failing rule and include a concrete format example (e.g. RUC: `80000005-6`). Copy must be in both `en.json` and `es.json`.
- Use `role="alert"` on inline error text; associate controls with `aria-invalid` and `aria-describedby`.
- Non-validation failures (network errors) use `Alert variant="destructive"`.

### Search fields

Wire search/filter fields with `<form onSubmit>` + `type="submit"` button so pressing Enter triggers search (same as clicking the button). No duplicate `onKeyDown` handlers. Reference: `AdminTenantDetailPage`, `AdminUserSupportPage`.

### Branching

Gitflow: `develop` is the integration branch, `main` is the release branch. Cut feature/bugfix branches from `develop`, named `<type>/<issue-number>_short-description` (e.g. `feat/HU-07_agendar-turno`). Types: `feat`, `bugfix`, `chore`, `docs`, `refactor`, `test`. PRs from these branches target `develop`. Only open a PR into `main` when the user explicitly asks for one (e.g. a release cut).

### Automated tests
EVERY acceptance criteria of EVERY user story MUST be covered by an automated test implemented with playwright.
In the case of a user story containing a list of small adjustments, every adjustment must be covered by a playwright test.
If a new requirement modifies an existing feature, the corresponding playwright test MUST be updated as well.
All playwright tests MUST be always in sync with the latest implementation of the feature.
If for some reason it is not possible to cover an acceptance criteria with an automated test, let the user know and ask how to move forward.

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

The default profile expects Azure Key Vault (`app.femme.keyvault.enabled=true` by default — RT-12/RT-18, `Hardening_SIFEN.md`) for the JWT secret and SIFEN certificate storage. Without a real vault to point at, `bootRun` locally with `FEMME_KEYVAULT_ENABLED=false APP_FEMME_JWT_SECRET=<32+ char string> ./gradlew bootRun --no-daemon` to fall back to local file storage for certificates and a literal JWT secret (via Spring Boot's standard relaxed env-var binding — no property placeholder needed), same opt-out `application-e2e.properties` uses.

### Local backend against Azure dev services (DB stays local)

Instead of disabling Key Vault, you can point the local backend at the real `flowbit-peluqueria-dev` Azure resources for Key Vault, Service Bus, ACS Email, and Application Insights, while the database stays on your local Docker SQL Server (`spring.datasource.*` in `application.properties` already defaults there independently of the Azure config).

Prereqs: `az login` against the `flowbit-peluqueria-dev` subscription, and membership in the `femme-sql-admins` Entra group (grants "Key Vault Secrets Officer" on the dev vault and "Azure Service Bus Data Sender/Receiver" on the `sifen-submission` queue — see `infrastructure_v2/main.tf`, `deployer_kv_secrets_officer` / `deployer_sb_sender` / `deployer_sb_receiver`).

Fetch the two connection strings yourself each session (never commit these):

```bash
az communication list-key --name femme-acs-b10via --resource-group femme-test-rg --query primaryConnectionString -o tsv
az monitor app-insights component show --app femme-ai-b10via --resource-group femme-test-rg --query connectionString -o tsv
```

Then boot with:

```bash
FEMME_KEYVAULT_URI=https://femme-kv-b10via.vault.azure.net/ \
FEMME_SERVICEBUS_NAMESPACE=femme-sb-b10via.servicebus.windows.net \
ACS_CONNECTION_STRING=<value from az communication list-key> \
ACS_SENDER_ADDRESS_REMINDERS=DoNotReply@3fd72f16-072d-4971-9593-05a576dc06da.azurecomm.net \
ACS_SENDER_ADDRESS_INVOICES=DoNotReply@3fd72f16-072d-4971-9593-05a576dc06da.azurecomm.net \
ACS_SENDER_ADDRESS_GENERIC=DoNotReply@3fd72f16-072d-4971-9593-05a576dc06da.azurecomm.net \
APPLICATIONINSIGHTS_CONNECTION_STRING=<value from az monitor app-insights component show> \
APP_FEMME_PLATFORM_ADMIN_EMAIL=<email> APP_FEMME_PLATFORM_ADMIN_PASSWORD=<password> \
./gradlew bootRun --no-daemon
```

Do not set `FEMME_KEYVAULT_ENABLED=false`, `APP_FEMME_JWT_SECRET`, or any `SPRING_DATASOURCE_*` override — leaving those unset is what keeps Key Vault real and the database local. Caveat: this hits real shared dev resources — ACS actually sends email, and the Service Bus queue is the same one the deployed dev backend consumes from.

**Shortcut script**: `src/backend/run-local-azure-dev.sh` sets `FEMME_KEYVAULT_URI`, `FEMME_SERVICEBUS_NAMESPACE`, `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS_REMINDERS`/`ACS_SENDER_ADDRESS_INVOICES`/`ACS_SENDER_ADDRESS_GENERIC`, and `APPLICATIONINSIGHTS_CONNECTION_STRING`, then execs `./gradlew bootRun --no-daemon`. It embeds a live ACS connection string, so it's gitignored — never commit it. Still requires `docker compose up -d` and `az login` first. It does not set `APP_FEMME_PLATFORM_ADMIN_EMAIL`/`APP_FEMME_PLATFORM_ADMIN_PASSWORD` — export those separately if you need platform-admin login.

### Conversational assistant (`ASSISTANT_CHATBOT`)

Side-panel chat (plan: `requirements/asistente/plan_asistente.md`; stories `HU-AST-*`). The model **proposes, a person confirms**: it reads with `buscar_clientes`, `listar_servicios`, `listar_productos`, `listar_profesionales`, `turnos_del_dia` and `consultar_disponibilidad` (free times, computed by `AvailabilityService`, offered as chips), and prepares DRAFTS (`proponer_factura`, `agregar_item_a_borrador`, `proponer_turno`, `descartar_borrador`) that live only in the chat (`assistant_draft`, 24 h). Turning a draft into data is the card's button (`POST /api/assistant/drafts/{id}/confirm`), never a tool; it issues through `InvoiceEmissionService` (same road as `POST /api/invoices`, audited as `invoices`/`issue`) or books through `AppointmentService.create` (PENDING appointment, audited as `appointments`/`create`), both with `source=ASSISTANT`; a taken slot at confirm is 409 `ASSISTANT_SLOT_TAKEN` with alternatives and the draft survives. Money in assistant output is fixed: `Gs. 50.000` (`AssistantMoney`); service and product listings are name + price only (system prompt rule 9); invoices take services AND products (the draft's catalog has both kinds, appointments only services), items can be added to the active draft keeping the person's edits, and a draft item can be dropped from the card (at least one stays). The flag is born OFF globally; the effective value is `global AND tier AND tenant`, so a Platform Admin turns it on globally and off where it must not apply.

- **Model**: `app.femme.assistant.model` (`FEMME_ASSISTANT_MODEL`) is `real` (Azure AI Foundry through Spring AI, Entra ID — no API key) or `fake`. The `e2e` and `test` profiles use `fake`: `ScriptedAssistantModelClient` answers by text patterns (English or Spanish keywords: `appointments <today|tomorrow|yyyy-MM-dd>`, `appointments of <name>`, `search <text>`, `services`, `products`, `professionals`, `invoice <client> [for <service|product> [x<qty>] [at <amount>]] [cash]`, `add <service|product> [x<qty>] [at <amount>]`, `availability <today|tomorrow|yyyy-MM-dd> [morning|afternoon] for <service> [with <professional>]`, `book <client> for <service> <today|tomorrow|yyyy-MM-dd> at HH:mm [with <professional>]`, `discard the draft`, `model fails`; add `slowly` to make the answer trickle out) and goes through the real orchestrator, tools and SSE. Playwright never calls Foundry.
- **Local without Foundry**: `FEMME_ASSISTANT_MODEL=fake ./gradlew bootRun --no-daemon` (or leave `FEMME_AI_*` unset: the backend boots and the assistant answers `ASSISTANT_MODEL_UNAVAILABLE`).
- **Local against the dev Foundry**: with the "Local backend against Azure dev services" setup above, add `FEMME_AI_ENDPOINT=<foundry endpoint>`, `FEMME_AI_DEPLOYMENT=femme-assistant` and, for dictation, `FEMME_SPEECH_REGION=centralus` (endpoint: `az cognitiveservices account list -g femme-test-rg --query "[?kind=='AIServices'].properties.endpoint" -o tsv`). `FoundryLiveTest` is an opt-in smoke test against the real deployment (skipped unless `FEMME_AI_ENDPOINT` is set; use `cleanTest` so Gradle re-runs it). `femme-sql-admins` also gets "Cognitive Services OpenAI User" / "Cognitive Services User" on the Foundry account (`deployer_ai_openai_user` / `deployer_ai_cognitive_user`). `DefaultAzureCredential` picks up your `az login`.
- **Dictation** (`HU-AST-07`): the microphone only fills the message box (it never sends). The browser talks to Azure AI Speech directly with a Speech-only token from `GET /api/assistant/speech-token` (`AzureSpeechTokenService`: the backend's Entra identity → `sts/v1.0/issueToken`, 9 min; never the Entra token itself); a message in which the mic was used is stored as `input_mode=VOICE` and shown as «Dictado». The e2e/Playwright Vite build (`VITE_PLAYWRIGHT=1`) swaps Speech for a simulated engine driven through `window.__assistantDictation` (see `e2e/fixtures/assistant.ts`); real recognition quality is tested by hand.
- `POST /api/assistant/messages` streams Server-Sent Events (`message.delta`, `tool.status`, `card.draft`, `card.draft.updated`, `message.done`, `error`). Errors before the stream starts are JSON (`AssistantExceptionHandler`); never log conversation text. Playwright expires a draft with the e2e-only `POST /api/admin/assistant-test-support/drafts/{id}/expire`.
