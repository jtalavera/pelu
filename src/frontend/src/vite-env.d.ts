/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Set by Playwright webServer — pin locale to English for deterministic e2e. */
  readonly VITE_PLAYWRIGHT?: string;
  /** Issue #268: App Insights connection string (public ingestion endpoint) — enables browser RUM. */
  readonly VITE_APPINSIGHTS_CONNECTION_STRING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build identifier baked in via Vite `define` — see vite.config.ts's version-marker plugin. */
declare const __APP_VERSION__: string;
