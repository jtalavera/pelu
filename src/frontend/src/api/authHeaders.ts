import { ACCESS_TOKEN_STORAGE_KEY } from "./baseUrl";
import { getSharedDevice } from "../auth/sharedDevice";

/** HU-66: header carrying the shared-device credential (see SharedDeviceService). */
export const DEVICE_HEADER = "X-Femme-Device";

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
  // HU-66: on a shared device every call carries the device credential — a PIN session is only
  // valid together with it.
  const device = getSharedDevice();
  if (device) {
    headers[DEVICE_HEADER] = device.token;
  }
  if (options?.json !== false) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}
