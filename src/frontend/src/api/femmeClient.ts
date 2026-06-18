import i18n from "../i18n";
import { apiBaseUrl } from "./baseUrl";
import { authHeaders } from "./authHeaders";

export async function femmeJson<T>(
  path: string,
  init?: RequestInit & { json?: boolean },
): Promise<T> {
  const url = `${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const lang = i18n.resolvedLanguage ?? i18n.language ?? "es";
  const res = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders({ json: init?.json !== false }),
      "Accept-Language": lang,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export async function femmePostJson<T>(path: string, body: unknown): Promise<T> {
  return femmeJson<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export async function femmePutJson<T>(path: string, body: unknown): Promise<T> {
  return femmeJson<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export async function femmePatchJson<T>(path: string, body: unknown): Promise<T> {
  return femmeJson<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export async function femmeDeleteJson<T = void>(path: string): Promise<T> {
  return femmeJson<T>(path, { method: "DELETE" });
}
