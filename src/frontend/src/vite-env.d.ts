/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Set by Playwright webServer — pin locale to English for deterministic e2e. */
  readonly VITE_PLAYWRIGHT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
