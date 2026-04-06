import { ACCESS_TOKEN_STORAGE_KEY } from "./baseUrl";

export type AuthHeaderOptions = {
  /** When false, omit Content-Type (use for GET requests). Default true. */
  json?: boolean;
};

export function authHeaders(options?: AuthHeaderOptions): HeadersInit {
  const token = sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options?.json !== false) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}
