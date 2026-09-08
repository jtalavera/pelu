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
// Point every `e2e/fixtures/api.ts` network helper (reads this at module eval, else defaults :8080) at the mt backend.
process.env.PLAYWRIGHT_API_BASE_URL = MT_API_BASE;

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
    // Spring Boot relaxed binding: SERVER_PORT -> server.port. application-e2e.properties
    // does not pin server.port, so this is all that is needed to move the backend to :8081.
    SERVER_PORT: String(MT_BACKEND_PORT),
  },
} as const;

export default defineConfig({
  testDir: "./tests/mt-isolation",
  globalSetup: "./global-setup.mt.ts",
  // Artifacts nest under the dirs e2e/.gitignore already excludes (/test-results/, /playwright-report/)
  // so this suite's output never shows up as untracked files.
  outputDir: path.join(__dirname, "test-results", "mt"),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(__dirname, "playwright-report", "mt") }],
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
