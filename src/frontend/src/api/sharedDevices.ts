import { apiBaseUrl } from "./baseUrl";
import { DEVICE_HEADER } from "./authHeaders";
import { femmeJson, femmePostJson } from "./femmeClient";

/** HU-66: shared devices (administration) and the device's own PIN login. */

export type SharedDevice = {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  lockedUntil: string | null;
};

export type ActivatedDevice = {
  device: SharedDevice;
  deviceToken: string;
  tenantName: string;
};

export type PickerProfessional = {
  id: number;
  fullName: string;
  photoDataUrl: string | null;
  lockedUntil: string | null;
};

export type PickerResponse = {
  deviceId: number;
  deviceName: string;
  tenantName: string;
  deviceLockedUntil: string | null;
  professionals: PickerProfessional[];
};

export type PinLoginError = {
  status: number;
  error: string;
  remainingAttempts?: number;
  lockedUntil?: string;
};

export function listSharedDevices(): Promise<SharedDevice[]> {
  return femmeJson<SharedDevice[]>("/api/shared-devices", { json: false });
}

export function activateSharedDevice(name: string, password: string): Promise<ActivatedDevice> {
  return femmePostJson<ActivatedDevice>("/api/shared-devices", { name, password });
}

export function revokeSharedDevice(id: number): Promise<void> {
  return femmePostJson<void>(`/api/shared-devices/${id}/revoke`, {});
}

export function unlockSharedDevice(id: number): Promise<SharedDevice> {
  return femmePostJson<SharedDevice>(`/api/shared-devices/${id}/unlock`, {});
}

export function unlockProfessionalPin<T>(professionalId: number): Promise<T> {
  return femmePostJson<T>(`/api/professionals/${professionalId}/unlock-pin`, {});
}

/** The picker; `null` when the device credential is unknown or was revoked (→ normal login). */
export async function fetchPicker(deviceToken: string): Promise<PickerResponse | null> {
  const res = await fetch(`${apiBaseUrl()}/api/shared-device/session`, {
    headers: { [DEVICE_HEADER]: deviceToken },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return (await res.json()) as PickerResponse;
}

export async function pinLogin(
  deviceToken: string,
  professionalId: number,
  pin: string,
): Promise<{ accessToken: string } | PinLoginError> {
  const res = await fetch(`${apiBaseUrl()}/api/shared-device/pin-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [DEVICE_HEADER]: deviceToken },
    body: JSON.stringify({ professionalId, pin }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { accessToken: String(body.accessToken) };
  return {
    status: res.status,
    error: typeof body.error === "string" ? body.error : "GENERIC",
    remainingAttempts:
      typeof body.remainingAttempts === "number" ? body.remainingAttempts : undefined,
    lockedUntil: typeof body.lockedUntil === "string" ? body.lockedUntil : undefined,
  };
}
