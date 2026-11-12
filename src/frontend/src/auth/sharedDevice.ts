import { ACCESS_TOKEN_STORAGE_KEY } from "../api/baseUrl";

/**
 * HU-66: a browser an administrator enabled as "dispositivo compartido". The device credential
 * lives in localStorage (it must survive closing the tab); the professional's PIN session token
 * lives in sessionStorage like any other session, flagged so the app knows it is a PIN session.
 */
const DEVICE_STORAGE_KEY = "femme.sharedDevice";
const PIN_SESSION_FLAG_KEY = "femme.pinSession";

export const SHARED_DEVICE_PATH = "/device";

export type SharedDeviceInfo = {
  deviceId: number;
  name: string;
  tenantName: string;
  token: string;
};

export function getSharedDevice(): SharedDeviceInfo | null {
  try {
    const raw = localStorage.getItem(DEVICE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SharedDeviceInfo) : null;
  } catch {
    return null;
  }
}

export function setSharedDevice(info: SharedDeviceInfo): void {
  localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(info));
}

export function clearSharedDevice(): void {
  try {
    localStorage.removeItem(DEVICE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function isPinSession(): boolean {
  return sessionStorage.getItem(PIN_SESSION_FLAG_KEY) === "1";
}

/** Stores a professional's PIN session (replaces whatever session the tab had). */
export function startPinSession(accessToken: string): void {
  sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  sessionStorage.setItem(PIN_SESSION_FLAG_KEY, "1");
}

/** A regular (email + password) session: drops the PIN-session flag. */
export function markRegularSession(): void {
  sessionStorage.removeItem(PIN_SESSION_FLAG_KEY);
}

/** Ends the current session (PIN or not) without touching the device credential. */
export function endSession(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(PIN_SESSION_FLAG_KEY);
}

/** Where a signed-out tab should go: the picker on a shared device, the login elsewhere. */
export function signedOutPath(): string {
  return getSharedDevice() ? SHARED_DEVICE_PATH : "/login";
}
