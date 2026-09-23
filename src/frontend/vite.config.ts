/// <reference types="vitest" />
import { execSync } from "node:child_process";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function resolveBuildVersion(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { cwd: __dirname }).toString().trim();
  } catch {
    return `dev-${Date.now()}`;
  }
}

/**
 * Serves/emits `version.json` with the build's identity so a running tab can detect
 * a newer deploy (see useVersionCheck) and reload — see hotfix/auto-reload-stale-build.
 */
function versionMarkerPlugin(version: string): Plugin {
  const body = JSON.stringify({ version });
  return {
    name: "version-marker",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/version.json")) return next();
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: body });
    },
  };
}

export default defineConfig(() => {
  const version = resolveBuildVersion();
  return {
    plugins: [react(), versionMarkerPlugin(version)],
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    resolve: {
      alias: {
        "@design-system": path.resolve(__dirname, "design-system"),
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "design-system/**/*.{test,spec}.{ts,tsx}",
      ],
      passWithNoTests: true,
    },
  };
});
