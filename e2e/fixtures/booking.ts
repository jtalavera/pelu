import { expect, type APIRequestContext } from "@playwright/test";

import { API_BASE, authHeaders } from "./api";
import { setGlobalFlag } from "./commissions";

export const ONLINE_BOOKING_FLAG = "ONLINE_BOOKING";

/** The neutral answer of the public API: identical for every way a salon can be unavailable (RT-01). */
export const NEUTRAL_PUBLIC_BOOKING = { available: false };

/** Turns the platform-wide booking flag on or off (the effective value is global ∧ tier ∧ tenant). */
export async function setBookingFlagGlobally(request: APIRequestContext, enabled: boolean) {
  await setGlobalFlag(request, ONLINE_BOOKING_FLAG, enabled);
}

/**
 * Sets the caller's salon address and «Aceptar reservas» switch with the e2e-only support endpoint,
 * until the real configuration screen exists (RSV-02, A2).
 */
export async function setBookingSettings(
  request: APIRequestContext,
  token: string,
  settings: { slug?: string; accepting?: boolean },
  apiBase: string = API_BASE,
) {
  const res = await request.post(`${apiBase}/api/admin/booking-test-support/settings`, {
    headers: authHeaders(token),
    data: settings,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

let slugSeq = 0;
/** A valid address no other test uses. */
export function uniqueSlug(prefix = "e2e") {
  return `${prefix}-${Date.now().toString(36)}-${++slugSeq}`;
}

/** The public API as a stranger sees it: no credentials at all. */
export async function getPublicBooking(
  request: APIRequestContext,
  slug: string,
  apiBase: string = API_BASE,
) {
  return request.get(`${apiBase}/api/public/booking/${encodeURIComponent(slug)}`);
}
