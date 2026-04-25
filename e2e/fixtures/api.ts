import { expect, type APIRequestContext } from "@playwright/test";

/** Backend origin for Playwright `request` calls (matches Vite default `VITE_API_BASE_URL`). */
export const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://localhost:8080";

/** Function form of API_BASE for tests that call apiBaseUrl(). */
export function apiBaseUrl(): string {
  return API_BASE;
}

export async function loginAsDemoApi(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE}/api/auth/login`, {
    data: { email: "admin@demo.com", password: "Demo123!" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const json = (await res.json()) as { accessToken: string };
  return json.accessToken;
}

export function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function apiGetJson<T>(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<T> {
  const res = await request.get(`${API_BASE}${path}`, {
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json() as Promise<T>;
}

export async function apiPostJson<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  data: unknown,
): Promise<T> {
  const res = await request.post(`${API_BASE}${path}`, {
    headers: authHeaders(token),
    data,
  });
  if (!res.ok()) {
    throw new Error(`POST ${path} -> ${res.status()}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPutJson<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  data: unknown,
): Promise<T> {
  const res = await request.put(`${API_BASE}${path}`, {
    headers: authHeaders(token),
    data,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json() as Promise<T>;
}

export async function apiPostJsonStatus(
  request: APIRequestContext,
  token: string,
  path: string,
  data: unknown,
): Promise<{ status: number; text: string }> {
  const res = await request.post(`${API_BASE}${path}`, {
    headers: authHeaders(token),
    data,
  });
  return { status: res.status(), text: await res.text() };
}

/** Returns an ISO-8601 instant for tomorrow at the given local hour/minute (runner TZ). */
export function tomorrowLocalIso(hour: number, minute: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export type SeededSalon = {
  categoryId: number;
  serviceId: number;
  professionalId: number;
  /** Exact full name of the seeded professional (required when multiple "E2E Prof …" exist in DB). */
  professionalFullName: string;
  /** Exact service name for searchable selects. */
  serviceFullName: string;
};

export async function seedCategoryServiceProfessional(
  request: APIRequestContext,
  token: string,
): Promise<SeededSalon> {
  const suffix = Date.now();
  const cat = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
    name: `E2E Cat ${suffix}`,
    accentKey: "stone",
  });
  const serviceFullName = `E2E Svc ${suffix}`;
  const svc = await apiPostJson<{ id: number }>(request, token, "/api/services", {
    name: serviceFullName,
    categoryId: cat.id,
    priceMinor: 50000,
    durationMinutes: 60,
  });
  const professionalFullName = `E2E Prof ${suffix}`;
  const prof = await apiPostJson<{ id: number }>(request, token, "/api/professionals", {
    fullName: professionalFullName,
    phone: null,
    email: null,
    photoDataUrl: null,
  });
  return {
    categoryId: cat.id,
    serviceId: svc.id,
    professionalId: prof.id,
    professionalFullName,
    serviceFullName,
  };
}

export async function seedClient(
  request: APIRequestContext,
  token: string,
  fullName: string,
  phone?: string,
): Promise<{ id: number }> {
  return apiPostJson<{ id: number }>(request, token, "/api/clients", {
    fullName,
    phone: phone ?? null,
    email: null,
    ruc: null,
  });
}

export async function createAppointmentApi(
  request: APIRequestContext,
  token: string,
  body: { clientId: number | null; professionalId: number; serviceId: number; startAt: string },
): Promise<{ id: number; status: string }> {
  return apiPostJson<{ id: number; status: string }>(request, token, "/api/appointments", body);
}

/** Opens the cash register via API if none is open (for seeding invoices in e2e). */
export async function ensureCashSessionOpenApi(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const res = await request.get(`${API_BASE}/api/cash-sessions/current`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status() === 200) {
    return;
  }
  const open = await request.post(`${API_BASE}/api/cash-sessions/open`, {
    headers: authHeaders(token),
    data: { openingCashAmount: 50_000 },
  });
  expect(open.ok(), await open.text()).toBeTruthy();
}

export type FiscalStampDto = {
  id: number;
  stampNumber: string;
  validFrom: string;
  validUntil: string;
  rangeFrom: number;
  rangeTo: number;
  nextEmissionNumber: number;
  active: boolean;
  lockedAfterInvoice: boolean;
};

export async function listFiscalStamps(
  request: APIRequestContext,
  token: string,
): Promise<FiscalStampDto[]> {
  return apiGetJson<FiscalStampDto[]>(request, token, "/api/fiscal-stamps");
}

/** Ensures an active fiscal stamp valid for today so invoice issuance does not fail with FISCAL_STAMP_NOT_VALID. */
export async function ensureActiveFiscalStampForInvoices(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const stamps = await listFiscalStamps(request, token);
  const today = new Date();
  const todayStr = isoDateLocal(today);
  const isValidToday = (s: FiscalStampDto) => {
    if (!s.active) return false;
    return s.validFrom <= todayStr && s.validUntil >= todayStr;
  };
  if (stamps.some(isValidToday)) return;

  for (const s of stamps) {
    await request.post(`${API_BASE}/api/fiscal-stamps/${s.id}/deactivate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  const nextYear = new Date(today);
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const maxNext = Math.max(100, ...stamps.map((s) => s.nextEmissionNumber ?? 0));
  const created = await apiPostJson<{ id: number }>(request, token, "/api/fiscal-stamps", {
    stampNumber: `7${Date.now().toString().slice(-7)}`,
    validFrom: todayStr,
    validUntil: isoDateLocal(nextYear),
    rangeFrom: 1,
    rangeTo: 9_999_999,
    initialEmissionNumber: maxNext,
  });
  await apiPostJson(request, token, `/api/fiscal-stamps/${created.id}/activate`, {});
}

export function isoDateLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Weekly schedule rows for `PUT /api/professionals/{id}/schedules` (Monday=1 … Sunday=7). */
export async function putProfessionalSchedules(
  request: APIRequestContext,
  token: string,
  professionalId: number,
  schedules: Array<{ dayOfWeek: number; startTime: string; endTime: string }>,
): Promise<{ id: number; fullName: string; active: boolean }> {
  return apiPutJson(request, token, `/api/professionals/${professionalId}/schedules`, schedules);
}
