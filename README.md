# pelu

**Sistema para peluquerías** — hair salon product (monorepo).

## Overview

Single application with a **React** SPA and a **Spring Boot** API under `src/`. GitHub Actions builds both services, runs tests and static analysis, and deploys to **Azure** on pushes to `main`.

## Repository layout


| Path                 | Contents                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| `src/frontend/`      | React app, Tailwind, i18n (English / Spanish), shared UI in `design-system/` |
| `src/backend/`       | Spring Boot API (Java 21), Gradle wrapper                                    |
| `e2e/`               | Playwright config and scripts (optional local use)                           |
| `infrastructure/`    | Terraform and infra notes                                                    |
| `.github/workflows/` | CI (`ci.yml`) and Azure deploy (`deploy-azure.yml`)                          |


## Tech stack


| Area     | Stack                                                                       |
| -------- | --------------------------------------------------------------------------- |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, react-i18next, React Router       |
| Backend  | Spring Boot 4, Spring Security, SpringDoc OpenAPI (Swagger UI)              |
| Tooling  | ESLint (frontend), Spotless + Google Java Format (backend), Vitest, JUnit 5 |


## Prerequisites

- **Node.js 20** — pinned via `.nvmrc`, `.node-version`, and `mise.toml` at the repo root (`src/frontend/.npmrc` uses `engine-strict=true`).
- **Java 21** — required by the Gradle toolchain in `src/backend/build.gradle.kts`.
- **npm** — use `npm ci` / `npm install` with the lockfile under `src/frontend/`.

## Local development

### Frontend (port `5173`)

```bash
cd src/frontend
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The home route renders the **design system gallery** (`src/pages/DesignSystemShowcasePage.tsx`).

Useful commands:

```bash
npm run build          # Typecheck + Vite production build
npm run test           # Vitest
npm run lint           # ESLint
npx tsc --noEmit       # Typecheck only
```

### Backend (port `8080`)

```bash
cd src/backend
chmod +x gradlew   # once, if needed
./gradlew bootRun
```

The current API does **not** require a database or Docker. Optional: `src/backend/docker-compose.yml` starts SQL Server for future work that needs it; it is not used by the minimal stack today.

### Backend endpoints


| Resource   | URL                                                                            |
| ---------- | ------------------------------------------------------------------------------ |
| Health     | `GET http://localhost:8080/health` → JSON `{"status":"UP"}`                    |
| OpenAPI    | `GET http://localhost:8080/v3/api-docs`                                        |
| Swagger UI | [http://localhost:8080/swagger-ui.html](http://localhost:8080/swagger-ui.html) |


Public routes are configured in `SecurityConfig`; other paths require authentication unless extended.

## Testing

```bash
# Frontend
cd src/frontend && npm run test

# Backend
cd src/backend && ./gradlew test --no-daemon
```

### End-to-end (Playwright)

E2E tests live under `[e2e/](e2e/)` (separate `package.json` from the frontend app). From the repo root:

```bash
cd e2e && npm ci && npm test
```

If dependencies are already installed:

```bash
cd e2e && npm test
```

Other scripts:


| Command                            | Purpose                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `npm run test:headed`              | Run Playwright with a visible browser                                       |
| `npm run test:with-backend`        | Sets `E2E_WITH_BACKEND=1` before `playwright test`                          |
| `npm run test:with-backend:headed` | Same as above, headed                                                       |
| `npm run test:with-evidence`       | Runs `[scripts/run-e2e-with-evidence.sh](scripts/run-e2e-with-evidence.sh)` |


## Continuous integration

Workflow: [.github/workflows/ci.yml](.github/workflows/ci.yml)

- **Frontend:** install, ESLint, `npm audit` (high+), Vitest, production build; uploads `dist` as an artifact.
- **Backend:** Spotless (`spotlessCheck`), `./gradlew test`, `bootJar`, Trivy filesystem scan on `build/libs`; uploads the JAR.
- **SAST:** Semgrep (`semgrep scan --config auto`).

Successful runs on `main` trigger the **Deploy to Azure** job (reusable workflow).

## More documentation

- [AGENTS.md](AGENTS.md) — Cursor / editor-oriented notes (responsive UI, i18n, search forms). If anything conflicts with the code or this README, treat the **code** as source of truth.

