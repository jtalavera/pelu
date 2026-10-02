import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

import {
  INTEGRATION_CLIENT_ID,
  INTEGRATION_CLIENT_SECRET,
  PELU_API_BASE,
  PELU_API_PORT,
  PELU_SPA_BASE,
  PELU_SPA_PORT,
  STOCK_API_BASE,
  STOCK_API_PORT,
  STOCK_CLIENT_ID,
  STOCK_CLIENT_SECRET,
  STOCK_PROXY_BASE,
  STOCK_PROXY_PORT,
  STOCK_SPA_BASE,
  STOCK_SPA_PORT,
} from "./fixtures/stock/env";

/**
 * Stock cross-system suite (HU-59..HU-67): pelu + a REAL control-stock, end to end. Same shape as
 * playwright.mt-isolation.config.ts, on its own ports so it never collides with the main suite
 * (:8080/:5173) or the mt suite (:8081/:5174):
 *
 *  - pelu backend :8082 (e2e profile, Stock integration ON, short retry delays) + SPA :5175
 *  - control-stock backend :8090 (its e2e profile) + SPA :5180
 *  - stock-proxy :8091 between pelu and Stock, so specs can take Stock down / inject errors
 *
 * control-stock is read from CONTROL_STOCK_DIR (default: a sibling checkout `../control-stock` of
 * the repo root, or `../../control-stock`). Shared secrets live in fixtures/stock/env.ts.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "../src/frontend");
const backendDir = path.resolve(__dirname, "../src/backend");

function controlStockDir(): string {
  const fromEnv = process.env.CONTROL_STOCK_DIR?.trim();
  const candidates = fromEnv
    ? [path.resolve(fromEnv)]
    : [path.resolve(__dirname, "../control-stock"), path.resolve(__dirname, "../../control-stock")];
  const found = candidates.find((c) => existsSync(path.join(c, "src", "backend")));
  if (!found) {
    throw new Error(
      `[playwright.stock] control-stock checkout not found (tried ${candidates.join(", ")}). ` +
        "Clone jtalavera/control-stock next to this repo or set CONTROL_STOCK_DIR.",
    );
  }
  return found;
}

const stockDir = controlStockDir();

process.env.PLAYWRIGHT_API_BASE_URL = PELU_API_BASE;
process.env.STOCK_E2E = "1";

const videoMode =
  (process.env.E2E_VIDEO as "on" | "retain-on-failure" | "off" | undefined) ??
  (process.env.CI ? "retain-on-failure" : "retain-on-failure");

const peluBackend = {
  command: "./gradlew --no-daemon bootRun",
  cwd: backendDir,
  url: `${PELU_API_BASE}/health`,
  reuseExistingServer: !process.env.CI,
  timeout: 480_000,
  env: {
    ...process.env,
    SPRING_PROFILES_ACTIVE: "e2e",
    SERVER_PORT: String(PELU_API_PORT),
    APP_FRONTEND_URL: `${PELU_SPA_BASE},http://127.0.0.1:${PELU_SPA_PORT}`,
    SPRING_APPLICATION_JSON: JSON.stringify({
      "app.femme.stock.enabled": true,
      "app.femme.stock.base-url": STOCK_PROXY_BASE,
      "app.femme.stock.client-id": STOCK_CLIENT_ID,
      "app.femme.stock.client-secret": STOCK_CLIENT_SECRET,
      "app.femme.stock.integration.client-id": INTEGRATION_CLIENT_ID,
      // Short backoff so "Stock down, then back" and "retries exhausted" fit in a test.
      "app.femme.stock.retry-delays": "2s,2s,2s,2s,2s,2s",
      "app.femme.stock.reconciler-interval": 2000,
      "app.femme.stock.reconciler-initial-delay": 2000,
    }),
  },
} as const;

const stockBackend = {
  command: "./gradlew --no-daemon bootRun",
  cwd: path.join(stockDir, "src", "backend"),
  url: `${STOCK_API_BASE}/health`,
  reuseExistingServer: !process.env.CI,
  timeout: 480_000,
  env: {
    ...process.env,
    SPRING_PROFILES_ACTIVE: "e2e",
    SERVER_PORT: String(STOCK_API_PORT),
    SPRING_APPLICATION_JSON: JSON.stringify({
      "app.stock.frontend-url": STOCK_SPA_BASE,
      "app.stock.trusted-issuers.pelu.host-home-url": `${PELU_SPA_BASE}/app`,
      "app.stock.trusted-issuers.pelu.host-logout-url": `${PELU_SPA_BASE}/login?reason=stock_logout`,
      // The only call Stock makes to pelu: the flags pull (reconciliation).
      "app.stock.feature-flags.reconciler.enabled": true,
      "app.stock.feature-flags.reconciler.base-url": PELU_API_BASE,
      "app.stock.feature-flags.reconciler.token-url": `${PELU_API_BASE}/api/integration/oauth/token`,
      "app.stock.feature-flags.reconciler.client-id": INTEGRATION_CLIENT_ID,
      "app.stock.feature-flags.reconciler.client-secret": INTEGRATION_CLIENT_SECRET,
      "app.stock.feature-flags.reconciler.interval": "15s",
      "app.stock.feature-flags.reconciler.initial-delay": "15s",
    }),
  },
} as const;

const proxy = {
  command: "node fixtures/stock/stock-proxy.mjs",
  cwd: __dirname,
  url: `${STOCK_PROXY_BASE}/health`,
  reuseExistingServer: !process.env.CI,
  timeout: 30_000,
  env: {
    ...process.env,
    STOCK_PROXY_PORT: String(STOCK_PROXY_PORT),
    STOCK_PROXY_TARGET: STOCK_API_BASE,
  },
} as const;

const peluSpa = {
  command: `npm run dev -- --port ${PELU_SPA_PORT} --strictPort`,
  cwd: frontendDir,
  url: PELU_SPA_BASE,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
  env: {
    ...process.env,
    VITE_API_BASE_URL: PELU_API_BASE,
    VITE_PLAYWRIGHT: "1",
    VITE_STOCK_SPA_URL: STOCK_SPA_BASE,
  },
} as const;

const stockSpa = {
  command: `npm run dev -- --port ${STOCK_SPA_PORT} --strictPort`,
  cwd: path.join(stockDir, "src", "frontend"),
  url: STOCK_SPA_BASE,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
  env: {
    ...process.env,
    VITE_API_BASE_URL: STOCK_API_BASE,
  },
} as const;

export default defineConfig({
  testDir: "./tests/stock",
  globalSetup: "./global-setup.stock.ts",
  outputDir: path.join(__dirname, "test-results", "stock"),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(__dirname, "playwright-report", "stock") }],
  ],
  use: {
    baseURL: PELU_SPA_BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: videoMode,
    locale: "en-US",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [proxy, stockBackend, peluBackend, stockSpa, peluSpa],
});
