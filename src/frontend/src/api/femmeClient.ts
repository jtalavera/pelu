import i18n from "../i18n";
import { apiBaseUrl } from "./baseUrl";
import { authHeaders } from "./authHeaders";
import { endSession, isPinSession, SHARED_DEVICE_PATH } from "../auth/sharedDevice";

/**
 * HU-66 criterion 21: a PIN session dies when the professional is deactivated, her PIN changes or
 * the device is revoked. A refused call then sends the device back to the picker — unless the
 * session is still fine and the refusal was about the request itself (e.g. someone else's
 * appointment).
 */
async function endPinSessionIfInvalid(): Promise<void> {
  try {
    const me = await fetch(`${apiBaseUrl()}/api/me`, { headers: authHeaders({ json: false }) });
    if (me.ok) return;
  } catch {
    return;
  }
  endSession();
  window.location.assign(SHARED_DEVICE_PATH);
}

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
    if ((res.status === 401 || res.status === 403) && isPinSession()) {
      await endPinSessionIfInvalid();
    }
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
