import { apiBaseUrl } from "./baseUrl";

/**
 * Client of the PUBLIC online booking API (`/api/public/booking/**`, RT-02/RT-03). It is deliberately
 * separate from `femmeClient`: no access token, no `Authorization` header, no PIN-session logic and
 * no redirect to the login on a 401 — whoever opens a salon's link is not a user of the app.
 */

export type PublicBookingInfo = {
  /** False for EVERY unavailable case (unknown address, flag off, suspended, not accepting). */
  available: boolean;
  /** Present only when `available`. */
  businessName?: string;
};

export async function fetchPublicBooking(slug: string, signal?: AbortSignal): Promise<PublicBookingInfo> {
  const res = await fetch(`${apiBaseUrl()}/api/public/booking/${encodeURIComponent(slug)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "omit",
    signal,
  });
  if (!res.ok) {
    throw new Error(`PUBLIC_BOOKING_${res.status}`);
  }
  return (await res.json()) as PublicBookingInfo;
}
