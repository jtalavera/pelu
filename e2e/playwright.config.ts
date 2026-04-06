import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "../src/frontend");
/** Same as `cd src/backend` from the repo root — `./gradlew bootRun` runs here. */
const backendDir = path.resolve(__dirname, "../src/backend");

/** Vite default dev port (see `npm run dev` in `src/frontend`). */
const PORT = 5173;
/** Use `localhost` (not `127.0.0.1`) so the URL matches Vite on macOS (IPv6 ::1). */
const BASE_URL = `http://localhost:${PORT}`;

const backendReadyUrl = "http://localhost:8080/health";

const viteServer = {
  command: "npm run dev -- --port 5173",
  cwd: frontendDir,
  url: BASE_URL,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
} as const;

const backendServer = {
  // --no-daemon: friendlier on CI runners; e2e profile uses in-memory H2 (see application-e2e.properties).
  command: "./gradlew --no-daemon bootRun",
  cwd: backendDir,
  url: backendReadyUrl,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
  env: {
    ...process.env,
    SPRING_PROFILES_ACTIVE: process.env.SPRING_PROFILES_ACTIVE ?? "e2e",
  },
} as const;

/** Set `E2E_WITH_BACKEND=1` to also start Spring Boot (`src/backend`: `./gradlew bootRun`). */
const withBackend =
  process.env.E2E_WITH_BACKEND === "1" || process.env.E2E_WITH_BACKEND === "true";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: withBackend ? [viteServer, backendServer] : viteServer,
});
