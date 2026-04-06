/** Backend origin (no trailing slash). Used for REST and OAuth redirects. */
export function apiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return (raw ?? "http://localhost:8080").replace(/\/+$/, "");
}

export const ACCESS_TOKEN_STORAGE_KEY = "accessToken";
