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

const evidenceRoot = process.env.E2E_EVIDENCE_DIR?.trim();

/** `on` = video for every test (success + failure). Override with E2E_VIDEO=retain-on-failure (e.g. CI). */
const videoMode =
  (process.env.E2E_VIDEO as "on" | "retain-on-failure" | "off" | undefined) ??
  (process.env.CI ? "retain-on-failure" : "on");

/**
 * Videos record real-time browser output; Playwright cannot slow playback of the file itself.
 * `slowMo` adds delay after each Playwright action so on-screen motion advances more slowly in the recording.
 *
 * `E2E_PLAYWRIGHT_ACTION_SPEED` — 1 = full speed (no slowMo), 0.25 ≈ quarter speed vs 1 (≈4× longer timeline).
 * Override delay exactly with `E2E_PLAYWRIGHT_SLOW_MO_MS` (non-negative integer ms).
 */
const explicitSlowMo = process.env.E2E_PLAYWRIGHT_SLOW_MO_MS?.trim();
const actionSpeedRaw = process.env.E2E_PLAYWRIGHT_ACTION_SPEED ?? "0.25";
const actionSpeed = Math.min(1, Math.max(0.05, Number(actionSpeedRaw) || 0.25));
const slowMoMs =
  explicitSlowMo !== undefined && explicitSlowMo !== ""
    ? Math.max(0, Math.round(Number(explicitSlowMo)) || 0)
    : actionSpeed >= 1
      ? 0
      : Math.round(120 * (1 / actionSpeed - 1));

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
  outputDir: evidenceRoot
    ? path.join(evidenceRoot, "artifacts")
    : path.join(__dirname, "test-results"),
  // Shared Spring Boot + H2 state (e.g. one open cash session per tenant) — avoid parallel races.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: evidenceRoot
          ? path.join(evidenceRoot, "html-report")
          : path.join(__dirname, "playwright-report"),
      },
    ],
    ...(evidenceRoot
      ? ([["json", { outputFile: path.join(evidenceRoot, "results.json") }]] as const)
      : []),
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: videoMode,
    locale: "en-US",
    launchOptions: {
      slowMo: slowMoMs,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: withBackend ? [viteServer, backendServer] : viteServer,
});
